mod commands;
mod state;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use rustgit_core::askpass::{self, PromptHandler, is_secret_prompt};
use rustgit_core::github::{KeychainStore, TokenStore, answer_for_prompt};
use rustgit_core::{AskpassBroker, CredentialRequest, Database, PendingPrompts};
use rustgit_git_engine::GitExecutor;
use rustgit_git_engine::redact::redact_credentials;
use tauri::{Emitter, Manager};
use tracing_subscriber::EnvFilter;

use crate::commands::github::GithubState;
use crate::state::AppState;

const DATABASE_FILE: &str = "rustgit.sqlite3";
const CREDENTIAL_EVENT: &str = "credential-requested";
/// How long a credential prompt waits for the user before Git gives up.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(300);

/// Builds and runs the RustGit desktop application.
pub fn run() {
    // Git and ssh start this executable to ask for a password or passphrase.
    let arguments: Vec<String> = std::env::args().collect();
    if let Some(code) = askpass::run_helper(&arguments) {
        std::process::exit(code);
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("RUSTGIT_LOG").unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app: &mut tauri::App| {
            // RUSTGIT_DATA_DIR isolates state for portable use and automated tests.
            let data_dir: PathBuf = match std::env::var_os("RUSTGIT_DATA_DIR") {
                Some(dir) => PathBuf::from(dir),
                None => app.path().app_data_dir()?,
            };
            let database_path: PathBuf = data_dir.join(DATABASE_FILE);
            tracing::debug!(path = %database_path.display(), "opening database");
            let database: Database = Database::open(&database_path)?;
            let prompts: Arc<PendingPrompts> = Arc::new(PendingPrompts::default());
            let git: GitExecutor = GitExecutor::new(resolve_git());
            let store: Arc<dyn TokenStore> = Arc::new(KeychainStore);
            let git: GitExecutor = match start_credential_broker(app.handle(), &prompts, &store) {
                Ok(environment) => git.with_env(environment),
                Err(error) => {
                    tracing::warn!(%error, "credential prompts are unavailable");
                    git
                }
            };
            app.manage(AppState::new(
                git,
                database,
                prompts,
                Arc::new(GithubState::new(store)),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::git_info,
            commands::credentials::respond_credential,
            commands::github::github_status,
            commands::github::github_start_sign_in,
            commands::github::github_cancel_sign_in,
            commands::github::github_save_pat,
            commands::github::github_sign_out,
            commands::github::github_list_repositories,
            commands::github::github_create_repository,
            commands::system::get_settings,
            commands::system::set_theme,
            commands::system::check_for_update,
            commands::system::install_update,
            commands::repositories::list_repositories,
            commands::repositories::add_repository,
            commands::repositories::init_repository,
            commands::repositories::open_repository,
            commands::repositories::set_repository_pinned,
            commands::repositories::remove_repository,
            commands::repositories::repository_status,
            commands::changes::stage_paths,
            commands::changes::unstage_paths,
            commands::changes::stage_all,
            commands::changes::unstage_all,
            commands::changes::discard_paths,
            commands::changes::file_diff,
            commands::changes::apply_hunk,
            commands::changes::change_totals,
            commands::changes::commit_context,
            commands::changes::create_commit,
            commands::changes::command_history,
            commands::history::log_page,
            commands::history::commit_details,
            commands::history::commit_file_diff,
            commands::history::compare_revisions,
            commands::history::compare_file_diff,
            commands::history::list_refs,
            commands::history::create_branch,
            commands::history::checkout_branch,
            commands::history::rename_branch,
            commands::history::delete_branch,
            commands::history::set_upstream,
            commands::history::merge_branch,
            commands::history::rebase_branch,
            commands::history::cherry_pick,
            commands::history::revert_commit,
            commands::history::continue_operation,
            commands::history::skip_operation,
            commands::history::abort_operation,
            commands::history::conflict_versions,
            commands::history::resolve_conflict,
            commands::network::list_remotes,
            commands::network::add_remote,
            commands::network::set_remote_url,
            commands::network::remove_remote,
            commands::network::start_fetch,
            commands::network::start_pull,
            commands::network::start_push,
            commands::network::start_delete_remote_branch,
            commands::network::start_clone,
            commands::network::cancel_operation,
            commands::workspace::list_stashes,
            commands::workspace::create_stash,
            commands::workspace::apply_stash,
            commands::workspace::drop_stash,
            commands::workspace::stash_details,
            commands::workspace::stash_file_diff,
            commands::workspace::list_worktrees,
            commands::workspace::add_worktree,
            commands::workspace::remove_worktree,
            commands::workspace::prune_worktrees,
            commands::repositories::watch_repository,
            commands::repositories::unwatch_repository,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the RustGit application");
}

/// Resolves `git` against absolute `PATH` entries, with fallback checks for
/// standard system installation directories (including Git for Windows and
/// GitHub Desktop's bundled Git). Falls back to the bare name if none are found.
fn resolve_git() -> PathBuf {
    let names: &[&str] = if cfg!(windows) {
        &["git.exe", "git.cmd"]
    } else {
        &["git"]
    };
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path).filter(|directory| directory.is_absolute()) {
            for name in names {
                let candidate: PathBuf = directory.join(name);
                if candidate.is_file() {
                    return candidate;
                }
            }
        }
    }

    if cfg!(windows) {
        let mut candidates = Vec::new();
        if let Some(pf) = std::env::var_os("ProgramFiles") {
            let p = PathBuf::from(pf);
            candidates.push(p.join("Git").join("cmd").join("git.exe"));
            candidates.push(p.join("Git").join("bin").join("git.exe"));
        }
        if let Some(pf86) = std::env::var_os("ProgramFiles(x86)") {
            let p = PathBuf::from(pf86);
            candidates.push(p.join("Git").join("cmd").join("git.exe"));
            candidates.push(p.join("Git").join("bin").join("git.exe"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let p = PathBuf::from(local);
            candidates.push(p.join("Programs").join("Git").join("cmd").join("git.exe"));
            candidates.push(p.join("Programs").join("Git").join("bin").join("git.exe"));
            // GitHub Desktop's bundled Git
            let gh_desktop = p.join("GitHubDesktop");
            if gh_desktop.is_dir()
                && let Ok(entries) = std::fs::read_dir(&gh_desktop)
            {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir()
                        && path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .is_some_and(|s| s.starts_with("app-"))
                    {
                        candidates.push(
                            path.join("resources")
                                .join("app")
                                .join("git")
                                .join("cmd")
                                .join("git.exe"),
                        );
                    }
                }
            }
        }
        for candidate in candidates {
            if candidate.is_file() {
                return candidate;
            }
        }
    } else if cfg!(target_os = "macos") {
        for candidate in [
            "/usr/local/bin/git",
            "/opt/homebrew/bin/git",
            "/usr/bin/git",
        ] {
            let p = PathBuf::from(candidate);
            if p.is_file() {
                return p;
            }
        }
    } else if cfg!(target_os = "linux") {
        for candidate in ["/usr/bin/git", "/usr/local/bin/git"] {
            let p = PathBuf::from(candidate);
            if p.is_file() {
                return p;
            }
        }
    }

    PathBuf::from("git")
}

/// Starts the prompt broker and returns the environment that points Git and
/// ssh at this executable. Each prompt becomes a `credential-requested` event.
fn start_credential_broker(
    app: &tauri::AppHandle,
    prompts: &Arc<PendingPrompts>,
    store: &Arc<dyn TokenStore>,
) -> std::io::Result<Vec<(std::ffi::OsString, std::ffi::OsString)>> {
    let helper: PathBuf = std::env::current_exe()?;
    let handle: tauri::AppHandle = app.clone();
    let pending: Arc<PendingPrompts> = Arc::clone(prompts);
    let store: Arc<dyn TokenStore> = Arc::clone(store);
    let handler: PromptHandler = Arc::new(move |prompt: &str| {
        // A signed-in GitHub account answers github.com prompts without asking.
        if let Ok(Some(token)) = store.load()
            && let Some(answer) = answer_for_prompt(prompt, &token)
        {
            return Some(answer);
        }
        let (request_id, receiver) = pending.register();
        let request: CredentialRequest = CredentialRequest {
            request_id: request_id.clone(),
            prompt: redact_credentials(prompt),
            secret: is_secret_prompt(prompt),
        };
        if handle.emit(CREDENTIAL_EVENT, request).is_err() {
            pending.forget(&request_id);
            return None;
        }
        let answer: Option<String> = receiver.recv_timeout(PROMPT_TIMEOUT).ok().flatten();
        pending.forget(&request_id);
        answer
    });
    let broker: AskpassBroker = AskpassBroker::start(handler)?;
    Ok(broker.environment(&helper))
}
