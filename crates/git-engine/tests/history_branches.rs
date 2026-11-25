//! History, references, branch operations and integrations against real repositories.

mod support;

use rustgit_git_engine::history::{LogQuery, LogSearch, SearchField};
use rustgit_git_engine::integrate::{ConflictSide, IntegrationOutcome, MergeStrategy};
use rustgit_git_engine::refs::{CheckoutMode, HeadState, RefKind};
use rustgit_git_engine::{
    ChangeKind, GitError, InProgress, abort_operation, checkout_branch, cherry_pick,
    commit_details, commit_file_diff, conflict_versions, continue_operation, create_branch,
    delete_branch, list_refs, log_page, merge_branch, read_status, rebase_branch, rename_branch,
    resolve_conflict, revert_commit, set_upstream, skip_operation,
};
use support::TestRepo;

fn query(limit: u32) -> LogQuery {
    LogQuery {
        limit,
        ..LogQuery::default()
    }
}

#[test]
fn log_pages_are_ordered_and_complete() {
    let repo: TestRepo = TestRepo::new();
    let mut oids: Vec<String> = Vec::new();
    for index in 0..5 {
        oids.push(repo.commit_file("f.txt", &format!("{index}\n"), &format!("commit {index}")));
    }
    let first = log_page(&repo.git, &repo.root(), &query(3)).expect("page 1");
    assert_eq!(first.commits.len(), 3);
    assert!(first.has_more);
    assert_eq!(first.commits[0].oid, oids[4]);
    assert_eq!(first.commits[0].parents, [oids[3].clone()]);
    assert_eq!(first.commits[0].summary, "commit 4");

    let second = log_page(
        &repo.git,
        &repo.root(),
        &LogQuery {
            skip: 3,
            ..query(3)
        },
    )
    .expect("page 2");
    assert_eq!(second.commits.len(), 2);
    assert!(!second.has_more);
    assert!(second.commits[1].parents.is_empty(), "root commit");
}

#[test]
fn log_handles_unborn_branch_and_search() {
    let repo: TestRepo = TestRepo::new();
    let empty = log_page(&repo.git, &repo.root(), &query(10)).expect("empty");
    assert!(empty.commits.is_empty());

    repo.commit_file("a.txt", "a\n", "Add feature [x]");
    let target: String = repo.commit_file("b.txt", "b\n", "Fix bug");
    let by_message = log_page(
        &repo.git,
        &repo.root(),
        &LogQuery {
            search: Some(LogSearch {
                text: "feature [x]".to_owned(),
                field: SearchField::Message,
            }),
            ..query(10)
        },
    )
    .expect("search");
    assert_eq!(
        by_message.commits.len(),
        1,
        "fixed-string, case-insensitive"
    );

    let by_sha = log_page(
        &repo.git,
        &repo.root(),
        &LogQuery {
            search: Some(LogSearch {
                text: target[..8].to_owned(),
                field: SearchField::Sha,
            }),
            ..query(10)
        },
    )
    .expect("sha");
    assert_eq!(by_sha.commits[0].oid, target);

    let bad = log_page(
        &repo.git,
        &repo.root(),
        &LogQuery {
            revisions: Some(vec!["--output=x".to_owned()]),
            ..query(10)
        },
    );
    assert!(matches!(bad, Err(GitError::InvalidRequest(_))));
}

#[test]
fn commit_details_and_file_diff() {
    let repo: TestRepo = TestRepo::new();
    let original: &str = "1\n2\n3\n4\n5\n6\n7\n8\n";
    let root_oid: String = repo.commit_file("a.txt", original, "initial");
    repo.write("a.txt", &original.replace("2\n", "TWO\n"));
    repo.git_ok(&["mv", "a.txt", "b.txt"]);
    repo.git_ok(&["add", "-A"]);
    repo.git_ok(&["commit", "-m", "Rename and edit\n\nDetails here."]);
    let head: String = repo.git_ok(&["rev-parse", "HEAD"]).trim().to_owned();

    let details = commit_details(&repo.git, &repo.root(), &head).expect("details");
    assert_eq!(details.parents, std::slice::from_ref(&root_oid));
    assert_eq!(details.message, "Rename and edit\n\nDetails here.");
    assert_eq!(details.files.len(), 1);
    assert_eq!(details.files[0].kind, ChangeKind::Renamed);
    assert_eq!(details.files[0].original_path.as_deref(), Some("a.txt"));
    assert_eq!(
        (details.files[0].additions, details.files[0].deletions),
        (Some(1), Some(1))
    );

    let root_details = commit_details(&repo.git, &repo.root(), &root_oid).expect("root");
    assert_eq!(root_details.files[0].kind, ChangeKind::Added);

    let diff =
        commit_file_diff(&repo.git, &repo.root(), &head, "b.txt", Some("a.txt"), 3).expect("diff");
    assert_eq!((diff.added, diff.deleted), (1, 1));
    let root_diff =
        commit_file_diff(&repo.git, &repo.root(), &root_oid, "a.txt", None, 3).expect("root diff");
    assert_eq!(root_diff.added, 8);
}

