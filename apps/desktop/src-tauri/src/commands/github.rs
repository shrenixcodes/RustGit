//! GitHub account commands: device-flow sign-in, repository list and creation.
//!
//! The access token lives in the operating system's credential store and is
//! never returned to the webview. Git receives it through the credential
//! prompt broker (see `start_credential_broker`).

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use rustgit_core::github::{
    self, DeviceCode, GithubAccount, GithubError, GithubRepository, Http, TokenStore, UreqHttp,
};
use rustgit_core::{CommandError, CommandResult, ErrorKind};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::{AppState, blocking};

pub const SIGN_IN_EVENT: &str = "github-sign-in-finished";

/// Shared GitHub services.
pub struct GithubState {
    pub http: Arc<dyn Http>,
    pub store: Arc<dyn TokenStore>,
    pub client_id: Option<String>,
    sign_in: std::sync::Mutex<Option<Arc<AtomicBool>>>,
}

impl GithubState {
    pub fn new(store: Arc<dyn TokenStore>) -> Self {
        Self {
            http: Arc::new(UreqHttp::default()),
            store,
            client_id: configured_client_id(),
            sign_in: std::sync::Mutex::new(None),
        }
    }
}

/// The public OAuth client id: set at build time or in the environment.
fn configured_client_id() -> Option<String> {
    std::env::var("RUSTGIT_GITHUB_CLIENT_ID")
        .ok()
        .or_else(|| option_env!("RUSTGIT_GITHUB_CLIENT_ID").map(str::to_owned))
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty())
}

fn command_error(error: GithubError) -> CommandError {
    let kind: ErrorKind = match error {
        GithubError::Unauthorized | GithubError::Denied => ErrorKind::AuthenticationFailed,
        GithubError::Cancelled => ErrorKind::OperationCancelled,
        GithubError::Rejected(_) | GithubError::Expired => ErrorKind::InvalidRequest,
        _ => ErrorKind::Internal,
    };
    CommandError::new(kind, error.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    /// False when this build has no OAuth client id, so sign-in is unavailable.
    pub configured: bool,
    pub account: Option<GithubAccount>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInFinished {
    pub account: Option<GithubAccount>,
    pub error: Option<String>,
}

fn stored_token(github: &GithubState) -> CommandResult<String> {
    github.store.load().map_err(command_error)?.ok_or_else(|| {
        CommandError::new(ErrorKind::AuthenticationFailed, "not signed in to GitHub")
    })
}

/// Runs a GitHub call with the stored token; a rejected token is forgotten.
fn with_token<T>(
    github: &GithubState,
    call: impl FnOnce(&dyn Http, &str) -> Result<T, GithubError>,
) -> CommandResult<T> {
    let token: String = stored_token(github)?;
    match call(github.http.as_ref(), &token) {
        Err(GithubError::Unauthorized) => {
            let _ = github.store.clear();
            Err(command_error(GithubError::Unauthorized))
        }
        other => other.map_err(command_error),
    }
}

#[tauri::command]
pub async fn github_status(state: State<'_, AppState>) -> CommandResult<GithubStatus> {
    let github: Arc<GithubState> = Arc::clone(&state.github);
    blocking(move || {
        let configured: bool = github.client_id.is_some();
        if github.store.load().map_err(command_error)?.is_none() {
            return Ok(GithubStatus {
                configured,
                account: None,
            });
        }
        let account: GithubAccount =
            with_token(&github, |http, token| github::current_account(http, token))?;
        Ok(GithubStatus {
            configured,
            account: Some(account),
        })
    })
    .await
}

/// Starts the device flow: returns the code to show, then finishes in the
/// background and emits `github-sign-in-finished`.
#[tauri::command]
pub async fn github_start_sign_in(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<DeviceCode> {
    let github: Arc<GithubState> = Arc::clone(&state.github);
    let client_id: String = github.client_id.clone().ok_or_else(|| {
        CommandError::new(
            ErrorKind::InvalidRequest,
            "this build has no GitHub OAuth client id (RUSTGIT_GITHUB_CLIENT_ID)",
        )
    })?;
    let cancelled: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
    if let Ok(mut slot) = github.sign_in.lock()
        && let Some(previous) = slot.replace(Arc::clone(&cancelled))
    {
        previous.store(true, Ordering::SeqCst);
    }
    let flow: Arc<GithubState> = Arc::clone(&github);
    let code: DeviceCode = blocking(move || {
        github::start_device_flow(flow.http.as_ref(), &client_id).map_err(command_error)
    })
    .await?;

    let pending: DeviceCode = code.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result: Result<GithubAccount, GithubError> = (|| {
            let client_id: &str = github.client_id.as_deref().unwrap_or_default();
            let token: String = github::wait_for_token(
                github.http.as_ref(),
                client_id,
                &pending,
                &cancelled,
                &|duration: Duration| std::thread::sleep(duration),
            )?;
            github.store.save(&token)?;
            github::current_account(github.http.as_ref(), &token)
        })();
        let payload: SignInFinished = match result {
            Ok(account) => SignInFinished {
                account: Some(account),
                error: None,
            },
            Err(GithubError::Cancelled) => return,
            Err(error) => SignInFinished {
                account: None,
                error: Some(error.to_string()),
            },
        };
        if let Err(error) = app.emit(SIGN_IN_EVENT, payload) {
            tracing::warn!(%error, "could not emit the GitHub sign-in result");
        }
    });
    Ok(code)
}

#[tauri::command]
pub fn github_cancel_sign_in(state: State<'_, AppState>) {
    if let Ok(mut slot) = state.github.sign_in.lock()
        && let Some(flag) = slot.take()
    {
        flag.store(true, Ordering::SeqCst);
    }
}

#[tauri::command]
pub async fn github_save_pat(
    app: AppHandle,
    state: State<'_, AppState>,
    token: String,
) -> CommandResult<GithubAccount> {
    let github: Arc<GithubState> = Arc::clone(&state.github);
    let trimmed = token.trim().to_owned();
    if !github::is_valid_token_shape(&trimmed) {
        return Err(CommandError::new(
            ErrorKind::InvalidRequest,
            "the provided token does not match standard GitHub token formats",
        ));
    }
    let account = blocking(move || {
        let account =
            github::current_account(github.http.as_ref(), &trimmed).map_err(command_error)?;
        github.store.save(&trimmed).map_err(command_error)?;
        Ok(account)
    })
    .await?;
    let _ = app.emit(
        SIGN_IN_EVENT,
        SignInFinished {
            account: Some(account.clone()),
            error: None,
        },
    );
    Ok(account)
}

#[tauri::command]
pub async fn github_sign_out(state: State<'_, AppState>) -> CommandResult<()> {
    let github: Arc<GithubState> = Arc::clone(&state.github);
    blocking(move || github.store.clear().map_err(command_error)).await
}

#[tauri::command]
pub async fn github_list_repositories(
    state: State<'_, AppState>,
    page: u32,
) -> CommandResult<Vec<GithubRepository>> {
    let github: Arc<GithubState> = Arc::clone(&state.github);
    blocking(move || {
        with_token(&github, |http, token| {
            github::list_repositories(http, token, page)
        })
    })
    .await
}

#[tauri::command]
pub async fn github_create_repository(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
    private: bool,
) -> CommandResult<GithubRepository> {
    let github: Arc<GithubState> = Arc::clone(&state.github);
    blocking(move || {
        with_token(&github, |http, token| {
            github::create_repository(http, token, name.trim(), description.as_deref(), private)
        })
    })
    .await
}
