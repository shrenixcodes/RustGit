//! Staging, diff, partial staging and commit tests against real repositories.

mod support;

use rustgit_git_engine::commit::SigningMode;
use rustgit_git_engine::{
    ChangeKind, DiffFileStatus, DiffHunk, DiffLineKind, DiffRequest, DiffSide, FileDiff,
    FileStatus, GitError, HunkAction, HunkRequest, StatusSnapshot, apply_hunk, change_totals,
    commit_context, create_commit, discard_paths, file_diff, read_status, stage_all, stage_paths,
    unstage_all, unstage_paths,
};
use support::TestRepo;

fn paths(values: &[&str]) -> Vec<String> {
    values
        .iter()
        .map(|value: &&str| (*value).to_owned())
        .collect()
}

fn status_of(repo: &TestRepo, path: &str) -> Option<FileStatus> {
    read_status(&repo.git, &repo.root())
        .expect("status")
        .files
        .into_iter()
        .find(|file: &FileStatus| file.path == path)
}

fn diff(repo: &TestRepo, path: &str, side: DiffSide) -> FileDiff {
    file_diff(
        &repo.git,
        &repo.root(),
        &DiffRequest {
            path,
            original_path: None,
            side,
            ignore_whitespace: false,
            context_lines: 3,
        },
    )
    .expect("diff")
}

const TEN_LINES: &str = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";

#[test]
fn stage_and_unstage_individual_paths() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("a.txt", "a\n", "initial");
    repo.write("a.txt", "changed\n");
    repo.write("new file.txt", "new\n");

    stage_paths(&repo.git, &repo.root(), &paths(&["a.txt", "new file.txt"])).expect("stage");
    assert_eq!(
        status_of(&repo, "a.txt").expect("a").staged,
        Some(ChangeKind::Modified)
    );
    assert_eq!(
        status_of(&repo, "new file.txt").expect("n").staged,
        Some(ChangeKind::Added)
    );

    unstage_paths(&repo.git, &repo.root(), &paths(&["a.txt"])).expect("unstage");
    let a: FileStatus = status_of(&repo, "a.txt").expect("a");
    assert_eq!((a.staged, a.unstaged), (None, Some(ChangeKind::Modified)));
    assert_eq!(repo.read("a.txt"), "changed\n", "working tree untouched");
}

#[test]
fn staging_a_deletion() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("gone.txt", "x\n", "initial");
    std::fs::remove_file(repo.root().join("gone.txt")).expect("remove");
    stage_paths(&repo.git, &repo.root(), &paths(&["gone.txt"])).expect("stage");
    assert_eq!(
        status_of(&repo, "gone.txt").expect("gone").staged,
        Some(ChangeKind::Deleted)
    );
}

#[test]
fn paths_are_literal_not_globs() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("keep.txt", "k\n", "initial");
    repo.write("[ab].txt", "literal\n");
    repo.write("a.txt", "glob match\n");

    stage_paths(&repo.git, &repo.root(), &paths(&["[ab].txt"])).expect("stage");
    assert_eq!(
        status_of(&repo, "[ab].txt").expect("lit").staged,
        Some(ChangeKind::Added)
    );
    assert_eq!(
        status_of(&repo, "a.txt").expect("a").staged,
        None,
        "glob must not expand"
    );
}

#[test]
fn unstage_before_first_commit() {
    let repo: TestRepo = TestRepo::new();
    repo.write("first.txt", "1\n");
    stage_paths(&repo.git, &repo.root(), &paths(&["first.txt"])).expect("stage");
    unstage_paths(&repo.git, &repo.root(), &paths(&["first.txt"])).expect("unstage");
    assert_eq!(
        status_of(&repo, "first.txt").expect("f").unstaged,
        Some(ChangeKind::Untracked)
    );
}

#[test]
fn stage_all_and_unstage_all() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("a.txt", "a\n", "initial");
    repo.write("a.txt", "b\n");
    repo.write("b.txt", "b\n");
    stage_all(&repo.git, &repo.root()).expect("stage all");
    let staged: usize = read_status(&repo.git, &repo.root())
        .expect("status")
        .files
        .iter()
        .filter(|file: &&FileStatus| file.staged.is_some())
        .count();
    assert_eq!(staged, 2);

    unstage_all(&repo.git, &repo.root()).expect("unstage all");
    let status: StatusSnapshot = read_status(&repo.git, &repo.root()).expect("status");
    assert!(
        status
            .files
            .iter()
            .all(|file: &FileStatus| file.staged.is_none())
    );
}