#[test]
fn refs_report_branches_upstreams_and_tags() {
    let repo: TestRepo = TestRepo::new();
    let first: String = repo.commit_file("a.txt", "a\n", "initial");
    repo.git_ok(&["tag", "-a", "v1", "-m", "Release 1"]);
    create_branch(&repo.git, &repo.root(), "feature", None, false).expect("branch");
    repo.commit_file("a.txt", "b\n", "second");
    set_upstream(&repo.git, &repo.root(), "main", Some("feature")).expect("upstream");

    let refs = list_refs(&repo.git, &repo.root()).expect("refs");
    assert_eq!(
        refs.head,
        HeadState::Branch {
            name: "main".to_owned()
        }
    );
    let main = refs
        .refs
        .iter()
        .find(|r| r.short_name == "main")
        .expect("main");
    assert_eq!(main.upstream.as_deref(), Some("feature"));
    assert_eq!((main.ahead, main.behind), (Some(1), Some(0)));
    let tag = refs
        .refs
        .iter()
        .find(|r| r.kind == RefKind::Tag)
        .expect("tag");
    assert_eq!(tag.oid, first, "annotated tags are peeled to the commit");

    set_upstream(&repo.git, &repo.root(), "main", None).expect("unset");
    let refs = list_refs(&repo.git, &repo.root()).expect("refs");
    assert_eq!(
        refs.refs
            .iter()
            .find(|r| r.short_name == "main")
            .expect("main")
            .ahead,
        None
    );
}

#[test]
fn branch_create_rename_delete_rules() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("a.txt", "a\n", "initial");
    assert!(matches!(
        create_branch(&repo.git, &repo.root(), "bad..name", None, false),
        Err(GitError::InvalidRefName(_))
    ));
    create_branch(&repo.git, &repo.root(), "topic", None, true).expect("create+checkout");
    assert!(matches!(
        create_branch(&repo.git, &repo.root(), "topic", None, false),
        Err(GitError::BranchExists(_))
    ));
    repo.commit_file("t.txt", "t\n", "topic work");
    checkout_branch(&repo.git, &repo.root(), "main", CheckoutMode::KeepChanges).expect("main");

    assert!(matches!(
        delete_branch(&repo.git, &repo.root(), "topic", false),
        Err(GitError::BranchNotFullyMerged(_))
    ));
    rename_branch(&repo.git, &repo.root(), "topic", "renamed").expect("rename");
    delete_branch(&repo.git, &repo.root(), "renamed", true).expect("force delete");
    assert!(
        list_refs(&repo.git, &repo.root())
            .expect("refs")
            .refs
            .iter()
            .all(|r| r.short_name != "renamed")
    );
}

#[test]
fn checkout_never_discards_changes() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("a.txt", "main\n", "initial");
    create_branch(&repo.git, &repo.root(), "other", None, true).expect("other");
    repo.commit_file("a.txt", "other\n", "other change");
    checkout_branch(&repo.git, &repo.root(), "main", CheckoutMode::KeepChanges).expect("main");

    repo.write("a.txt", "local edit\n");
    let refused = checkout_branch(&repo.git, &repo.root(), "other", CheckoutMode::KeepChanges);
    assert!(
        matches!(&refused, Err(GitError::WouldOverwriteChanges(paths)) if paths == &["a.txt"]),
        "{refused:?}"
    );
    assert_eq!(repo.read("a.txt"), "local edit\n");

    let dirty = checkout_branch(&repo.git, &repo.root(), "other", CheckoutMode::AbortIfDirty);
    assert!(matches!(dirty, Err(GitError::WouldOverwriteChanges(_))));
}

#[test]
fn checkout_remote_branch_creates_tracking_branch() {
    let origin: TestRepo = TestRepo::new();
    origin.commit_file("a.txt", "a\n", "initial");
    origin.git_ok(&["branch", "feature"]);
    let repo: TestRepo = TestRepo::new();
    repo.git_ok(&[
        "remote",
        "add",
        "origin",
        origin.root().to_str().expect("utf8"),
    ]);
    repo.git_ok(&["fetch", "origin"]);

    checkout_branch(
        &repo.git,
        &repo.root(),
        "origin/feature",
        CheckoutMode::KeepChanges,
    )
    .expect("checkout remote");
    let refs = list_refs(&repo.git, &repo.root()).expect("refs");
    assert_eq!(
        refs.head,
        HeadState::Branch {
            name: "feature".to_owned()
        }
    );
    let local = refs
        .refs
        .iter()
        .find(|r| r.short_name == "feature")
        .expect("local");
    assert_eq!(local.upstream.as_deref(), Some("origin/feature"));
}

