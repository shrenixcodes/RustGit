//! History, references, branch operations, integrations and conflicts (C-2).

use rustgit_core::CommandResult;
use rustgit_git_engine::history::LogSearch;
use rustgit_git_engine::integrate::{ConflictSide, MergeStrategy};
use rustgit_git_engine::refs::CheckoutMode;
use rustgit_git_engine::{
    CommitDetails, Comparison, ConflictVersions, DEFAULT_CONTEXT_LINES, FileDiff,
    IntegrationResult, LogPage, LogQuery, RefList, StatusSnapshot,
};
use tauri::State;

use super::changes::{mutate, read, write};
use crate::state::AppState;

#[tauri::command]
#[expect(
    clippy::too_many_arguments,
    reason = "each parameter is a top-level IPC field; a struct would nest the wire format"
)]
pub async fn log_page(
    state: State<'_, AppState>,
    id: i64,
    revisions: Option<Vec<String>>,
    skip: u32,
    limit: u32,
    search: Option<LogSearch>,
    since: Option<i64>,
    until: Option<i64>,
) -> CommandResult<LogPage> {
    let query: LogQuery = LogQuery {
        revisions,
        skip,
        limit,
        search,
        since,
        until,
    };
    read(&state, id, move |git, root| {
        rustgit_git_engine::log_page(git, root, &query)
    })
    .await
}

#[tauri::command]
pub async fn commit_details(
    state: State<'_, AppState>,
    id: i64,
    oid: String,
) -> CommandResult<CommitDetails> {
    read(&state, id, move |git, root| {
        rustgit_git_engine::commit_details(git, root, &oid)
    })
    .await
}

#[tauri::command]
pub async fn commit_file_diff(
    state: State<'_, AppState>,
    id: i64,
    oid: String,
    path: String,
    original_path: Option<String>,
    context_lines: Option<u32>,
) -> CommandResult<FileDiff> {
    read(&state, id, move |git, root| {
        rustgit_git_engine::commit_file_diff(
            git,
            root,
            &oid,
            &path,
            original_path.as_deref(),
            context_lines.unwrap_or(DEFAULT_CONTEXT_LINES),
        )
    })
    .await
}

#[tauri::command]
pub async fn compare_revisions(
    state: State<'_, AppState>,
    id: i64,
    base: String,
    head: String,
    merge_base: bool,
) -> CommandResult<Comparison> {
    read(&state, id, move |git, root| {
        rustgit_git_engine::compare_revisions(git, root, &base, &head, merge_base)
    })
    .await
}

#[tauri::command]
#[expect(
    clippy::too_many_arguments,
    reason = "each parameter is a top-level IPC field; a struct would nest the wire format"
)]
pub async fn compare_file_diff(
    state: State<'_, AppState>,
    id: i64,
    base: String,
    head: String,
    merge_base: bool,
    path: String,
    original_path: Option<String>,
    context_lines: Option<u32>,
) -> CommandResult<FileDiff> {
    read(&state, id, move |git, root| {
        rustgit_git_engine::compare_file_diff(
            git,
            root,
            &base,
            &head,
            merge_base,
            &path,
            original_path.as_deref(),
            context_lines.unwrap_or(DEFAULT_CONTEXT_LINES),
        )
    })
    .await
}

#[tauri::command]
pub async fn list_refs(state: State<'_, AppState>, id: i64) -> CommandResult<RefList> {
    read(&state, id, rustgit_git_engine::list_refs).await
}

#[tauri::command]
pub async fn create_branch(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    start_point: Option<String>,
    checkout: bool,
) -> CommandResult<RefList> {
    write(&state, id, move |git, root| {
        rustgit_git_engine::create_branch(git, root, &name, start_point.as_deref(), checkout)?;
        rustgit_git_engine::list_refs(git, root)
    })
    .await
}

#[tauri::command]
pub async fn checkout_branch(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    mode: CheckoutMode,
) -> CommandResult<StatusSnapshot> {
    mutate(&state, id, move |git, root| {
        rustgit_git_engine::checkout_branch(git, root, &name, mode)
    })
    .await
}

#[tauri::command]
pub async fn rename_branch(
    state: State<'_, AppState>,
    id: i64,
    from: String,
    to: String,
) -> CommandResult<RefList> {
    write(&state, id, move |git, root| {
        rustgit_git_engine::rename_branch(git, root, &from, &to)?;
        rustgit_git_engine::list_refs(git, root)
    })
    .await
}

/// `force: true` deletes unmerged branches; the UI confirms first.
#[tauri::command]
pub async fn delete_branch(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    force: bool,
) -> CommandResult<RefList> {
    write(&state, id, move |git, root| {
        rustgit_git_engine::delete_branch(git, root, &name, force)?;
        rustgit_git_engine::list_refs(git, root)
    })
    .await
}

#[tauri::command]
pub async fn set_upstream(
    state: State<'_, AppState>,
    id: i64,
    branch: String,
    upstream: Option<String>,
) -> CommandResult<RefList> {
    write(&state, id, move |git, root| {
        rustgit_git_engine::set_upstream(git, root, &branch, upstream.as_deref())?;
        rustgit_git_engine::list_refs(git, root)
    })
    .await
}

#[tauri::command]
pub async fn merge_branch(
    state: State<'_, AppState>,
    id: i64,
    source: String,
    strategy: MergeStrategy,
) -> CommandResult<IntegrationResult> {
    write(&state, id, move |git, root| {
        rustgit_git_engine::merge_branch(git, root, &source, strategy)
    })
    .await
}

#[tauri::command]
pub async fn rebase_branch(
    state: State<'_, AppState>,
    id: i64,
    onto: String,
) -> CommandResult<IntegrationResult> {
    write(&state, id, move |git, root| {
        rustgit_git_engine::rebase_branch(git, root, &onto)
    })
    .await
}

#[tauri::command]
pub async fn cherry_pick(
    state: State<'_, AppState>,
    id: i64,
    oids: Vec<String>,
) -> CommandResult<IntegrationResult> {
    write(&state, id, move |git, root| {
        rustgit_git_engine::cherry_pick(git, root, &oids)
    })
    .await
}

#[tauri::command]
pub async fn revert_commit(
    state: State<'_, AppState>,
    id: i64,
    oid: String,
) -> CommandResult<IntegrationResult> {
    write(&state, id, move |git, root| {
        rustgit_git_engine::revert_commit(git, root, &oid)
    })
    .await
}

#[tauri::command]
pub async fn continue_operation(
    state: State<'_, AppState>,
    id: i64,
) -> CommandResult<IntegrationResult> {
    write(&state, id, rustgit_git_engine::continue_operation).await
}

#[tauri::command]
pub async fn abort_operation(state: State<'_, AppState>, id: i64) -> CommandResult<StatusSnapshot> {
    write(&state, id, rustgit_git_engine::abort_operation).await
}

#[tauri::command]
pub async fn conflict_versions(
    state: State<'_, AppState>,
    id: i64,
    path: String,
) -> CommandResult<ConflictVersions> {
    read(&state, id, move |git, root| {
        rustgit_git_engine::conflict_versions(git, root, &path)
    })
    .await
}

#[tauri::command]
pub async fn resolve_conflict(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    content: Option<String>,
    take: Option<ConflictSide>,
) -> CommandResult<StatusSnapshot> {
    write(&state, id, move |git, root| {
        rustgit_git_engine::resolve_conflict(git, root, &path, content.as_deref(), take)
    })
    .await
}
