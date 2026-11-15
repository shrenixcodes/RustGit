use std::sync::Arc;

use rustgit_git_engine::GitExecutor;

use rustgit_core::{CommandError, CommandResult, Database, RepositoryLocks};

/// Shared application state managed by Tauri.
pub struct AppState {
    pub git: GitExecutor,
    pub database: Arc<Database>,
    pub locks: RepositoryLocks,
}

impl AppState {
    pub fn new(git: GitExecutor, database: Database) -> Self {
        Self {
            git,
            database: Arc::new(database),
            locks: RepositoryLocks::default(),
        }
    }
}

/// Runs blocking work (Git processes, SQLite) off the async runtime threads.
pub async fn blocking<T, F>(work: F) -> CommandResult<T>
where
    F: FnOnce() -> CommandResult<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| CommandError::internal(format!("background task failed: {error}")))?
}
