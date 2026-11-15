//! Commit creation and commit metadata.

use std::path::Path;

use serde::Serialize;

use crate::error::{GitError, GitResult};
use crate::executor::GitExecutor;
use crate::index::has_head;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedCommit {
    pub oid: String,
    pub summary: String,
}

/// Effective `user.name` / `user.email` for the repository (any config level).
pub fn author_identity(git: &GitExecutor, root: &Path) -> GitResult<AuthorIdentity> {
    Ok(AuthorIdentity {
        name: config_value(git, root, "user.name")?,
        email: config_value(git, root, "user.email")?,
    })
}

fn config_value(git: &GitExecutor, root: &Path, key: &str) -> GitResult<Option<String>> {
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

/// Full message of HEAD, or `None` before the first commit.
pub fn last_commit_message(git: &GitExecutor, root: &Path) -> GitResult<Option<String>> {
    if !has_head(git, root)? {
        return Ok(None);
    }
    let message: String = git.run_text(root, ["log", "-1", "--format=%B", "HEAD"])?;
    Ok(Some(message.trim_end().to_owned()))
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
