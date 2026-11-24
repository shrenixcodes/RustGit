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

/// Opens a github.com page (device sign-in, a release) in the default browser.
/// Anything else is refused, so the webview cannot launch arbitrary programs.
#[tauri::command]
pub fn open_github_page(url: String) -> CommandResult<()> {
    let safe: bool = url.starts_with("https://github.com/")
        && !url
            .chars()
            .any(|c: char| c.is_whitespace() || c.is_control() || c == '"');
    if !safe {
        return Err(CommandError::new(
            ErrorKind::InvalidRequest,
            "only github.com pages can be opened",
        ));
    }
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", url.as_str()]);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(&url);
        command
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(&url);
        command
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|error: std::io::Error| {
            CommandError::new(
                ErrorKind::Internal,
                format!("could not open the browser: {error}"),
            )
        })
}

#[tauri::command]
pub async fn install_update(
    download_url: String,
    asset_name: String,
    asset_digest: Option<String>,
) -> CommandResult<()> {
    blocking(move || {
        apply_update(&download_url, &asset_name, asset_digest.as_deref())
            .map_err(|e| CommandError::new(ErrorKind::Internal, e.to_string()))
    })
    .await
}
