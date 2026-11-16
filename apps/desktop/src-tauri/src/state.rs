use std::sync::Arc;

use rustgit_git_engine::GitExecutor;

use crate::commands::github::GithubState;

use rustgit_core::{
    CommandError, CommandResult, Database, OperationRegistry, PendingPrompts, RepositoryLocks,
    RepositoryWatchers,
};

/// Shared application state managed by Tauri.
pub struct AppState {
    pub git: GitExecutor,
    pub database: Arc<Database>,
    pub locks: RepositoryLocks,
    pub operations: OperationRegistry,
    pub watchers: RepositoryWatchers,
    pub prompts: Arc<PendingPrompts>,
    pub github: Arc<GithubState>,
}

impl AppState {
    pub fn new(
        git: GitExecutor,
        database: Database,
        prompts: Arc<PendingPrompts>,
        github: Arc<GithubState>,
    ) -> Self {
        Self {
            git,
            database: Arc::new(database),
            locks: RepositoryLocks::default(),
            operations: OperationRegistry::default(),
            watchers: RepositoryWatchers::default(),
            prompts,
            github,
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
