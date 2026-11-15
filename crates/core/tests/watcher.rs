//! Filesystem watcher against a real repository and the real OS backend.

use std::path::Path;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rustgit_core::watcher::{ChangeScope, RepositoryChanged, RepositoryWatchers};
use rustgit_git_engine::{GitExecutor, RepositoryLocation, discover};

const WAIT: Duration = Duration::from_secs(5);

fn git(executor: &GitExecutor, cwd: &Path, args: &[&str]) {
    executor
        .run(cwd, args, None)
        .unwrap_or_else(|error| panic!("git {args:?}: {error}"));
}

struct Fixture {
    _dir: tempfile::TempDir,
    root: std::path::PathBuf,
    git: GitExecutor,
    location: RepositoryLocation,
}

fn fixture() -> Fixture {
    let dir: tempfile::TempDir = tempfile::tempdir().expect("tempdir");
    let root = dir.path().join("repo");
    std::fs::create_dir_all(root.join("src")).expect("mkdir");
    let executor: GitExecutor = GitExecutor::new("git");
    git(&executor, &root, &["init", "--initial-branch=main"]);
    git(&executor, &root, &["config", "user.name", "Watcher Test"]);
    git(
        &executor,
        &root,
        &["config", "user.email", "watch@rustgit.invalid"],
    );
    git(&executor, &root, &["config", "commit.gpgsign", "false"]);
    std::fs::write(root.join(".gitignore"), "ignored_dir/\n").expect("gitignore");
    std::fs::write(root.join("src/lib.rs"), "1\n").expect("write");
    std::fs::create_dir(root.join("ignored_dir")).expect("mkdir ignored");
    git(&executor, &root, &["add", "."]);
    git(&executor, &root, &["commit", "-m", "initial"]);
    let location: RepositoryLocation = discover(&executor, &root).expect("discover");
    Fixture {
        _dir: dir,
        root,
        git: executor,
        location,
    }
}

fn watch(fixture: &Fixture, watchers: &RepositoryWatchers) -> Receiver<RepositoryChanged> {
    let (sender, receiver): (Sender<RepositoryChanged>, Receiver<RepositoryChanged>) =
        mpsc::channel();
    let sender: Mutex<Sender<RepositoryChanged>> = Mutex::new(sender);
    watchers
        .watch(
            &fixture.git,
            7,
            &fixture.location,
            Arc::new(move |change: RepositoryChanged| {
                let _ = sender.lock().expect("lock").send(change);
            }),
        )
        .expect("watch");
    // Let the OS backend settle before generating events.
    std::thread::sleep(Duration::from_millis(300));
    receiver
}

/// Waits for an event containing `scope`, skipping unrelated ones.
fn expect_scope(receiver: &Receiver<RepositoryChanged>, scope: ChangeScope) -> RepositoryChanged {
    let deadline = std::time::Instant::now() + WAIT;
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        let change: RepositoryChanged = receiver
            .recv_timeout(remaining)
            .unwrap_or_else(|_| panic!("no {scope:?} event within {WAIT:?}"));
        if change.scopes.contains(&scope) {
            return change;
        }
    }
}

fn drain(receiver: &Receiver<RepositoryChanged>) {
    while receiver.recv_timeout(Duration::from_millis(800)).is_ok() {}
}

#[test]
fn reports_worktree_index_and_ref_changes() {
    let fixture: Fixture = fixture();
    let watchers: RepositoryWatchers = RepositoryWatchers::default();
    let receiver = watch(&fixture, &watchers);

    std::fs::write(fixture.root.join("src/lib.rs"), "2\n").expect("edit");
    let change: RepositoryChanged = expect_scope(&receiver, ChangeScope::Worktree);
    assert_eq!(change.repository_id, 7);

    drain(&receiver);
    git(&fixture.git, &fixture.root, &["add", "src/lib.rs"]);
    expect_scope(&receiver, ChangeScope::Index);

    drain(&receiver);
    git(&fixture.git, &fixture.root, &["commit", "-m", "second"]);
    expect_scope(&receiver, ChangeScope::Refs);
}

#[test]
fn ignored_directories_are_not_watched_and_new_directories_are() {
    let fixture: Fixture = fixture();
    let watchers: RepositoryWatchers = RepositoryWatchers::default();
    let receiver = watch(&fixture, &watchers);

    std::fs::write(fixture.root.join("ignored_dir/build.out"), "x\n").expect("write ignored");
    assert!(
        receiver.recv_timeout(Duration::from_millis(1500)).is_err(),
        "changes inside an ignored top-level directory must not emit events"
    );

    std::fs::create_dir(fixture.root.join("docs")).expect("mkdir");
    expect_scope(&receiver, ChangeScope::Worktree);
    drain(&receiver);
    std::fs::write(fixture.root.join("docs/readme.md"), "new\n").expect("write");
    expect_scope(&receiver, ChangeScope::Worktree);
}

#[test]
fn unwatch_stops_events() {
    let fixture: Fixture = fixture();
    let watchers: RepositoryWatchers = RepositoryWatchers::default();
    let receiver = watch(&fixture, &watchers);
    assert!(watchers.is_watching(7));
    watchers.unwatch(7);
    assert!(!watchers.is_watching(7));
    std::fs::write(fixture.root.join("src/lib.rs"), "3\n").expect("edit");
    assert!(receiver.recv_timeout(Duration::from_millis(1500)).is_err());
}
