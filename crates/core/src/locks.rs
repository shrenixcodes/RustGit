use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::{OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock};

/// Per-repository reader/writer locks.
///
/// Reads (status, log, diff) may run concurrently; mutations (stage, commit,
/// checkout, ...) take the write lock so they never overlap with each other or
/// with reads of the same repository. Different repositories never block
/// each other.
#[derive(Default)]
pub struct RepositoryLocks {
    locks: Mutex<HashMap<i64, Arc<RwLock<()>>>>,
}

impl RepositoryLocks {
    fn lock_for(&self, repository_id: i64) -> Arc<RwLock<()>> {
        let mut locks = self
            .locks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Arc::clone(locks.entry(repository_id).or_default())
    }

    pub async fn read(&self, repository_id: i64) -> OwnedRwLockReadGuard<()> {
        self.lock_for(repository_id).read_owned().await
    }

    pub async fn write(&self, repository_id: i64) -> OwnedRwLockWriteGuard<()> {
        self.lock_for(repository_id).write_owned().await
    }

    /// Drops the lock entry for a repository that is no longer tracked.
    pub fn forget(&self, repository_id: i64) {
        if let Ok(mut locks) = self.locks.lock() {
            locks.remove(&repository_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[tokio::test]
    async fn reads_share_and_writes_exclude() {
        let locks: Arc<RepositoryLocks> = Arc::new(RepositoryLocks::default());
        let first_read = locks.read(1).await;
        let _second_read = locks.read(1).await;

        let writer_locks: Arc<RepositoryLocks> = Arc::clone(&locks);
        let writer = tokio::spawn(async move {
            let _guard = writer_locks.write(1).await;
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!writer.is_finished(), "write must wait for readers");

        // Another repository is independent.
        let _other = tokio::time::timeout(Duration::from_millis(100), locks.write(2))
            .await
            .expect("different repository is not blocked");

        drop(first_read);
        drop(_second_read);
        tokio::time::timeout(Duration::from_secs(1), writer)
            .await
            .expect("writer finishes")
            .expect("writer task");
    }
}
