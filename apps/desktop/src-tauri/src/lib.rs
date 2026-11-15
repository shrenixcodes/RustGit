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
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the RustGit application");
}
