//! Remote configuration and long-running network operations (C-2).
//!
//! `start_*` commands return an operation id immediately and report through
//! the `operation-progress` and `operation-finished` events.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rustgit_core::{
    CommandResult, Database, OperationFinished, OperationKind, OperationOutcome, OperationProgress,
    OperationStarted, ProgressCounts, ProgressThrottle,
};
use rustgit_git_engine::remote::{self, Progress, PullMode, PushRequest, Remote};
use rustgit_git_engine::{CancelToken, GitExecutor, GitResult, RepositoryLocation};
use tauri::{AppHandle, Emitter, Manager, State};

use super::changes::{read, repository_root, write};
use super::repositories::register;
use crate::state::{AppState, blocking};

pub const PROGRESS_EVENT: &str = "operation-progress";
pub const FINISHED_EVENT: &str = "operation-finished";
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

#[tauri::command]
pub async fn list_remotes(state: State<'_, AppState>, id: i64) -> CommandResult<Vec<Remote>> {
    read(&state, id, remote::list_remotes).await
}

#[tauri::command]
pub async fn add_remote(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    url: String,
) -> CommandResult<Vec<Remote>> {
    write(&state, id, move |git, root| {
        remote::add_remote(git, root, &name, &url)?;
        remote::list_remotes(git, root)
    })
    .await
}

#[tauri::command]
pub async fn set_remote_url(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    url: String,
    push: bool,
) -> CommandResult<Vec<Remote>> {
    write(&state, id, move |git, root| {
        remote::set_remote_url(git, root, &name, &url, push)?;
        remote::list_remotes(git, root)
    })
    .await
}

#[tauri::command]
pub async fn remove_remote(
    state: State<'_, AppState>,
    id: i64,
    name: String,
) -> CommandResult<Vec<Remote>> {
    write(&state, id, move |git, root| {
        remote::remove_remote(git, root, &name)?;
        remote::list_remotes(git, root)
    })
    .await
}

/// How a repository operation locks its repository.
#[derive(Clone, Copy, PartialEq, Eq)]
enum LockMode {
    /// Updates refs only (fetch, push): reads continue, mutations wait.
    Read,
    /// Changes the working tree (pull).
    Write,
}

type OperationWork = Box<
    dyn FnOnce(&GitExecutor, &Path, &CancelToken, &mut dyn FnMut(Progress)) -> GitResult<()> + Send,
>;

/// Registers and starts a repository-scoped operation in the background.
fn start_repository_operation(
    app: AppHandle,
    state: &AppState,
    id: i64,
    kind: OperationKind,
    lock: LockMode,
    token: CancelToken,
    work: OperationWork,
) -> OperationStarted {
    let operation_id: String = state.operations.start(token.clone());
    let task_id: String = operation_id.clone();
    tauri::async_runtime::spawn(async move {
        let state: State<'_, AppState> = app.state::<AppState>();
        let (read_guard, write_guard) = match lock {
            LockMode::Read => (Some(state.locks.read(id).await), None),
            LockMode::Write => (None, Some(state.locks.write(id).await)),
        };
        let git: GitExecutor = state.git.clone();
        let database: Arc<Database> = Arc::clone(&state.database);
        let emitter: AppHandle = app.clone();
        let progress_id: String = task_id.clone();
        let result: CommandResult<()> = blocking(move || {
            let root: PathBuf = repository_root(&database, id)?;
            let mut report = progress_reporter(emitter, progress_id, Some(id), kind);
            Ok(work(&git, &root, &token, &mut report)?)
        })
        .await;
        drop((read_guard, write_guard));
        finish(&app, &state, &task_id, Some(id), result);
    });
    OperationStarted { operation_id }
}

fn progress_reporter(
    app: AppHandle,
    operation_id: String,
    repository_id: Option<i64>,
    kind: OperationKind,
) -> impl FnMut(Progress) {
    let mut throttle: ProgressThrottle = ProgressThrottle::new(PROGRESS_INTERVAL);
    move |progress: Progress| {
        let counts: ProgressCounts = ProgressCounts {
            current: progress.current,
            total: progress.total,
        };
        if throttle.should_emit(&progress.phase, Some(counts), Instant::now()) {
            let payload: OperationProgress = OperationProgress {
                operation_id: operation_id.clone(),
                repository_id,
                kind,
                phase: progress.phase,
                progress: Some(counts),
            };
            if let Err(error) = app.emit(PROGRESS_EVENT, payload) {
                tracing::warn!(%error, "could not emit operation progress");
            }
        }
    }
}

