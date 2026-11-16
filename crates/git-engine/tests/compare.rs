//! Comparing two revisions (R-16) against real repositories.

mod support;

use rustgit_git_engine::{ChangeKind, GitError, compare_file_diff, compare_revisions};
use support::TestRepo;

/// main: base -> m1 (edits shared.txt); topic (from base): t1 (adds topic.txt), t2.
fn diverged() -> TestRepo {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("shared.txt", "one\n", "base");
    repo.git_ok(&["branch", "topic"]);
    repo.commit_file("shared.txt", "one\ntwo\n", "m1");
    repo.git_ok(&["switch", "-q", "topic"]);
    repo.commit_file("topic.txt", "t\n", "t1");
    repo.commit_file("topic.txt", "t\nt\n", "t2");
    repo.git_ok(&["switch", "-q", "main"]);
    repo
}

#[test]
fn counts_commits_on_each_side() {
    let repo: TestRepo = diverged();
    let comparison =
        compare_revisions(&repo.git, &repo.root(), "main", "topic", true).expect("compare");
    assert_eq!(comparison.ahead, 2);
    assert_eq!(comparison.behind, 1);
    assert_eq!(comparison.base, repo.git_ok(&["rev-parse", "main"]).trim());
    assert_eq!(comparison.head, repo.git_ok(&["rev-parse", "topic"]).trim());
    assert_eq!(
        comparison.merge_base.as_deref(),
        Some(repo.git_ok(&["merge-base", "main", "topic"]).trim())
    );
}

#[test]
fn three_dot_lists_only_head_side_changes() {
    let repo: TestRepo = diverged();
    let comparison =
        compare_revisions(&repo.git, &repo.root(), "main", "topic", true).expect("compare");
    assert_eq!(comparison.files.len(), 1);
    assert_eq!(comparison.files[0].path, "topic.txt");
    assert_eq!(comparison.files[0].kind, ChangeKind::Added);
    assert_eq!(comparison.files[0].additions, Some(2));
}

#[test]
fn two_dot_compares_the_trees_directly() {
    let repo: TestRepo = diverged();
    let comparison =
        compare_revisions(&repo.git, &repo.root(), "main", "topic", false).expect("compare");
    assert!(comparison.merge_base.is_none());
    let mut paths: Vec<&str> = comparison
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect();
    paths.sort_unstable();
    assert_eq!(paths, ["shared.txt", "topic.txt"]);

    let diff = compare_file_diff(
        &repo.git,
        &repo.root(),
        "main",
        "topic",
        false,
        "shared.txt",
        None,
        3,
    )
    .expect("diff");
    assert_eq!(diff.path, "shared.txt");
    assert!(!diff.hunks.is_empty());
}

#[test]
fn unknown_revisions_name_the_side() {
    let repo: TestRepo = diverged();
    let error =
        compare_revisions(&repo.git, &repo.root(), "main", "nope", true).expect_err("unknown");
    match error {
        GitError::InvalidRequest(message) => {
            assert!(message.contains("head revision 'nope'"), "{message}")
        }
        other => panic!("unexpected error {other:?}"),
    }
    assert!(matches!(
        compare_revisions(&repo.git, &repo.root(), "--output=x", "main", true),
        Err(GitError::InvalidRequest(_))
    ));
}
