/// Custom IPC commands exposed to the frontend. Each must also be granted in
/// `capabilities/` (as `allow-<command-name>`) before the webview can call it.
const COMMANDS: &[&str] = &[
    "git_info",
    "get_settings",
    "set_theme",
    "list_repositories",
    "add_repository",
    "init_repository",
    "open_repository",
    "set_repository_pinned",
    "remove_repository",
    "repository_status",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
