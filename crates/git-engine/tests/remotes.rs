//! Remote configuration and network operations against local `file://` remotes.

mod support;

use std::path::{Path, PathBuf};

use rustgit_git_engine::integrate::IntegrationOutcome;
use rustgit_git_engine::remote::{
    Progress, PullMode, PushRequest, add_remote, clone, delete_remote_branch, fetch, list_remotes,
    pull, pull_fetch, pull_integrate, push, remove_remote, set_remote_url,
};
use rustgit_git_engine::{CancelToken, GitError, list_refs};
use support::{TestRepo, run_git};

fn file_url(path: &Path) -> String {
    let normalized: String = path.to_string_lossy().replace('\\', "/");
    if normalized.starts_with('/') {
        format!("file://{normalized}")
    } else {
        format!("file:///{normalized}")
    }
}

/// A bare "server" repository plus a working clone pushed to it.
struct Network {
    repo: TestRepo,
    bare: PathBuf,
}

fn network() -> Network {
    let repo: TestRepo = TestRepo::new();
    let bare: PathBuf = repo.dir.path().join("server.git");
    run_git(
        &repo.git,
        repo.dir.path(),
        &[
            "init",
            "--bare",
            "--initial-branch=main",
            bare.to_str().expect("utf8"),
        ],
    );
    repo.commit_file("a.txt", "1\n", "initial");
    repo.git_ok(&["remote", "add", "origin", &file_url(&bare)]);
    repo.git_ok(&["push", "--set-upstream", "origin", "main"]);
    Network { repo, bare }
}

fn second_clone(network: &Network, name: &str) -> PathBuf {
    let target: PathBuf = network.repo.dir.path().join(name);
    run_git(
        &network.repo.git,
        network.repo.dir.path(),
        &[
            "clone",
            &file_url(&network.bare),
            target.to_str().expect("utf8"),
        ],
    );
    for (key, value) in [
        ("user.name", "Other"),
        ("user.email", "other@rustgit.invalid"),
    ] {
        run_git(&network.repo.git, &target, &["config", key, value]);
    }
    target
}

#[test]
fn remote_configuration_redacts_credentials() {
    let repo: TestRepo = TestRepo::new();
    add_remote(
        &repo.git,
        &repo.root(),
        "origin",
        "https://user:s3cret@example.com/r.git",
    )
    .expect("add");
    set_remote_url(
        &repo.git,
        &repo.root(),
        "origin",
        "https://example.com/push.git",
        true,
    )
    .expect("push url");
    let remotes = list_remotes(&repo.git, &repo.root()).expect("list");
    assert_eq!(remotes.len(), 1);
    assert_eq!(
        remotes[0].fetch_url.as_deref(),
        Some("https://***@example.com/r.git")
    );
    assert_eq!(
        remotes[0].push_url.as_deref(),
        Some("https://example.com/push.git")
    );

    assert!(matches!(
        add_remote(&repo.git, &repo.root(), "-x", "https://example.com/r.git"),
        Err(GitError::InvalidRequest(_))
    ));
    assert!(matches!(
        add_remote(&repo.git, &repo.root(), "evil", "--upload-pack=touch pwned"),
        Err(GitError::InvalidRequest(_))
    ));
    remove_remote(&repo.git, &repo.root(), "origin").expect("remove");
    assert!(
        list_remotes(&repo.git, &repo.root())
            .expect("list")
            .is_empty()
    );
}

#[test]
fn fetch_reports_git_progress_and_updates_refs() {
    let network: Network = network();
    let other: PathBuf = second_clone(&network, "other");
    std::fs::write(other.join("b.txt"), "b\n").expect("write");
    run_git(&network.repo.git, &other, &["add", "b.txt"]);
    run_git(&network.repo.git, &other, &["commit", "-m", "from other"]);
    run_git(&network.repo.git, &other, &["push"]);

    let mut reports: Vec<Progress> = Vec::new();
    fetch(
        &network.repo.git,
        &network.repo.root(),
        Some("origin"),
        true,
        &CancelToken::default(),
        &mut |progress: Progress| reports.push(progress),
    )
    .expect("fetch");
    let refs = list_refs(&network.repo.git, &network.repo.root()).expect("refs");
    let main = refs
        .refs
        .iter()
        .find(|r| r.short_name == "main")
        .expect("main");
    assert_eq!((main.ahead, main.behind), (Some(0), Some(1)));
    assert!(
        reports.iter().all(|report| report.current <= report.total),
        "{reports:?}"
    );
}

