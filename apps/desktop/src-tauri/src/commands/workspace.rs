//! Stash and worktree commands (C-2).

use std::path::PathBuf;

use rustgit_core::CommandResult;
use rustgit_git_engine::stash::{self, StashDetails, StashEntry};
use rustgit_git_engine::worktree::{self, AddWorktree, Worktree};
use rustgit_git_engine::{DEFAULT_CONTEXT_LINES, FileDiff, IntegrationResult, StatusSnapshot};
use tauri::State;

use super::changes::{read, write};
use crate::state::AppState;

#[tauri::command]
pub async fn list_stashes(state: State<'_, AppState>, id: i64) -> CommandResult<Vec<StashEntry>> {
    read(&state, id, stash::list_stashes).await
}

#[tauri::command]
pub async fn create_stash(
    state: State<'_, AppState>,
    id: i64,
    message: Option<String>,
    include_untracked: bool,
) -> CommandResult<StatusSnapshot> {
    write(&state, id, move |git, root| {
        stash::create_stash(git, root, message.as_deref(), include_untracked)
    })
    .await
}

#[tauri::command]
pub async fn apply_stash(
    state: State<'_, AppState>,
    id: i64,
    oid: String,
    pop: bool,
) -> CommandResult<IntegrationResult> {
    write(&state, id, move |git, root| {
        stash::apply_stash(git, root, &oid, pop)
    })
    .await
}

/// Destructive: the UI confirms first.
#[tauri::command]
pub async fn drop_stash(
    state: State<'_, AppState>,
    id: i64,
    oid: String,
) -> CommandResult<Vec<StashEntry>> {
    write(&state, id, move |git, root| {
        stash::drop_stash(git, root, &oid)
    })
    .await
}

#[tauri::command]
pub async fn stash_details(
    state: State<'_, AppState>,
    id: i64,
    oid: String,
) -> CommandResult<StashDetails> {
    read(&state, id, move |git, root| {
        stash::stash_details(git, root, &oid)
    })
    .await
}

#[tauri::command]
pub async fn stash_file_diff(
    state: State<'_, AppState>,
    id: i64,
    oid: String,
    path: String,
    context_lines: Option<u32>,
) -> CommandResult<FileDiff> {
    read(&state, id, move |git, root| {
        stash::stash_file_diff(
            git,
            root,
            &oid,
            &path,
            context_lines.unwrap_or(DEFAULT_CONTEXT_LINES),
        )
    })
    .await
}

#[tauri::command]
pub async fn list_worktrees(state: State<'_, AppState>, id: i64) -> CommandResult<Vec<Worktree>> {
    read(&state, id, worktree::list_worktrees).await
}

#[tauri::command]
pub async fn add_worktree(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    branch: Option<String>,
    new_branch: Option<String>,
    commit: Option<String>,
) -> CommandResult<Vec<Worktree>> {
    write(&state, id, move |git, root| {
        let path: PathBuf = PathBuf::from(path);
        worktree::add_worktree(
            git,
            root,
            &AddWorktree {
                branch: branch.as_deref(),
                new_branch: new_branch.as_deref(),
                commit: commit.as_deref(),
                ..AddWorktree::at(&path)
            },
        )?;
        worktree::list_worktrees(git, root)
    })
    .await
}

/// `force: true` discards the worktree's changes; the UI confirms first.
#[tauri::command]
pub async fn remove_worktree(
    state: State<'_, AppState>,
    id: i64,
    path: String,
    force: bool,
) -> CommandResult<Vec<Worktree>> {
    write(&state, id, move |git, root| {
        worktree::remove_worktree(git, root, &PathBuf::from(path), force)?;
        worktree::list_worktrees(git, root)
    })
    .await
}

#[tauri::command]
pub async fn prune_worktrees(state: State<'_, AppState>, id: i64) -> CommandResult<Vec<Worktree>> {
    write(&state, id, |git, root| {
        worktree::prune_worktrees(git, root)?;
        worktree::list_worktrees(git, root)
    })
    .await
}
