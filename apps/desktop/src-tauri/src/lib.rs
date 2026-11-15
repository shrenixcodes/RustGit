use tracing_subscriber::EnvFilter;

/// Builds and runs the RustGit desktop application.
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("RUSTGIT_LOG").unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run the RustGit application");
}
