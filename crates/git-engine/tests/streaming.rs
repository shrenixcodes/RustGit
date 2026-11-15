//! Streaming execution: progress lines and cancellation.

mod support;

use std::time::{Duration, Instant};

use rustgit_git_engine::{CancelToken, GitError};
use support::TestRepo;

#[test]
fn streams_progress_lines_from_git() {
    let repo: TestRepo = TestRepo::new();
    repo.commit_file("a.txt", "a\n", "initial");
    let target = repo.dir.path().join("clone");
    let mut lines: Vec<String> = Vec::new();

    repo.git
        .run_streaming(
            repo.dir.path(),
            [
                "clone",
                "--progress",
                "--no-local",
                repo.root().to_str().expect("utf8"),
                target.to_str().expect("utf8"),
            ],
            &CancelToken::default(),
            &mut |line: &str| lines.push(line.to_owned()),
        )
        .expect("clone");

    assert!(target.join("a.txt").is_file());
    assert!(
        lines.iter().any(|line| line.contains("objects")),
        "expected Git progress output, got {lines:?}"
    );
}

#[test]
fn cancellation_kills_the_process() {
    let repo: TestRepo = TestRepo::new();
    let cancel: CancelToken = CancelToken::default();
    let trigger: CancelToken = cancel.clone();
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        assert!(trigger.cancel(), "an active token accepts cancellation");
    });

    let started: Instant = Instant::now();
    // A shell alias is used only by this test to get a long-running Git process.
    let result = repo.git.run_streaming(
        &repo.root(),
        ["-c", "alias.idle=!sleep 30", "idle"],
        &cancel,
        &mut |_: &str| {},
    );
    canceller.join().expect("canceller");

    assert!(matches!(result, Err(GitError::Cancelled)), "{result:?}");
    assert!(
        started.elapsed() < Duration::from_secs(15),
        "process was not killed promptly"
    );
    let last = repo.git.history().pop().expect("recorded");
    assert_ne!(last.exit_code, Some(0));
}

#[test]
fn records_have_increasing_sequences_and_start_times() {
    let repo: TestRepo = TestRepo::new();
    let history = repo.git.history();
    let sequences: Vec<u64> = history.iter().map(|record| record.sequence).collect();
    assert!(
        sequences.windows(2).all(|pair| pair[0] < pair[1]),
        "{sequences:?}"
    );
    assert!(
        history
            .iter()
            .all(|record| record.started_at > 1_700_000_000_000)
    );
}

#[test]
fn committed_tokens_refuse_cancellation() {
    let token: CancelToken = CancelToken::default();
    assert!(token.commit());
    assert!(!token.cancel());
    assert!(!token.is_cancelled());

    let cancelled: CancelToken = CancelToken::default();
    assert!(cancelled.cancel());
    assert!(
        !cancelled.commit(),
        "a cancelled operation must not start its final step"
    );
    assert!(!CancelToken::uncancellable().cancel());
}
