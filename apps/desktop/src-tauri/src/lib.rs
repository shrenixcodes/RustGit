mod commands;
mod state;

use std::path::PathBuf;

use rustgit_git_engine::GitExecutor;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

use rustgit_core::Database;

use crate::state::AppState;

const DATABASE_FILE: &str = "rustgit.sqlite3";

/// Builds and runs the RustGit desktop application.
pub fn run() {
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
            tracing::info!(path = %database_path.display(), "opening database");
            let database: Database = Database::open(&database_path)?;
            app.manage(AppState::new(GitExecutor::new("git"), database));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::git_info,
            commands::system::get_settings,
            commands::system::set_theme,
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