#[test]
fn rejects_paths_outside_the_repository() {
    let repo: TestRepo = TestRepo::new();
    for bad in ["../outside.txt", "/etc/passwd", "C:/Windows/win.ini"] {
        let result = stage_paths(&repo.git, &repo.root(), &paths(&[bad]));
        assert!(
            matches!(result, Err(GitError::InvalidRequest(_))),
            "{bad}: {result:?}"
        );
    }
    assert!(matches!(
        discard_paths(&repo.git, &repo.root(), &[]),
        Err(GitError::InvalidRequest(_))
    ));
}

#[test]
fn discard_restores_tracked_deletes_untracked_and_keeps_staged() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("t.txt", "original\n", "initial");
    repo.write("t.txt", "staged\n");
    repo.git_ok(&["add", "t.txt"]);
    repo.write("t.txt", "staged\nunstaged\n");
    repo.write("junk.log", "junk\n");

    discard_paths(&repo.git, &repo.root(), &paths(&["t.txt", "junk.log"])).expect("discard");

    assert_eq!(
        repo.read("t.txt"),
        "staged\n",
        "restored from the index, not HEAD"
    );
    assert!(!repo.root().join("junk.log").exists());
    let t: FileStatus = status_of(&repo, "t.txt").expect("t");
    assert_eq!((t.staged, t.unstaged), (Some(ChangeKind::Modified), None));
}

#[test]
fn diffs_for_each_side_and_untracked_files() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("f.txt", "one\ntwo\n", "initial");
    repo.write("f.txt", "one\nTWO\n");
    repo.git_ok(&["add", "f.txt"]);
    repo.write("f.txt", "one\nTWO\nthree\n");
    repo.write("new.txt", "hello\nworld\n");

    let staged: FileDiff = diff(&repo, "f.txt", DiffSide::Staged);
    assert_eq!((staged.added, staged.deleted), (1, 1));
    assert_eq!(staged.status, DiffFileStatus::Modified);

    let unstaged: FileDiff = diff(&repo, "f.txt", DiffSide::Unstaged);
    assert_eq!((unstaged.added, unstaged.deleted), (1, 0));
    let added_line = unstaged.hunks[0]
        .lines
        .iter()
        .find(|line| line.kind == DiffLineKind::Add)
        .expect("add line");
    assert_eq!(added_line.content, "three");
    assert_eq!(added_line.new_line, Some(3));

    let untracked: FileDiff = diff(&repo, "new.txt", DiffSide::Unstaged);
    assert_eq!(untracked.status, DiffFileStatus::Untracked);
    assert_eq!(untracked.added, 2);
}

#[test]
fn binary_files_are_flagged() {
    let repo: TestRepo = TestRepo::new();
    std::fs::write(repo.root().join("blob.bin"), [0u8, 1, 2, 3, 0, 255]).expect("write");
    repo.git_ok(&["add", "blob.bin"]);
    let staged: FileDiff = diff(&repo, "blob.bin", DiffSide::Staged);
    assert!(staged.binary);
    assert!(staged.hunks.is_empty());
}

fn two_hunk_repo() -> TestRepo {
    let repo: TestRepo = TestRepo::new();
    let original: String = format!("{TEN_LINES}11\n12\n13\n14\n15\n16\n17\n18\n19\n20\n");
    repo.commit_file("f.txt", &original, "initial");
    repo.write(
        "f.txt",
        &original
            .replace("2\n", "two\n")
            .replace("19\n", "nineteen\n"),
    );
    repo
}

