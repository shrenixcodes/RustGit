//! Application auto-updater checking GitHub Releases.

use crate::github::Http;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const DEFAULT_REPOSITORY: &str = "shrenixcodes/RustGit";

#[derive(Debug, thiserror::Error)]
pub enum UpdaterError {
    #[error("could not reach update server: {0}")]
    Network(String),
    #[error("update server answered unexpectedly: {0}")]
    Protocol(String),
    #[error("failed to download update package: {0}")]
    Download(String),
    #[error("failed to launch installer: {0}")]
    Launch(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: Option<String>,
    pub published_at: Option<String>,
    pub asset_name: Option<String>,
    pub download_url: Option<String>,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
}

pub fn is_newer_version(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Option<(u64, u64, u64)> {
        let s = v.trim().strip_prefix('v').unwrap_or(v.trim());
        let mut parts = s.split('.');
        let major: u64 = parts.next()?.parse().ok()?;
        let minor: u64 = parts.next()?.parse().ok()?;
        let patch_part = parts.next().unwrap_or("0");
        let patch: u64 = patch_part.split('-').next()?.parse().ok()?;
        Some((major, minor, patch))
    };
    match (parse(latest), parse(current)) {
        (Some(l), Some(c)) => l > c,
        _ => latest.trim() != current.trim(),
    }
}

pub fn check_for_update(
    http: &dyn Http,
    repository: &str,
    current_version: &str,
) -> Result<UpdateCheckResult, UpdaterError> {
    let url = format!("https://api.github.com/repos/{repository}/releases/latest");
    let (status, text) = http
        .api("GET", &url, "", None)
        .map_err(|e| UpdaterError::Network(e.to_string()))?;

    if status == 404 {
        return Ok(UpdateCheckResult {
            has_update: false,
            current_version: current_version.to_owned(),
            latest_version: current_version.to_owned(),
            release_notes: None,
            published_at: None,
            asset_name: None,
            download_url: None,
        });
    }

    if status != 200 {
        return Err(UpdaterError::Protocol(format!("status {status}")));
    }

    let release: GitHubRelease = serde_json::from_str(&text)
        .map_err(|e| UpdaterError::Protocol(format!("unreadable release json: {e}")))?;

    let has_update = is_newer_version(&release.tag_name, current_version);
    let chosen_asset = pick_asset_for_platform(&release.assets);

    Ok(UpdateCheckResult {
        has_update,
        current_version: current_version.to_owned(),
        latest_version: release.tag_name,
        release_notes: release.body,
        published_at: release.published_at,
        asset_name: chosen_asset.as_ref().map(|a| a.name.clone()),
        download_url: chosen_asset
            .as_ref()
            .map(|a| a.browser_download_url.clone()),
    })
}

fn pick_asset_for_platform(assets: &[GitHubReleaseAsset]) -> Option<&GitHubReleaseAsset> {
    if cfg!(target_os = "windows") {
        assets
            .iter()
            .find(|a| a.name.ends_with(".exe"))
            .or_else(|| assets.iter().find(|a| a.name.ends_with(".msi")))
    } else if cfg!(target_os = "macos") {
        assets.iter().find(|a| a.name.ends_with(".dmg"))
    } else {
        assets
            .iter()
            .find(|a| a.name.ends_with(".AppImage"))
            .or_else(|| assets.iter().find(|a| a.name.ends_with(".deb")))
    }
}

/// Downloads the installer to the local temp directory and executes it.
pub fn apply_update(download_url: &str, file_name: &str) -> Result<(), UpdaterError> {
    let temp_file = std::env::temp_dir().join(file_name);
    let response = ureq::get(download_url)
        .call()
        .map_err(|e| UpdaterError::Download(e.to_string()))?;

    let mut reader = response.into_body().into_reader();
    let mut file =
        std::fs::File::create(&temp_file).map_err(|e| UpdaterError::Download(e.to_string()))?;
    std::io::copy(&mut reader, &mut file).map_err(|e| UpdaterError::Download(e.to_string()))?;

    drop(file);

    launch_installer(&temp_file)?;
    Ok(())
}

fn launch_installer(path: &Path) -> Result<(), UpdaterError> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(path)
            .spawn()
            .map_err(|e| UpdaterError::Launch(e.to_string()))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| UpdaterError::Launch(e.to_string()))?;
    }
    #[cfg(target_os = "linux")]
    {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = std::fs::metadata(path) {
                let mut perms = metadata.permissions();
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(path, perms);
            }
        }
        std::process::Command::new(path)
            .spawn()
            .map_err(|e| UpdaterError::Launch(e.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_semver_strings() {
        assert!(is_newer_version("v0.2.0", "v0.1.0"));
        assert!(is_newer_version("0.1.1", "0.1.0"));
        assert!(is_newer_version("1.0.0", "0.9.9"));
        assert!(!is_newer_version("v0.1.0", "v0.1.0"));
        assert!(!is_newer_version("v0.1.0", "v0.2.0"));
    }

    struct MockHttp {
        status: u16,
        body: String,
    }

    impl Http for MockHttp {
        fn post_form(
            &self,
            _url: &str,
            _form: &[(&str, &str)],
        ) -> Result<String, crate::github::GithubError> {
            Ok(String::new())
        }
        fn api(
            &self,
            _method: &str,
            _url: &str,
            _token: &str,
            _body: Option<&str>,
        ) -> Result<(u16, String), crate::github::GithubError> {
            Ok((self.status, self.body.clone()))
        }
    }

    #[test]
    fn checks_update_detection() {
        let json = r#"{
            "tag_name": "v0.2.0",
            "body": "New high-performance features",
            "published_at": "2026-11-19T00:00:00Z",
            "assets": [
                {
                    "name": "RustGit_0.2.0_x64-setup.exe",
                    "browser_download_url": "https://github.com/shrenixcodes/RustGit/releases/download/v0.2.0/setup.exe"
                }
            ]
        }"#;
        let http = MockHttp {
            status: 200,
            body: json.to_owned(),
        };
        let result = check_for_update(&http, "test/repo", "0.1.0").expect("check update");
        assert!(result.has_update);
        assert_eq!(result.latest_version, "v0.2.0");
        assert_eq!(
            result.release_notes.as_deref(),
            Some("New high-performance features")
        );
    }
}
