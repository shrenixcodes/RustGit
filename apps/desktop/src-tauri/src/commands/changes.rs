//! Staging, diff and commit commands (API contract C-1).
//!
//! Mutations hold the repository write lock for the whole operation including
//! the status read that follows, so the returned snapshot reflects exactly
//! the state after this mutation.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use rustgit_core::{CommandResult, Database};
use rustgit_git_engine::{
    AuthorIdentity, ChangeTotals, CommandRecord, CreatedCommit, DiffRequest, DiffSide, FileDiff,
    GitExecutor, GitResult, HunkAction, HunkRequest, StatusSnapshot,
};
use serde::Serialize;
use tauri::State;

use crate::state::{AppState, blocking};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub oid: String,
    pub summary: String,
    pub status: StatusSnapshot,
}

/// Runs `operation` under the repository write lock and returns the fresh status.
async fn mutate<F>(state: &AppState, id: i64, operation: F) -> CommandResult<StatusSnapshot>
where
    F: FnOnce(&GitExecutor, &Path) -> GitResult<()> + Send + 'static,
{
    let _guard = state.locks.write(id).await;
    let git: GitExecutor = state.git.clone();
    let database: Arc<Database> = Arc::clone(&state.database);
    blocking(move || {
        let root: PathBuf = repository_root(&database, id)?;
        operation(&git, &root)?;
        Ok(rustgit_git_engine::read_status(&git, &root)?)
    })
    .await
}

/// Runs a read-only `operation` under the repository read lock.
async fn read<T, F>(state: &AppState, id: i64, operation: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce(&GitExecutor, &Path) -> GitResult<T> + Send + 'static,
{
    let _guard = state.locks.read(id).await;
    let git: GitExecutor = state.git.clone();
    let database: Arc<Database> = Arc::clone(&state.database);
    blocking(move || {
        let root: PathBuf = repository_root(&database, id)?;
        Ok(operation(&git, &root)?)
    })
    .await
}

fn repository_root(database: &Database, id: i64) -> CommandResult<PathBuf> {
    Ok(PathBuf::from(database.get_repository(id)?.path))
}

#[tauri::command]
pub async fn stage_paths(
    state: State<'_, AppState>,
    id: i64,
    paths: Vec<String>,
) -> CommandResult<StatusSnapshot> {
    mutate(&state, id, move |git, root| {
        rustgit_git_engine::stage_paths(git, root, &paths)
    })
    .await
}

#[tauri::command]
pub async fn unstage_paths(
    state: State<'_, AppState>,
    id: i64,
    paths: Vec<String>,
) -> CommandResult<StatusSnapshot> {
    mutate(&state, id, move |git, root| {
        rustgit_git_engine::unstage_paths(git, root, &paths)
    })
    .await
}

#[tauri::command]
pub async fn stage_all(state: State<'_, AppState>, id: i64) -> CommandResult<StatusSnapshot> {
    mutate(&state, id, rustgit_git_engine::stage_all).await
}

#[tauri::command]
pub async fn unstage_all(state: State<'_, AppState>, id: i64) -> CommandResult<StatusSnapshot> {
    mutate(&state, id, rustgit_git_engine::unstage_all).await
}

/// Destructive: discards unstaged changes. The UI confirms before calling.
#[tauri::command]
pub async fn discard_paths(
    state: State<'_, AppState>,
    id: i64,
    paths: Vec<String>,
) -> CommandResult<StatusSnapshot> {
    tracing::info!(
        repository = id,
        count = paths.len(),
        "discarding unstaged changes"
    );
    mutate(&state, id, move |git, root| {
        rustgit_git_engine::discard_paths(git, root, &paths)
    })
    .await
}

#[tauri::command]
pub async fn file_diff(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    original_path: Option<String>,
    side: DiffSide,
    ignore_whitespace: bool,
) -> CommandResult<FileDiff> {
    read(&state, id, move |git, root| {
        rustgit_git_engine::file_diff(
            git,
            root,
            &DiffRequest {
                path: &path,
                original_path: original_path.as_deref(),
                side,
                ignore_whitespace,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn apply_hunk(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    side: DiffSide,
    action: HunkAction,
    hunk_header: String,
    line_indices: Option<Vec<usize>>,
) -> CommandResult<StatusSnapshot> {
    mutate(&state, id, move |git, root| {
        rustgit_git_engine::apply_hunk(
            git,
            root,
            &HunkRequest {
                path: &path,
                side,
                action,
                hunk_header: &hunk_header,
                line_indices: line_indices.as_deref(),
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn change_totals(
    state: State<'_, AppState>,
    id: i64,
    side: DiffSide,
) -> CommandResult<ChangeTotals> {
    read(&state, id, move |git, root| {
        rustgit_git_engine::change_totals(git, root, side)
    })
    .await
}

#[tauri::command]
pub async fn author_identity(state: State<'_, AppState>, id: i64) -> CommandResult<AuthorIdentity> {
    read(&state, id, rustgit_git_engine::author_identity).await
}

#[tauri::command]
pub async fn last_commit_message(
    state: State<'_, AppState>,
    id: i64,
) -> CommandResult<Option<String>> {
    read(&state, id, rustgit_git_engine::last_commit_message).await
}

#[tauri::command]
pub async fn create_commit(
    state: State<'_, AppState>,
    id: i64,
    message: String,
    amend: bool,
) -> CommandResult<CommitResult> {
    let _guard = state.locks.write(id).await;
    let git: GitExecutor = state.git.clone();
    let database: Arc<Database> = Arc::clone(&state.database);
    blocking(move || {
        let root: PathBuf = repository_root(&database, id)?;
        let created: CreatedCommit =
            rustgit_git_engine::create_commit(&git, &root, &message, amend)?;
        Ok(CommitResult {
            oid: created.oid,
            summary: created.summary,
            status: rustgit_git_engine::read_status(&git, &root)?,
        })
    })
    .await
}

#[tauri::command]
pub fn command_history(state: State<'_, AppState>) -> Vec<CommandRecord> {
    state.git.history()
}