#[test]
fn stage_and_unstage_a_single_hunk() {
    let repo: TestRepo = two_hunk_repo();
    let before: FileDiff = diff(&repo, "f.txt", DiffSide::Unstaged);
    assert_eq!(before.hunks.len(), 2);
    let second: String = before.hunks[1].header.clone();

    apply_hunk(
        &repo.git,
        &repo.root(),
        &HunkRequest {
            path: "f.txt",
            side: DiffSide::Unstaged,
            action: HunkAction::Stage,
            hunk_header: &second,
            line_indices: None,
            context_lines: 3,
        },
    )
    .expect("stage hunk");

    let staged: FileDiff = diff(&repo, "f.txt", DiffSide::Staged);
    assert_eq!(staged.hunks.len(), 1);
    assert!(
        staged.hunks[0]
            .lines
            .iter()
            .any(|line| line.content == "nineteen")
    );
    let f: FileStatus = status_of(&repo, "f.txt").expect("f");
    assert!(
        f.staged.is_some() && f.unstaged.is_some(),
        "partially staged"
    );

    let staged_header: String = staged.hunks[0].header.clone();
    apply_hunk(
        &repo.git,
        &repo.root(),
        &HunkRequest {
            path: "f.txt",
            side: DiffSide::Staged,
            action: HunkAction::Unstage,
            hunk_header: &staged_header,
            line_indices: None,
            context_lines: 3,
        },
    )
    .expect("unstage hunk");
    assert_eq!(status_of(&repo, "f.txt").expect("f").staged, None);
}

#[test]
fn stage_selected_lines_only() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("f.txt", "a\nb\nc\nd\n", "initial");
    repo.write("f.txt", "a\nB\nC\nd\n");
    let hunk: DiffHunk = diff(&repo, "f.txt", DiffSide::Unstaged).hunks[0].clone();
    let pick: Vec<usize> = hunk
        .lines
        .iter()
        .enumerate()
        .filter(|(_, line)| matches!(line.content.as_str(), "b" | "B"))
        .map(|(index, _)| index)
        .collect();

    apply_hunk(
        &repo.git,
        &repo.root(),
        &HunkRequest {
            path: "f.txt",
            side: DiffSide::Unstaged,
            action: HunkAction::Stage,
            hunk_header: &hunk.header,
            line_indices: Some(&pick),
            context_lines: 3,
        },
    )
    .expect("stage lines");

    let index_content: String = repo.git_ok(&["show", ":f.txt"]);
    assert_eq!(index_content, "a\nc\nB\nd\n");
    assert_eq!(repo.read("f.txt"), "a\nB\nC\nd\n", "working tree untouched");
}

#[test]
fn discard_selected_lines_only() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("f.txt", "a\nb\nc\n", "initial");
    repo.write("f.txt", "a\nX\nb\nY\nc\n");
    let hunk: DiffHunk = diff(&repo, "f.txt", DiffSide::Unstaged).hunks[0].clone();
    let x: usize = hunk
        .lines
        .iter()
        .position(|line| line.content == "X")
        .expect("X");

    apply_hunk(
        &repo.git,
        &repo.root(),
        &HunkRequest {
            path: "f.txt",
            side: DiffSide::Unstaged,
            action: HunkAction::Discard,
            hunk_header: &hunk.header,
            line_indices: Some(&[x]),
            context_lines: 3,
        },
    )
    .expect("discard line");
    assert_eq!(repo.read("f.txt"), "a\nb\nY\nc\n");
}

#[test]
fn stale_hunks_and_invalid_combinations_are_rejected() {
    let repo: TestRepo = two_hunk_repo();
    let stale = apply_hunk(
        &repo.git,
        &repo.root(),
        &HunkRequest {
            path: "f.txt",
            side: DiffSide::Unstaged,
            action: HunkAction::Stage,
            hunk_header: "@@ -100,3 +100,3 @@",
            line_indices: None,
            context_lines: 3,
        },
    );
    assert!(matches!(stale, Err(GitError::StaleDiff(_))), "{stale:?}");

    let wrong_side = apply_hunk(
        &repo.git,
        &repo.root(),
        &HunkRequest {
            path: "f.txt",
            side: DiffSide::Staged,
            action: HunkAction::Stage,
            hunk_header: "@@ -1 +1 @@",
            line_indices: None,
            context_lines: 3,
        },
    );
    assert!(matches!(wrong_side, Err(GitError::InvalidRequest(_))));
}

#[test]
fn staging_a_hunk_of_an_untracked_file_stages_the_file() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("base.txt", "b\n", "initial");
    repo.write("new.txt", "1\n2\n");
    let header: String = diff(&repo, "new.txt", DiffSide::Unstaged).hunks[0]
        .header
        .clone();
    apply_hunk(
        &repo.git,
        &repo.root(),
        &HunkRequest {
            path: "new.txt",
            side: DiffSide::Unstaged,
            action: HunkAction::Stage,
            hunk_header: &header,
            line_indices: None,
            context_lines: 3,
        },
    )
    .expect("stage untracked");
    assert_eq!(
        status_of(&repo, "new.txt").expect("n").staged,
        Some(ChangeKind::Added)
    );
}

