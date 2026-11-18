use std::sync::Arc;

use rustgit_git_engine::GitExecutor;
use serde::Serialize;
use tauri::State;

use crate::state::{AppState, blocking};
use rustgit_core::{
    CommandError, CommandResult, DEFAULT_REPOSITORY, Database, ErrorKind, Settings,
    ThemePreference, UpdateCheckResult, apply_update, check_for_update as core_check_for_update,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub version: String,
    pub executable: String,
}

/// Reports the Git executable in use, or a `git_not_found` error.
#[tauri::command]
pub async fn git_info(state: State<'_, AppState>) -> CommandResult<GitInfo> {
    let git: GitExecutor = state.git.clone();
    blocking(move || {
        Ok(GitInfo {
            version: git.version()?,
            executable: git.git_path().to_string_lossy().into_owned(),
        })
    })
    .await
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> CommandResult<Settings> {
    let database: Arc<Database> = Arc::clone(&state.database);
    blocking(move || Ok(database.settings()?)).await
}

#[tauri::command]
pub async fn set_theme(
    state: State<'_, AppState>,
    theme: ThemePreference,
) -> CommandResult<Settings> {
    let database: Arc<Database> = Arc::clone(&state.database);
    blocking(move || Ok(database.set_theme(theme)?)).await
}

#[tauri::command]
pub async fn check_for_update(state: State<'_, AppState>) -> CommandResult<UpdateCheckResult> {
    let http = Arc::clone(&state.github.http);
    blocking(move || {
        let current_version = env!("CARGO_PKG_VERSION");
        core_check_for_update(http.as_ref(), DEFAULT_REPOSITORY, current_version)
            .map_err(|e| CommandError::new(ErrorKind::Internal, e.to_string()))
    })
    .await
}

#[tauri::command]
pub async fn install_update(download_url: String, asset_name: String) -> CommandResult<()> {
    blocking(move || {
        apply_update(&download_url, &asset_name)
            .map_err(|e| CommandError::new(ErrorKind::Internal, e.to_string()))
    })
    .await
}
