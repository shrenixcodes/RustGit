use std::path::{Path, PathBuf};
use std::sync::Arc;

use rustgit_git_engine::{GitExecutor, RepositoryLocation, StatusSnapshot};
use tauri::{AppHandle, Emitter, State};

use crate::state::{AppState, blocking};
use rustgit_core::watcher::ChangeSink;
use rustgit_core::{CommandError, CommandResult, Database, RepositoryChanged, RepositoryEntry};

const DEFAULT_INITIAL_BRANCH: &str = "main";

#[tauri::command]
pub async fn list_repositories(state: State<'_, AppState>) -> CommandResult<Vec<RepositoryEntry>> {
    let database: Arc<Database> = Arc::clone(&state.database);
    blocking(move || Ok(database.list_repositories()?)).await
}

/// Registers the repository containing `path` (any directory inside it).
#[tauri::command]
pub async fn add_repository(
    state: State<'_, AppState>,
    path: String,
) -> CommandResult<RepositoryEntry> {
    let git: GitExecutor = state.git.clone();
    let database: Arc<Database> = Arc::clone(&state.database);
    blocking(move || {
        let location: RepositoryLocation = rustgit_git_engine::discover(&git, Path::new(&path))?;
        register(&database, &location)
    })
    .await
}

/// Runs `git init` in `path` (creating it if needed) and registers the result.
#[tauri::command]
pub async fn init_repository(
    state: State<'_, AppState>,
    path: String,
    description: Option<String>,
    readme: Option<bool>,
    gitignore: Option<String>,
    license: Option<String>,
) -> CommandResult<RepositoryEntry> {
    let git: GitExecutor = state.git.clone();
    let database: Arc<Database> = Arc::clone(&state.database);
    blocking(move || {
        let options = rustgit_git_engine::InitOptions {
            initial_branch: Some(DEFAULT_INITIAL_BRANCH.to_owned()),
            description,
            readme: readme.unwrap_or(false),
            gitignore_template: gitignore,
            license_template: license,
        };
        let location: RepositoryLocation =
            rustgit_git_engine::init_with_options(&git, Path::new(&path), &options)?;
        register(&database, &location)
    })
    .await
}

/// Validates that a registered repository still exists and marks it as opened.
#[tauri::command]
pub async fn open_repository(
    state: State<'_, AppState>,
    id: i64,
) -> CommandResult<RepositoryEntry> {
    let git: GitExecutor = state.git.clone();
    let database: Arc<Database> = Arc::clone(&state.database);
    blocking(move || {
        let entry: RepositoryEntry = database.get_repository(id)?;
        rustgit_git_engine::discover(&git, Path::new(&entry.path))?;
        Ok(database.touch_repository(id)?)
    })
    .await
}

#[tauri::command]
pub async fn set_repository_pinned(
    state: State<'_, AppState>,
    id: i64,
    pinned: bool,
) -> CommandResult<RepositoryEntry> {
    let database: Arc<Database> = Arc::clone(&state.database);
    blocking(move || Ok(database.set_repository_pinned(id, pinned)?)).await
}

/// Removes the repository from RustGit's list. Files on disk are not touched.
#[tauri::command]
pub async fn remove_repository(state: State<'_, AppState>, id: i64) -> CommandResult<()> {
    let database: Arc<Database> = Arc::clone(&state.database);
    blocking(move || Ok(database.remove_repository(id)?)).await?;
    state.locks.forget(id);
    state.watchers.unwatch(id);
    Ok(())
}

#[tauri::command]
pub async fn repository_status(
    state: State<'_, AppState>,
    id: i64,
) -> CommandResult<StatusSnapshot> {
    let _guard = state.locks.read(id).await;
    let git: GitExecutor = state.git.clone();
    let database: Arc<Database> = Arc::clone(&state.database);
    blocking(move || {
        let entry: RepositoryEntry = database.get_repository(id)?;
        Ok(rustgit_git_engine::read_status(
            &git,
            Path::new(&entry.path),
        )?)
    })
    .await
}

pub(crate) fn register(
    database: &Database,
    location: &RepositoryLocation,
) -> CommandResult<RepositoryEntry> {
    let root: &PathBuf = &location.root;
    let name: String = root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string_lossy().into_owned());
    Ok(database.upsert_repository(&root.to_string_lossy(), &name)?)
}

pub const REPOSITORY_CHANGED_EVENT: &str = "repository-changed";

/// Starts emitting `repository-changed` for this repository.
#[tauri::command]
pub async fn watch_repository(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> CommandResult<()> {
    let git: GitExecutor = state.git.clone();
    let database: Arc<Database> = Arc::clone(&state.database);
    let location: RepositoryLocation = blocking(move || {
        let entry: RepositoryEntry = database.get_repository(id)?;
        Ok(rustgit_git_engine::discover(&git, Path::new(&entry.path))?)
    })
    .await?;
    let sink: ChangeSink = Arc::new(move |change: RepositoryChanged| {
        if let Err(error) = app.emit(REPOSITORY_CHANGED_EVENT, change) {
            tracing::warn!(%error, "could not emit repository-changed");
        }
    });
    state
        .watchers
        .watch(&state.git, id, &location, sink)
        .map_err(|error| CommandError::internal(error.to_string()))
}

#[tauri::command]
pub fn unwatch_repository(state: State<'_, AppState>, id: i64) {
    state.watchers.unwatch(id);
}