#[test]
fn totals_count_staged_lines() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("f.txt", "a\nb\n", "initial");
    repo.write("f.txt", "a\nB\nc\n");
    repo.git_ok(&["add", "f.txt"]);
    let totals = change_totals(&repo.git, &repo.root(), DiffSide::Staged).expect("totals");
    assert_eq!((totals.added, totals.deleted), (2, 1));
    assert_eq!(totals.files[0].path, "f.txt");
}

#[test]
fn commit_amend_and_context() {
    let repo: TestRepo = TestRepo::new();
    let empty = commit_context(&repo.git, &repo.root()).expect("context");
    assert_eq!(empty.head, None);
    assert_eq!(empty.author_name.as_deref(), Some("RustGit Test"));
    assert_eq!(empty.signing, SigningMode::Off);

    repo.write(
        "a.txt", "a
",
    );
    stage_paths(&repo.git, &repo.root(), &paths(&["a.txt"])).expect("stage");
    let created = create_commit(
        &repo.git,
        &repo.root(),
        "Add a

Body text.",
        false,
    )
    .expect("commit");
    assert_eq!(created.summary, "Add a");
    assert_eq!(created.oid, repo.git_ok(&["rev-parse", "HEAD"]).trim());
    let context = commit_context(&repo.git, &repo.root()).expect("context");
    let head = context.head.expect("head");
    assert_eq!(
        head.message,
        "Add a

Body text."
    );
    assert_eq!(head.summary, "Add a");
    assert_eq!(head.on_upstream, None);

    let amended = create_commit(&repo.git, &repo.root(), "Add file a", true).expect("amend");
    assert_eq!(amended.summary, "Add file a");
    assert_eq!(repo.git_ok(&["rev-list", "--count", "HEAD"]).trim(), "1");
}

#[test]
fn commit_requires_identity() {
    let repo: TestRepo = TestRepo::new();
    repo.git_ok(&["config", "user.email", ""]);
    repo.write(
        "a.txt", "a
",
    );
    stage_paths(&repo.git, &repo.root(), &paths(&["a.txt"])).expect("stage");
    // An empty value counts as missing. (Global config could still supply a
    // value on a developer machine, so only assert the typed error when the
    // effective value is empty.)
    let context = commit_context(&repo.git, &repo.root()).expect("context");
    if context.author_email.is_none() {
        let result = create_commit(&repo.git, &repo.root(), "msg", false);
        assert!(
            matches!(result, Err(GitError::IdentityMissing(_))),
            "{result:?}"
        );
    }
}

#[test]
fn commit_failures_are_reported_with_stderr() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("a.txt", "a\n", "initial");

    let empty = create_commit(&repo.git, &repo.root(), "nothing staged", false);
    assert!(matches!(empty, Err(GitError::NothingToCommit)), "{empty:?}");

    assert!(matches!(
        create_commit(&repo.git, &repo.root(), "   ", false),
        Err(GitError::InvalidRequest(_))
    ));

    let hook = repo.root().join(".git/hooks/pre-commit");
    std::fs::write(&hook, "#!/bin/sh\necho 'blocked by policy' >&2\nexit 1\n").expect("hook");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    }
    repo.write("a.txt", "b\n");
    stage_paths(&repo.git, &repo.root(), &paths(&["a.txt"])).expect("stage");
    let rejected = create_commit(&repo.git, &repo.root(), "should fail", false);
    match rejected {
        Err(GitError::CommandFailed { stderr, .. }) => {
            assert!(stderr.contains("blocked by policy"), "{stderr}")
        }
        other => panic!("expected hook failure, got {other:?}"),
    }
    assert_eq!(
        status_of(&repo, "a.txt").expect("a").staged,
        Some(ChangeKind::Modified),
        "index kept"
    );
}

#[test]
fn commit_context_reports_the_configured_signing_format() {
    let repo: TestRepo = TestRepo::new();
    repo.git_ok(&["config", "commit.gpgSign", "yes"]);
    repo.git_ok(&["config", "gpg.format", "ssh"]);
    let context = commit_context(&repo.git, &repo.root()).expect("context");
    assert_eq!(context.signing, SigningMode::Ssh);

    repo.git_ok(&["config", "commit.gpgSign", "0"]);
    let context = commit_context(&repo.git, &repo.root()).expect("context");
    assert_eq!(context.signing, SigningMode::Off);
}
