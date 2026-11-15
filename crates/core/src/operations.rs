//! Registry of running long operations (clone, fetch, pull, push) so they
//! can be cancelled by id and reported exactly once when they finish.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use rustgit_git_engine::CancelToken;
use serde::Serialize;

use crate::error::CommandError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    Clone,
    Fetch,
    Pull,
    Push,
    DeleteRemoteBranch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationOutcome {
    Succeeded,
    Failed,
    Cancelled,
}

/// Payload of the `operation-progress` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationProgress {
    pub operation_id: String,
    pub repository_id: Option<i64>,
    pub kind: OperationKind,
    pub phase: String,
    pub progress: Option<ProgressCounts>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ProgressCounts {
    pub current: u64,
    pub total: u64,
}

/// Payload of the `operation-finished` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationFinished {
    pub operation_id: String,
    pub repository_id: Option<i64>,
    pub outcome: OperationOutcome,
    pub error: Option<CommandError>,
}

/// Response of every `start_*` command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationStarted {
    pub operation_id: String,
}

#[derive(Default)]
pub struct OperationRegistry {
    next: AtomicU64,
    running: Mutex<HashMap<String, CancelToken>>,
}

impl OperationRegistry {
    /// Registers a new operation and returns its id and cancel token.
    pub fn start(&self, token: CancelToken) -> String {
        let id: String = format!("op-{}", self.next.fetch_add(1, Ordering::SeqCst) + 1);
        if let Ok(mut running) = self.running.lock() {
            running.insert(id.clone(), token);
        }
        id
    }

    /// Requests cancellation. `false` when the operation is unknown, already
    /// finished, or past the point where it can be cancelled.
    pub fn cancel(&self, operation_id: &str) -> bool {
        self.running
            .lock()
            .ok()
            .and_then(|running| running.get(operation_id).map(CancelToken::cancel))
            .unwrap_or(false)
    }

    pub fn finish(&self, operation_id: &str) {
        if let Ok(mut running) = self.running.lock() {
            running.remove(operation_id);
        }
    }

    pub fn is_running(&self, operation_id: &str) -> bool {
        self.running
            .lock()
            .map(|running| running.contains_key(operation_id))
            .unwrap_or(false)
    }
}

/// Limits progress events to one per interval, but always lets a new phase
/// or a completed phase through.
pub struct ProgressThrottle {
    interval: Duration,
    last_emit: Option<Instant>,
    last_phase: String,
}

impl ProgressThrottle {
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            last_emit: None,
            last_phase: String::new(),
        }
    }

    pub fn should_emit(
        &mut self,
        phase: &str,
        counts: Option<ProgressCounts>,
        now: Instant,
    ) -> bool {
        let phase_changed: bool = phase != self.last_phase;
        let complete: bool = counts.is_some_and(|counts| counts.current >= counts.total);
        let due: bool = self
            .last_emit
            .is_none_or(|last: Instant| now.duration_since(last) >= self.interval);
        if phase_changed || complete || due {
            self.last_emit = Some(now);
            phase.clone_into(&mut self.last_phase);
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_by_id_and_finish() {
        let registry: OperationRegistry = OperationRegistry::default();
        let token: CancelToken = CancelToken::default();
        let id: String = registry.start(token.clone());
        assert!(registry.is_running(&id));
        assert!(registry.cancel(&id));
        assert!(token.is_cancelled());
        registry.finish(&id);
        assert!(
            !registry.cancel(&id),
            "finished operations cannot be cancelled"
        );
        assert!(!registry.cancel("op-unknown"));
    }

    #[test]
    fn uncancellable_operations_report_false() {
        let registry: OperationRegistry = OperationRegistry::default();
        let id: String = registry.start(CancelToken::uncancellable());
        assert!(!registry.cancel(&id));
    }

    #[test]
    fn ids_are_unique() {
        let registry: OperationRegistry = OperationRegistry::default();
        let first: String = registry.start(CancelToken::default());
        let second: String = registry.start(CancelToken::default());
        assert_ne!(first, second);
    }

    #[test]
    fn throttle_limits_rate_but_passes_phase_changes_and_completion() {
        let mut throttle: ProgressThrottle = ProgressThrottle::new(Duration::from_millis(100));
        let start: Instant = Instant::now();
        let counts = |current: u64| Some(ProgressCounts { current, total: 10 });
        assert!(throttle.should_emit("Receiving", counts(1), start));
        assert!(!throttle.should_emit("Receiving", counts(2), start + Duration::from_millis(10)));
        assert!(throttle.should_emit("Receiving", counts(3), start + Duration::from_millis(150)));
        assert!(throttle.should_emit("Resolving", counts(1), start + Duration::from_millis(160)));
        assert!(throttle.should_emit("Resolving", counts(10), start + Duration::from_millis(170)));
    }
}