#[test]
fn pull_modes() {
    let network: Network = network();
    let other: PathBuf = second_clone(&network, "other");
    std::fs::write(other.join("b.txt"), "b\n").expect("write");
    run_git(&network.repo.git, &other, &["add", "b.txt"]);
    run_git(&network.repo.git, &other, &["commit", "-m", "remote work"]);
    run_git(&network.repo.git, &other, &["push"]);

    let ff = pull(
        &network.repo.git,
        &network.repo.root(),
        PullMode::FfOnly,
        &CancelToken::default(),
        &mut |_| {},
    )
    .expect("ff pull");
    assert_eq!(ff.outcome, IntegrationOutcome::FastForward);
    assert!(network.repo.root().join("b.txt").is_file());

    // Diverge: local and remote both commit; ff-only must refuse, rebase works.
    std::fs::write(other.join("c.txt"), "c\n").expect("write");
    run_git(&network.repo.git, &other, &["add", "c.txt"]);
    run_git(
        &network.repo.git,
        &other,
        &["commit", "-m", "more remote work"],
    );
    run_git(&network.repo.git, &other, &["push"]);
    network.repo.commit_file("local.txt", "l\n", "local work");

    let refused = pull(
        &network.repo.git,
        &network.repo.root(),
        PullMode::FfOnly,
        &CancelToken::default(),
        &mut |_| {},
    );
    assert!(
        matches!(refused, Err(GitError::CommandFailed { .. })),
        "{refused:?}"
    );

    let rebased = pull(
        &network.repo.git,
        &network.repo.root(),
        PullMode::Rebase,
        &CancelToken::default(),
        &mut |_| {},
    )
    .expect("rebase pull");
    assert_eq!(rebased.outcome, IntegrationOutcome::Completed);
    assert!(network.repo.root().join("c.txt").is_file());
    assert_eq!(
        network
            .repo
            .git_ok(&["rev-list", "--count", "--merges", "HEAD"])
            .trim(),
        "0"
    );
}

#[test]
fn pull_without_upstream_is_rejected() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("a.txt", "a\n", "initial");
    let result = pull(
        &repo.git,
        &repo.root(),
        PullMode::Merge,
        &CancelToken::default(),
        &mut |_| {},
    );
    assert!(
        matches!(result, Err(GitError::InvalidRequest(_))),
        "{result:?}"
    );
}

#[test]
fn push_new_branch_rejection_and_force_with_lease() {
    let network: Network = network();
    network.repo.git_ok(&["switch", "-c", "topic"]);
    network.repo.commit_file("t.txt", "t\n", "topic");
    push(
        &network.repo.git,
        &network.repo.root(),
        &PushRequest {
            remote: Some("origin"),
            branch: Some("topic"),
            set_upstream: true,
            force_with_lease: false,
        },
        &mut |_| {},
    )
    .expect("publish branch");
    let refs = list_refs(&network.repo.git, &network.repo.root()).expect("refs");
    let topic = refs
        .refs
        .iter()
        .find(|r| r.short_name == "topic")
        .expect("topic");
    assert_eq!(topic.upstream.as_deref(), Some("origin/topic"));

    // Rewrite history locally: a normal push is rejected, force-with-lease succeeds.
    network
        .repo
        .git_ok(&["commit", "--amend", "-m", "topic rewritten"]);
    let rejected = push(
        &network.repo.git,
        &network.repo.root(),
        &PushRequest::default(),
        &mut |_| {},
    );
    assert!(
        matches!(rejected, Err(GitError::CommandFailed { .. })),
        "{rejected:?}"
    );
    push(
        &network.repo.git,
        &network.repo.root(),
        &PushRequest {
            force_with_lease: true,
            ..PushRequest::default()
        },
        &mut |_| {},
    )
    .expect("force with lease");

    delete_remote_branch(
        &network.repo.git,
        &network.repo.root(),
        "origin",
        "topic",
        &mut |_| {},
    )
    .expect("delete remote branch");
    let remote_branches: String = run_git(&network.repo.git, &network.bare, &["branch", "--list"]);
    assert!(!remote_branches.contains("topic"), "{remote_branches}");
}

#[test]
fn clone_registers_progress_and_refuses_non_empty_targets() {
    let network: Network = network();
    let parent: PathBuf = network.repo.dir.path().join("clones");
    std::fs::create_dir(&parent).expect("mkdir");
    let mut reports: usize = 0;
    let location = clone(
        &network.repo.git,
        &file_url(&network.bare),
        &parent,
        None,
        &CancelToken::default(),
        &mut |_| reports += 1,
    )
    .expect("clone");
    assert!(location.root.ends_with("server"), "{:?}", location.root);
    assert!(parent.join("server/a.txt").is_file());

    let again = clone(
        &network.repo.git,
        &file_url(&network.bare),
        &parent,
        Some("server"),
        &CancelToken::default(),
        &mut |_| {},
    );
    assert!(
        matches!(again, Err(GitError::InvalidRequest(_))),
        "{again:?}"
    );
}

#[test]
fn failed_clone_cleans_up() {
    let repo: TestRepo = TestRepo::new();
    let missing: String = file_url(&repo.dir.path().join("does-not-exist.git"));
    let result = clone(
        &repo.git,
        &missing,
        repo.dir.path(),
        Some("target"),
        &CancelToken::default(),
        &mut |_| {},
    );
    assert!(result.is_err());
    assert!(!repo.dir.path().join("target").exists());
}

#[test]
fn pull_refuses_to_integrate_after_a_branch_switch() {
    let network: Network = network();
    let fetched = pull_fetch(
        &network.repo.git,
        &network.repo.root(),
        &CancelToken::default(),
        &mut |_| {},
    )
    .expect("fetch phase");
    network.repo.git_ok(&["switch", "-c", "elsewhere"]);
    let refused = pull_integrate(
        &network.repo.git,
        &network.repo.root(),
        PullMode::Merge,
        &fetched,
    );
    assert!(
        matches!(refused, Err(GitError::InvalidRequest(_))),
        "{refused:?}"
    );
}