fn diverged_repo(conflicting: bool) -> TestRepo {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("shared.txt", "base\n", "base");
    repo.git_ok(&["switch", "-c", "feature"]);
    repo.commit_file(
        if conflicting {
            "shared.txt"
        } else {
            "feature.txt"
        },
        "feature\n",
        "feature change",
    );
    repo.git_ok(&["switch", "main"]);
    repo.commit_file("shared.txt", "main\n", "main change");
    repo
}

#[test]
fn merge_outcomes() {
    let repo: TestRepo = diverged_repo(false);
    let merged =
        merge_branch(&repo.git, &repo.root(), "feature", MergeStrategy::Default).expect("merge");
    assert_eq!(merged.outcome, IntegrationOutcome::Completed);
    let again =
        merge_branch(&repo.git, &repo.root(), "feature", MergeStrategy::Default).expect("again");
    assert_eq!(again.outcome, IntegrationOutcome::UpToDate);

    let ff_repo: TestRepo = TestRepo::new();
    ff_repo.commit_file("a.txt", "a\n", "base");
    ff_repo.git_ok(&["branch", "ahead"]);
    ff_repo.git_ok(&["switch", "ahead"]);
    ff_repo.commit_file("b.txt", "b\n", "ahead");
    ff_repo.git_ok(&["switch", "main"]);
    let ff = merge_branch(
        &ff_repo.git,
        &ff_repo.root(),
        "ahead",
        MergeStrategy::FfOnly,
    )
    .expect("ff");
    assert_eq!(ff.outcome, IntegrationOutcome::FastForward);
}

#[test]
fn merge_conflict_resolution_and_continue() {
    let repo: TestRepo = diverged_repo(true);
    let result = merge_branch(&repo.git, &repo.root(), "feature", MergeStrategy::Default)
        .expect("merge runs");
    assert_eq!(result.outcome, IntegrationOutcome::Conflicts);
    assert_eq!(result.conflicted, ["shared.txt"]);
    assert_eq!(result.status.in_progress, InProgress::Merging);

    assert!(matches!(
        merge_branch(&repo.git, &repo.root(), "feature", MergeStrategy::Default),
        Err(GitError::OperationInProgress(_))
    ));

    let versions = conflict_versions(&repo.git, &repo.root(), "shared.txt").expect("versions");
    assert_eq!(versions.base.as_deref(), Some("base\n"));
    assert_eq!(versions.ours.as_deref(), Some("main\n"));
    assert_eq!(versions.theirs.as_deref(), Some("feature\n"));
    assert!(versions.working.contains("<<<<<<<"));
    assert!(!versions.binary);

    let blocked = continue_operation(&repo.git, &repo.root()).expect("continue runs");
    assert_eq!(blocked.outcome, IntegrationOutcome::Conflicts);

    resolve_conflict(
        &repo.git,
        &repo.root(),
        "shared.txt",
        Some("merged\n"),
        None,
    )
    .expect("resolve");
    let done = continue_operation(&repo.git, &repo.root()).expect("continue");
    assert_eq!(done.outcome, IntegrationOutcome::Completed);
    assert_eq!(done.status.in_progress, InProgress::None);
    assert_eq!(repo.read("shared.txt"), "merged\n");
    assert_eq!(
        repo.git_ok(&["rev-list", "--count", "--merges", "HEAD"])
            .trim(),
        "1"
    );
}

#[test]
fn abort_restores_state() {
    let repo: TestRepo = diverged_repo(true);
    let before: String = repo.git_ok(&["rev-parse", "HEAD"]);
    merge_branch(&repo.git, &repo.root(), "feature", MergeStrategy::Default).expect("merge");
    let status = abort_operation(&repo.git, &repo.root()).expect("abort");
    assert_eq!(status.in_progress, InProgress::None);
    assert_eq!(repo.git_ok(&["rev-parse", "HEAD"]), before);
    assert_eq!(repo.read("shared.txt"), "main\n");
}

#[test]
fn rebase_with_conflict_take_side_and_continue() {
    let repo: TestRepo = diverged_repo(true);
    repo.git_ok(&["switch", "feature"]);
    let result = rebase_branch(&repo.git, &repo.root(), "main").expect("rebase runs");
    assert_eq!(result.outcome, IntegrationOutcome::Conflicts);
    assert_eq!(
        read_status(&repo.git, &repo.root())
            .expect("status")
            .in_progress,
        InProgress::Rebasing
    );

    let versions = conflict_versions(&repo.git, &repo.root(), "shared.txt").expect("versions");
    assert!(versions.ours_label.starts_with("Base being rebased onto"));

    resolve_conflict(
        &repo.git,
        &repo.root(),
        "shared.txt",
        None,
        Some(ConflictSide::Theirs),
    )
    .expect("take theirs");
    let done = continue_operation(&repo.git, &repo.root()).expect("continue");
    assert_eq!(done.outcome, IntegrationOutcome::Completed);
    assert_eq!(repo.read("shared.txt"), "feature\n");
    assert_eq!(
        repo.git_ok(&["rev-list", "--count", "HEAD"]).trim(),
        "3",
        "linear history"
    );
}

