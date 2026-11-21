//! Stash and worktree operations against real repositories.

mod support;

use std::path::PathBuf;

use rustgit_git_engine::integrate::IntegrationOutcome;
use rustgit_git_engine::stash::{
    apply_stash, create_stash, drop_stash, list_stashes, stash_details, stash_file_diff,
};
use rustgit_git_engine::worktree::{
    AddWorktree, add_worktree, list_worktrees, prune_worktrees, remove_worktree,
};
use rustgit_git_engine::{ChangeKind, GitError, InProgress, read_status};
use support::TestRepo;

#[test]
fn stash_lifecycle_with_untracked_files() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("a.txt", "a\n", "initial");
    repo.write("a.txt", "changed\n");
    repo.write("new.txt", "untracked\n");

    let status =
        create_stash(&repo.git, &repo.root(), Some("work in progress"), true).expect("stash");
    assert!(
        status.files.is_empty(),
        "working tree is clean after stashing"
    );

    let stashes = list_stashes(&repo.git, &repo.root()).expect("list");
    assert_eq!(stashes.len(), 1);
    assert!(stashes[0].message.contains("work in progress"));
    let oid: String = stashes[0].oid.clone();

    let details = stash_details(&repo.git, &repo.root(), &oid).expect("details");
    let tracked = details
        .files
        .iter()
        .find(|f| f.path == "a.txt")
        .expect("a.txt");
    assert_eq!(tracked.kind, ChangeKind::Modified);
    let untracked = details
        .files
        .iter()
        .find(|f| f.path == "new.txt")
        .expect("new.txt");
    assert!(untracked.untracked);

    let diff = stash_file_diff(&repo.git, &repo.root(), &oid, "a.txt", 3).expect("diff");
    assert_eq!((diff.added, diff.deleted), (1, 1));
    let new_diff = stash_file_diff(&repo.git, &repo.root(), &oid, "new.txt", 3).expect("new");
    assert_eq!(new_diff.added, 1);

    let applied = apply_stash(&repo.git, &repo.root(), &oid, true).expect("pop");
    assert_eq!(applied.outcome, IntegrationOutcome::Completed);
    assert_eq!(repo.read("a.txt"), "changed\n");
    assert_eq!(repo.read("new.txt"), "untracked\n");
    assert!(
        list_stashes(&repo.git, &repo.root())
            .expect("list")
            .is_empty()
    );

    assert!(matches!(
        apply_stash(&repo.git, &repo.root(), &oid, false),
        Err(GitError::StaleDiff(_))
    ));
}

#[test]
fn stash_requires_changes_and_drop_targets_the_right_entry() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("a.txt", "a\n", "initial");
    assert!(matches!(
        create_stash(&repo.git, &repo.root(), None, false),
        Err(GitError::InvalidRequest(_))
    ));

    repo.write("a.txt", "first\n");
    create_stash(&repo.git, &repo.root(), Some("first"), false).expect("first");
    repo.write("a.txt", "second\n");
    create_stash(&repo.git, &repo.root(), Some("second"), false).expect("second");

    let stashes = list_stashes(&repo.git, &repo.root()).expect("list");
    let first = stashes
        .iter()
        .find(|s| s.message.contains("first"))
        .expect("first");
    let remaining = drop_stash(&repo.git, &repo.root(), &first.oid).expect("drop");
    assert_eq!(remaining.len(), 1);
    assert!(
        remaining[0].message.contains("second"),
        "dropped by id, not position"
    );
}

#[test]
fn stash_apply_conflicts_are_an_outcome() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("a.txt", "base\n", "initial");
    repo.write("a.txt", "stashed\n");
    create_stash(&repo.git, &repo.root(), None, false).expect("stash");
    let oid: String = list_stashes(&repo.git, &repo.root()).expect("list")[0]
        .oid
        .clone();
    repo.commit_file("a.txt", "committed\n", "conflicting change");

    let result = apply_stash(&repo.git, &repo.root(), &oid, true).expect("apply runs");
    assert_eq!(result.outcome, IntegrationOutcome::Conflicts);
    assert_eq!(result.conflicted, ["a.txt"]);
    assert_eq!(
        list_stashes(&repo.git, &repo.root()).expect("list").len(),
        1,
        "pop keeps the stash on conflict"
    );
}

