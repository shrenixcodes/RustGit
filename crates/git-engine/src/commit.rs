//! Commit creation and the context the commit composer needs.

use std::path::Path;

use serde::Serialize;

use crate::error::{GitError, GitResult};
use crate::executor::GitExecutor;
use crate::index::has_head;
use crate::status::{FileStatus, InProgress, StatusSnapshot, in_progress, read_status};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SigningMode {
    Off,
    Gpg,
    Ssh,
    X509,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadCommit {
    pub oid: String,
    pub summary: String,
    pub message: String,
    /// Whether HEAD is reachable from its upstream (amending would rewrite
    /// published history). `None` when there is no upstream.
    pub on_upstream: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitContext {
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    pub signing: SigningMode,
    pub head: Option<HeadCommit>,
    pub in_progress: InProgress,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedCommit {
    pub oid: String,
    pub summary: String,
}

pub fn commit_context(git: &GitExecutor, root: &Path) -> GitResult<CommitContext> {
    let signing: SigningMode = if config_bool(git, root, "commit.gpgSign")? {
        match config_value(git, root, "gpg.format")?.as_deref() {
            Some("ssh") => SigningMode::Ssh,
            Some("x509") => SigningMode::X509,
            _ => SigningMode::Gpg,
        }
    } else {
        SigningMode::Off
    };

    let head: Option<HeadCommit> = if has_head(git, root)? {
        let message: String = git
            .run_text(root, ["log", "-1", "--format=%B", "HEAD"])?
            .trim_end()
            .to_owned();
        let oid: String = git.run_text(root, ["rev-parse", "HEAD"])?.trim().to_owned();
        let on_upstream: Option<bool> = upstream_contains_head(git, root)?;
        Some(HeadCommit {
            oid,
            summary: message.lines().next().unwrap_or_default().to_owned(),
            message,
            on_upstream,
        })
    } else {
        None
    };

    Ok(CommitContext {
        author_name: config_value(git, root, "user.name")?,
        author_email: config_value(git, root, "user.email")?,
        signing,
        head,
        in_progress: in_progress(git, root)?,
    })
}

fn upstream_contains_head(git: &GitExecutor, root: &Path) -> GitResult<Option<bool>> {
    let upstream: std::process::Output = git.run_unchecked(
        root,
        [
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
        None,
    )?;
    if !upstream.status.success() {
        return Ok(None);
    }
    let output: std::process::Output = git.run_unchecked(
        root,
        ["merge-base", "--is-ancestor", "HEAD", "@{upstream}"],
        None,
    )?;
    match output.status.code() {
        Some(0) => Ok(Some(true)),
        Some(1) => Ok(Some(false)),
        code => Err(GitError::CommandFailed {
            command: "merge-base --is-ancestor".to_owned(),
            exit_code: code,
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        }),
    }
}

pub(crate) fn config_value(git: &GitExecutor, root: &Path, key: &str) -> GitResult<Option<String>> {
    let output: std::process::Output = git.run_unchecked(root, ["config", "--get", key], None)?;
    match output.status.code() {
        Some(0) => {
            let value: String = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            Ok((!value.is_empty()).then_some(value))
        }
        // Exit code 1: the key is not set.
        Some(1) => Ok(None),
        code => Err(GitError::CommandFailed {
            command: format!("config --get {key}"),
            exit_code: code,
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        }),
    }
}

fn config_bool(git: &GitExecutor, root: &Path, key: &str) -> GitResult<bool> {
    let output: std::process::Output =
        git.run_unchecked(root, ["config", "--type=bool", "--get", key], None)?;
    Ok(output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "true")
}

/// Commits the index. Hooks and signing follow the user's Git configuration;
/// any failure is returned with Git's stderr.
pub fn create_commit(
    git: &GitExecutor,
    root: &Path,
    message: &str,
    amend: bool,
) -> GitResult<CreatedCommit> {
    if message.trim().is_empty() {
        return Err(GitError::InvalidRequest(
            "the commit message is empty".to_owned(),
        ));
    }
    let missing: Vec<&str> = [("user.name", "user.name"), ("user.email", "user.email")]
        .into_iter()
        .filter_map(|(key, label)| match config_value(git, root, key) {
            Ok(Some(_)) => None,
            _ => Some(label),
        })
        .collect();
    if !missing.is_empty() {
        return Err(GitError::IdentityMissing(missing.join(", ")));
    }
    if !amend {
        let status: StatusSnapshot = read_status(git, root)?;
        let staged: bool = status
            .files
            .iter()
            .any(|file: &FileStatus| file.staged.is_some());
        if !staged && status.in_progress != InProgress::Merging {
            return Err(GitError::NothingToCommit);
        }
    }

    let mut args: Vec<&str> = vec!["commit", "--file=-"];
    if amend {
        args.push("--amend");
    }
    git.run(root, args, Some(message.as_bytes()))?;

    let oid: String = git.run_text(root, ["rev-parse", "HEAD"])?.trim().to_owned();
    let summary: String = git
        .run_text(root, ["log", "-1", "--format=%s", "HEAD"])?
        .trim_end()
        .to_owned();
    Ok(CreatedCommit { oid, summary })
}