#[test]
fn cherry_pick_and_revert() {
    let repo: TestRepo = diverged_repo(false);
    let feature_commit: String = repo.git_ok(&["rev-parse", "feature"]).trim().to_owned();
    let picked = cherry_pick(&repo.git, &repo.root(), &[feature_commit]).expect("pick");
    assert_eq!(picked.outcome, IntegrationOutcome::Completed);
    assert_eq!(repo.read("feature.txt"), "feature\n");

    let head: String = repo.git_ok(&["rev-parse", "HEAD"]).trim().to_owned();
    let reverted = revert_commit(&repo.git, &repo.root(), &head).expect("revert");
    assert_eq!(reverted.outcome, IntegrationOutcome::Completed);
    assert!(!repo.root().join("feature.txt").exists());
}

#[test]
fn reverting_a_merge_commit_uses_the_mainline() {
    let repo: TestRepo = diverged_repo(false);
    merge_branch(&repo.git, &repo.root(), "feature", MergeStrategy::NoFf).expect("merge");
    let merge: String = repo.git_ok(&["rev-parse", "HEAD"]).trim().to_owned();
    let reverted = revert_commit(&repo.git, &repo.root(), &merge).expect("revert merge");
    assert_eq!(reverted.outcome, IntegrationOutcome::Completed);
    assert!(!repo.root().join("feature.txt").exists());
}

#[test]
fn delete_modify_conflict_can_keep_the_deletion() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("shared.txt", "base\n", "base");
    repo.git_ok(&["switch", "-c", "feature"]);
    repo.commit_file("shared.txt", "feature\n", "edit on feature");
    repo.git_ok(&["switch", "main"]);
    repo.git_ok(&["rm", "--quiet", "--", "shared.txt"]);
    repo.git_ok(&["commit", "-m", "delete on main"]);
    let result = merge_branch(&repo.git, &repo.root(), "feature", MergeStrategy::Default)
        .expect("merge runs");
    assert_eq!(result.outcome, IntegrationOutcome::Conflicts);

    let versions = conflict_versions(&repo.git, &repo.root(), "shared.txt").expect("versions");
    assert_eq!(versions.ours, None);
    let status = resolve_conflict(
        &repo.git,
        &repo.root(),
        "shared.txt",
        None,
        Some(ConflictSide::Ours),
    )
    .expect("keep the deletion");
    assert!(status.files.iter().all(|file| !file.conflicted));
    assert!(!repo.root().join("shared.txt").exists());
    let done = continue_operation(&repo.git, &repo.root()).expect("continue");
    assert_eq!(done.outcome, IntegrationOutcome::Completed);
}

#[test]
fn skip_drops_a_cherry_pick_that_resolved_to_nothing() {
    let repo: TestRepo = diverged_repo(true);
    let feature_commit: String = repo.git_ok(&["rev-parse", "feature"]).trim().to_owned();
    let picked = cherry_pick(&repo.git, &repo.root(), &[feature_commit]).expect("pick runs");
    assert_eq!(picked.outcome, IntegrationOutcome::Conflicts);
    let head: String = repo.git_ok(&["rev-parse", "HEAD"]);

    // Keeping our side leaves the pick with nothing to commit.
    resolve_conflict(
        &repo.git,
        &repo.root(),
        "shared.txt",
        None,
        Some(ConflictSide::Ours),
    )
    .expect("take ours");
    let skipped = skip_operation(&repo.git, &repo.root()).expect("skip");
    assert_eq!(skipped.status.in_progress, InProgress::None);
    assert_eq!(repo.git_ok(&["rev-parse", "HEAD"]), head);

    merge_branch(&repo.git, &repo.root(), "feature", MergeStrategy::Default).expect("merge");
    assert!(matches!(
        skip_operation(&repo.git, &repo.root()),
        Err(GitError::InvalidRequest(_))
    ));
}

#[test]
fn log_lists_the_commits_of_a_range() {
    let repo: TestRepo = diverged_repo(false);
    let page = log_page(
        &repo.git,
        &repo.root(),
        &LogQuery {
            revisions: Some(vec!["main..feature".to_owned()]),
            ..query(10)
        },
    )
    .expect("range log");
    let summaries: Vec<&str> = page
        .commits
        .iter()
        .map(|commit| commit.summary.as_str())
        .collect();
    assert_eq!(summaries, ["feature change"]);
}