#[test]
fn worktree_lifecycle() {
    let repo: TestRepo = TestRepo::new();
    let head: String = repo.commit_file("a.txt", "a\n", "initial");
    repo.git_ok(&["branch", "existing"]);
    let base: PathBuf = repo.dir.path().to_path_buf();

    add_worktree(
        &repo.git,
        &repo.root(),
        &AddWorktree {
            branch: Some("existing"),
            ..AddWorktree::at(&base.join("wt-existing"))
        },
    )
    .expect("existing branch");
    add_worktree(
        &repo.git,
        &repo.root(),
        &AddWorktree {
            new_branch: Some("feature"),
            commit: Some(&head),
            ..AddWorktree::at(&base.join("wt-new"))
        },
    )
    .expect("new branch");
    add_worktree(
        &repo.git,
        &repo.root(),
        &AddWorktree {
            commit: Some(&head),
            ..AddWorktree::at(&base.join("wt-detached"))
        },
    )
    .expect("detached");

    let worktrees = list_worktrees(&repo.git, &repo.root()).expect("list");
    assert_eq!(worktrees.len(), 4);
    assert!(worktrees[0].is_main);
    assert!(
        worktrees
            .iter()
            .any(|w| w.branch.as_deref() == Some("feature"))
    );
    assert!(worktrees.iter().any(|w| w.detached));

    assert!(matches!(
        remove_worktree(&repo.git, &repo.root(), &repo.root(), false),
        Err(GitError::InvalidRequest(_))
    ));

    std::fs::write(base.join("wt-existing/a.txt"), "dirty\n").expect("dirty");
    let refused = remove_worktree(&repo.git, &repo.root(), &base.join("wt-existing"), false);
    assert!(
        matches!(refused, Err(GitError::CommandFailed { .. })),
        "{refused:?}"
    );
    remove_worktree(&repo.git, &repo.root(), &base.join("wt-existing"), true).expect("force");

    std::fs::remove_dir_all(base.join("wt-detached")).expect("delete dir");
    let stale = list_worktrees(&repo.git, &repo.root()).expect("list");
    assert!(stale.iter().any(|w| w.prunable.is_some()), "{stale:?}");
    prune_worktrees(&repo.git, &repo.root()).expect("prune");
    assert_eq!(
        list_worktrees(&repo.git, &repo.root()).expect("list").len(),
        2
    );
}

#[test]
fn status_detects_a_merge_in_progress_inside_a_linked_worktree() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("a.txt", "base\n", "initial");
    repo.git_ok(&["branch", "other"]);
    repo.commit_file("a.txt", "main\n", "main change");
    let worktree: PathBuf = repo.dir.path().join("wt-other");
    add_worktree(
        &repo.git,
        &repo.root(),
        &AddWorktree {
            branch: Some("other"),
            ..AddWorktree::at(&worktree)
        },
    )
    .expect("add worktree");
    assert!(
        worktree.join(".git").is_file(),
        "linked worktree uses a .git file"
    );

    std::fs::write(worktree.join("a.txt"), "other\n").expect("edit");
    support::run_git(&repo.git, &worktree, &["commit", "-am", "other change"]);
    let merge = repo
        .git
        .run_unchecked(&worktree, ["merge", "main"], None)
        .expect("run merge");
    assert!(!merge.status.success(), "merge should conflict");

    let status = read_status(&repo.git, &worktree).expect("status");
    assert_eq!(status.in_progress, InProgress::Merging);
    let main_status = read_status(&repo.git, &repo.root()).expect("main status");
    assert_eq!(main_status.in_progress, InProgress::None);
}