fn finish<T>(
    app: &AppHandle,
    state: &AppState,
    operation_id: &str,
    repository_id: Option<i64>,
    result: CommandResult<T>,
) {
    state.operations.finish(operation_id);
    let (outcome, error) = match result {
        Ok(_) => (OperationOutcome::Succeeded, None),
        Err(error) if error.kind == rustgit_core::ErrorKind::OperationCancelled => {
            (OperationOutcome::Cancelled, None)
        }
        Err(error) => (OperationOutcome::Failed, Some(error)),
    };
    let payload: OperationFinished = OperationFinished {
        operation_id: operation_id.to_owned(),
        repository_id,
        outcome,
        error,
    };
    if let Err(error) = app.emit(FINISHED_EVENT, payload) {
        tracing::error!(%error, operation_id, "could not emit operation-finished");
    }
}

#[tauri::command]
pub fn start_fetch(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    remote: Option<String>,
    prune: bool,
) -> OperationStarted {
    start_repository_operation(
        app,
        &state,
        id,
        OperationKind::Fetch,
        LockMode::Read,
        CancelToken::default(),
        Box::new(move |git, root, token, report| {
            remote::fetch(git, root, remote.as_deref(), prune, token, report)
        }),
    )
}

#[tauri::command]
pub fn start_pull(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    mode: PullMode,
) -> OperationStarted {
    start_repository_operation(
        app,
        &state,
        id,
        OperationKind::Pull,
        LockMode::Write,
        CancelToken::default(),
        Box::new(move |git, root, token, report| {
            remote::pull(git, root, mode, token, report).map(|_| ())
        }),
    )
}

#[tauri::command]
pub fn start_push(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    remote: Option<String>,
    branch: Option<String>,
    set_upstream: bool,
    force_with_lease: bool,
) -> OperationStarted {
    start_repository_operation(
        app,
        &state,
        id,
        OperationKind::Push,
        LockMode::Read,
        CancelToken::uncancellable(),
        Box::new(move |git, root, _token, report| {
            remote::push(
                git,
                root,
                &PushRequest {
                    remote: remote.as_deref(),
                    branch: branch.as_deref(),
                    set_upstream,
                    force_with_lease,
                },
                report,
            )
        }),
    )
}

#[tauri::command]
pub fn start_delete_remote_branch(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    remote: String,
    branch: String,
) -> OperationStarted {
    start_repository_operation(
        app,
        &state,
        id,
        OperationKind::DeleteRemoteBranch,
        LockMode::Read,
        CancelToken::uncancellable(),
        Box::new(move |git, root, _token, report| {
            remote::delete_remote_branch(git, root, &remote, &branch, report)
        }),
    )
}

/// Clones and registers the repository; `operation-finished` carries its id.
#[tauri::command]
pub fn start_clone(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    parent_directory: String,
    directory_name: Option<String>,
) -> OperationStarted {
    let token: CancelToken = CancelToken::default();
    let operation_id: String = state.operations.start(token.clone());
    let task_id: String = operation_id.clone();
    tauri::async_runtime::spawn(async move {
        let state: State<'_, AppState> = app.state::<AppState>();
        let git: GitExecutor = state.git.clone();
        let database: Arc<Database> = Arc::clone(&state.database);
        let emitter: AppHandle = app.clone();
        let progress_id: String = task_id.clone();
        let result: CommandResult<i64> = blocking(move || {
            let mut report = progress_reporter(emitter, progress_id, None, OperationKind::Clone);
            let location: RepositoryLocation = remote::clone(
                &git,
                &url,
                Path::new(&parent_directory),
                directory_name.as_deref(),
                &token,
                &mut report,
            )?;
            Ok(register(&database, &location)?.id)
        })
        .await;
        let repository_id: Option<i64> = result.as_ref().ok().copied();
        finish(&app, &state, &task_id, repository_id, result);
    });
    OperationStarted { operation_id }
}

/// `true` if cancellation was accepted; `false` if the operation is unknown,
/// finished, or past the point where it can be cancelled.
#[tauri::command]
pub fn cancel_operation(state: State<'_, AppState>, operation_id: String) -> bool {
    state.operations.cancel(&operation_id)
}
