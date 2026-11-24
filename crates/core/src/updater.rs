//! Application auto-updater checking GitHub Releases.

use crate::github::Http;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};

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
    #[error("refusing to install the update: {0}")]
    Untrusted(String),
}

/// Installer file types the updater will run, matching `pick_asset_for_platform`.
const INSTALLER_EXTENSIONS: [&str; 5] = [".exe", ".msi", ".dmg", ".AppImage", ".deb"];

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
    /// `sha256:<hex>` as published by GitHub for the asset, when available.
    pub asset_digest: Option<String>,
    /// The release page, for when there is no installer for this platform.
    pub release_url: Option<String>,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    #[serde(default)]
    html_url: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    digest: Option<String>,
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
            asset_digest: None,
            release_url: None,
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
        asset_digest: chosen_asset.and_then(|a| a.digest.clone()),
        release_url: release.html_url,
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

/// Checks that an installer comes from this project's GitHub releases and
/// has a plain installer file name, before anything is downloaded.
pub fn validate_update_source(
    repository: &str,
    download_url: &str,
    file_name: &str,
) -> Result<(), UpdaterError> {
    let plain: bool = !file_name.is_empty()
        && !file_name.starts_with('.')
        && Path::new(file_name)
            .file_name()
            .and_then(|name| name.to_str())
            == Some(file_name)
        && !file_name.contains(['/', '\\', ':']);
    if !plain
        || !INSTALLER_EXTENSIONS
            .iter()
            .any(|ext| file_name.ends_with(ext))
    {
        return Err(UpdaterError::Untrusted(format!(
            "'{file_name}' is not an installer file name"
        )));
    }
    let prefix: String = format!("https://github.com/{repository}/releases/download/");
    let Some(rest) = download_url.strip_prefix(&prefix) else {
        return Err(UpdaterError::Untrusted(format!(
            "the download is not from {repository}'s GitHub releases"
        )));
    };
    // `<tag>/<file name>`: the file downloaded is the file named.
    match rest.split_once('/') {
        Some((tag, name)) if !tag.is_empty() && name == file_name => Ok(()),
        _ => Err(UpdaterError::Untrusted(
            "the download address does not match the installer name".to_owned(),
        )),
    }
}

/// Compares bytes with a GitHub asset digest (`sha256:<hex>`).
pub fn verify_digest(bytes: &[u8], digest: &str) -> Result<(), UpdaterError> {
    let Some(expected) = digest.strip_prefix("sha256:") else {
        return Err(UpdaterError::Untrusted(format!(
            "unsupported digest '{digest}'"
        )));
    };
    let actual: String = Sha256::digest(bytes)
        .iter()
        .map(|byte: &u8| format!("{byte:02x}"))
        .collect();
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(UpdaterError::Untrusted(
            "the downloaded installer does not match the published checksum".to_owned(),
        ))
    }
}

/// Downloads this project's installer into a private temp folder, verifies
/// it against the published checksum when there is one, and runs it.
pub fn apply_update(
    download_url: &str,
    file_name: &str,
    digest: Option<&str>,
) -> Result<(), UpdaterError> {
    validate_update_source(DEFAULT_REPOSITORY, download_url, file_name)?;
    let response = ureq::get(download_url)
        .call()
        .map_err(|e| UpdaterError::Download(e.to_string()))?;
    let mut bytes: Vec<u8> = Vec::new();
    response
        .into_body()
        .into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| UpdaterError::Download(e.to_string()))?;
    if let Some(digest) = digest {
        verify_digest(&bytes, digest)?;
    }

    let folder: PathBuf = std::env::temp_dir().join("rustgit-update");
    std::fs::create_dir_all(&folder).map_err(|e| UpdaterError::Download(e.to_string()))?;
    let temp_file: PathBuf = folder.join(file_name);
    std::fs::write(&temp_file, &bytes).map_err(|e| UpdaterError::Download(e.to_string()))?;

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
    fn accepts_only_this_projects_release_installers() {
        let url = "https://github.com/o/r/releases/download/v1.2.0/RustGit_1.2.0_x64-setup.exe";
        assert!(validate_update_source("o/r", url, "RustGit_1.2.0_x64-setup.exe").is_ok());
        let wrong_host =
            "https://example.com/o/r/releases/download/v1.2.0/RustGit_1.2.0_x64-setup.exe";
        assert!(validate_update_source("o/r", wrong_host, "RustGit_1.2.0_x64-setup.exe").is_err());
        assert!(validate_update_source("x/y", url, "RustGit_1.2.0_x64-setup.exe").is_err());
        assert!(validate_update_source("o/r", url, "other.exe").is_err());
        for name in [
            "..\\evil.exe",
            "../evil.exe",
            "notes.txt",
            ".exe",
            "C:evil.exe",
        ] {
            assert!(validate_update_source("o/r", url, name).is_err(), "{name}");
        }
    }

    #[test]
    fn verifies_sha256_digests() {
        let digest = "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        assert!(verify_digest(b"hello", digest).is_ok());
        assert!(verify_digest(b"hello!", digest).is_err());
        assert!(verify_digest(b"hello", "md5:abc").is_err());
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
