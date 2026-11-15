//! Staging, diff and commit commands (API contract C-1).
//!
//! Mutations hold the repository write lock for the whole operation including
//! the status read that follows, so the returned snapshot reflects exactly
//! the state after this mutation.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use rustgit_core::{CommandResult, Database, RepositoryEntry, owning_repository};
use rustgit_git_engine::{
    ChangeTotals, CommandRecord, CommitContext, CreatedCommit, DEFAULT_CONTEXT_LINES, DiffRequest,
    DiffSide, FileDiff, GitExecutor, GitResult, HunkAction, HunkRequest, StatusSnapshot,
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
pub(crate) async fn mutate<F>(
    state: &AppState,
    id: i64,
    operation: F,
) -> CommandResult<StatusSnapshot>
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
pub(crate) async fn read<T, F>(state: &AppState, id: i64, operation: F) -> CommandResult<T>
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

pub(crate) fn repository_root(database: &Database, id: i64) -> CommandResult<PathBuf> {
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
    context_lines: Option<u32>,
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
                context_lines: context_lines.unwrap_or(DEFAULT_CONTEXT_LINES),
            },
        )
    })
    .await
}

#[tauri::command]
#[expect(
    clippy::too_many_arguments,
    reason = "each parameter is a top-level IPC field; a struct would nest the wire format"
)]
pub async fn apply_hunk(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    side: DiffSide,
    action: HunkAction,
    hunk_header: String,
    line_indices: Option<Vec<usize>>,
    context_lines: Option<u32>,
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
                context_lines: context_lines.unwrap_or(DEFAULT_CONTEXT_LINES),
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
pub async fn commit_context(state: State<'_, AppState>, id: i64) -> CommandResult<CommitContext> {
    read(&state, id, rustgit_git_engine::commit_context).await
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

/// A command record attributed to the registered repository it ran in.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    #[serde(flatten)]
    pub record: CommandRecord,
    pub repository_id: Option<i64>,
}

#[tauri::command]
pub async fn command_history(
    state: State<'_, AppState>,
    repository_id: Option<i64>,
    since_sequence: Option<u64>,
) -> CommandResult<Vec<HistoryEntry>> {
    let records: Vec<CommandRecord> = state.git.history();
    let database: Arc<Database> = Arc::clone(&state.database);
    blocking(move || {
        let repositories: Vec<RepositoryEntry> = database.list_repositories()?;
        Ok(records
            .into_iter()
            .filter(|record: &CommandRecord| {
                since_sequence.is_none_or(|since| record.sequence > since)
            })
            .map(|record: CommandRecord| HistoryEntry {
                repository_id: owning_repository(&repositories, &record.cwd),
                record,
            })
            .filter(|entry: &HistoryEntry| {
                repository_id.is_none() || entry.repository_id == repository_id
            })
            .collect())
    })
    .await
}
