//! Remote configuration and network operations (fetch, pull, push, clone).
//!
//! Network operations report Git's own progress lines and honour a
//! [`CancelToken`] where cancelling is safe.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{GitError, GitResult};
use crate::executor::{CancelToken, GitExecutor};
use crate::history::validate_revision;
use crate::integrate::{IntegrationResult, MergeStrategy, merge_branch, rebase_branch};
use crate::redact::redact_credentials;
use crate::repository::{RepositoryLocation, discover};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    pub fetch_url: Option<String>,
    pub push_url: Option<String>,
}

/// One progress report parsed from Git's stderr.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: String,
    pub current: u64,
    pub total: u64,
}

/// Parses lines such as `Receiving objects:  45% (450/1000), 1.2 MiB | 2 MiB/s`
/// or `remote: Counting objects: 100% (5/5), done.`. Other lines yield `None`.
pub fn parse_progress(line: &str) -> Option<Progress> {
    let line: &str = line.strip_prefix("remote: ").unwrap_or(line).trim();
    let (phase, rest) = line.split_once(':')?;
    let rest: &str = rest.trim_start();
    let (_percent, rest) = rest.split_once('%')?;
    let counts: &str = rest.trim_start().strip_prefix('(')?.split(')').next()?;
    let (current, total) = counts.split_once('/')?;
    Some(Progress {
        phase: phase.trim().to_owned(),
        current: current.trim().parse().ok()?,
        total: total.trim().parse().ok()?,
    })
}

fn validate_remote_name(git: &GitExecutor, root: &Path, name: &str) -> GitResult<()> {
    let invalid = || GitError::InvalidRequest(format!("'{name}' is not a valid remote name"));
    if name.is_empty() || name.starts_with('-') || name.contains('/') {
        return Err(invalid());
    }
    let output: std::process::Output = git.run_unchecked(
        root,
        ["check-ref-format", &format!("refs/remotes/{name}/x")],
        None,
    )?;
    if output.status.success() {
        Ok(())
    } else {
        Err(invalid())
    }
}

fn validate_url(url: &str) -> GitResult<()> {
    if url.trim().is_empty() || url.starts_with('-') || url.contains('\0') {
        return Err(GitError::InvalidRequest(format!(
            "'{}' is not a valid remote URL",
            redact_credentials(url)
        )));
    }
    Ok(())
}

pub fn list_remotes(git: &GitExecutor, root: &Path) -> GitResult<Vec<Remote>> {
    let names: String = git.run_text(root, ["remote"])?;
    let mut remotes: BTreeMap<String, Remote> = names
        .lines()
        .filter(|name: &&str| !name.is_empty())
        .map(|name: &str| {
            (
                name.to_owned(),
                Remote {
                    name: name.to_owned(),
                    fetch_url: None,
                    push_url: None,
                },
            )
        })
        .collect();
    let config: std::process::Output = git.run_unchecked(
        root,
        ["config", "--get-regexp", r"^remote\..*\.(url|pushurl)$"],
        None,
    )?;
    for line in String::from_utf8_lossy(&config.stdout).lines() {
        let Some((key, value)) = line.split_once(' ') else {
            continue;
        };
        let Some(key) = key.strip_prefix("remote.") else {
            continue;
        };
        let (name, field) = match (key.strip_suffix(".pushurl"), key.strip_suffix(".url")) {
            (Some(name), _) => (name, "pushurl"),
            (None, Some(name)) => (name, "url"),
            _ => continue,
        };
        if let Some(remote) = remotes.get_mut(name) {
            let value: String = redact_credentials(value);
            if field == "url" {
                remote.fetch_url = Some(value);
            } else {
                remote.push_url = Some(value);
            }
        }
    }
    Ok(remotes
        .into_values()
        .map(|mut remote: Remote| {
            if remote.push_url.is_none() {
                remote.push_url.clone_from(&remote.fetch_url);
            }
            remote
        })
        .collect())
}

pub fn add_remote(git: &GitExecutor, root: &Path, name: &str, url: &str) -> GitResult<()> {
    validate_remote_name(git, root, name)?;
    validate_url(url)?;
    git.run(root, ["remote", "add", name, url], None)?;
    Ok(())
}

pub fn set_remote_url(
    git: &GitExecutor,
    root: &Path,
    name: &str,
    url: &str,
    push: bool,
) -> GitResult<()> {
    validate_remote_name(git, root, name)?;
    validate_url(url)?;
    let mut args: Vec<&str> = vec!["remote", "set-url"];
    if push {
        args.push("--push");
    }
    args.extend([name, url]);
    git.run(root, args, None)?;
    Ok(())
}

pub fn remove_remote(git: &GitExecutor, root: &Path, name: &str) -> GitResult<()> {
    validate_remote_name(git, root, name)?;
    git.run(root, ["remote", "remove", name], None)?;
    Ok(())
}

/// Runs a network command, reporting progress, and reclassifies credential failures.
fn run_network(
    git: &GitExecutor,
    cwd: &Path,
    args: &[String],
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> GitResult<()> {
    git.run_streaming(cwd, args, cancel, &mut |line: &str| {
        if let Some(progress) = parse_progress(line) {
            on_progress(progress);
        }
    })
    .map_err(GitError::classify_network)?;
    Ok(())
}

/// Fetches one remote, or all remotes when `remote` is `None`.
pub fn fetch(
    git: &GitExecutor,
    root: &Path,
    remote: Option<&str>,
    prune: bool,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> GitResult<()> {
    let mut args: Vec<String> = vec!["fetch".to_owned(), "--progress".to_owned()];
    if prune {
        args.push("--prune".to_owned());
    }
    match remote {
        Some(name) => {
            validate_remote_name(git, root, name)?;
            args.push(name.to_owned());
        }
        None => args.push("--all".to_owned()),
    }
    run_network(git, root, &args, cancel, on_progress)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PullMode {
    FfOnly,
    Merge,
    Rebase,
}

/// Fetches the upstream's remote (cancellable), then integrates the upstream
/// branch with a fast-forward, merge or rebase (not cancellable).
pub fn pull(
    git: &GitExecutor,
    root: &Path,
    mode: PullMode,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> GitResult<IntegrationResult> {
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
        return Err(GitError::InvalidRequest(
            "the current branch has no upstream branch".to_owned(),
        ));
    }
    let branch: String = git
        .run_text(root, ["symbolic-ref", "--short", "HEAD"])?
        .trim()
        .to_owned();
    let remote: String = git
        .run_text(
            root,
            ["config", "--get", &format!("branch.{branch}.remote")],
        )?
        .trim()
        .to_owned();

    let mut args: Vec<String> = vec!["fetch".to_owned(), "--progress".to_owned()];
    // "." means the upstream is a local branch; nothing to fetch.
    if remote != "." {
        args.push(remote);
        run_network(git, root, &args, cancel, on_progress)?;
    }
    if cancel.is_cancelled() {
        return Err(GitError::Cancelled);
    }
    match mode {
        PullMode::FfOnly => merge_branch(git, root, "@{upstream}", MergeStrategy::FfOnly),
        PullMode::Merge => merge_branch(git, root, "@{upstream}", MergeStrategy::Default),
        PullMode::Rebase => rebase_branch(git, root, "@{upstream}"),
    }
}

#[derive(Debug, Clone, Default)]
pub struct PushRequest<'a> {
    pub remote: Option<&'a str>,
    pub branch: Option<&'a str>,
    pub set_upstream: bool,
    /// `--force-with-lease`; plain `--force` is never used.
    pub force_with_lease: bool,
}

/// Pushes; not cancellable because the remote may already have accepted it.
pub fn push(
    git: &GitExecutor,
    root: &Path,
    request: &PushRequest<'_>,
    on_progress: &mut dyn FnMut(Progress),
) -> GitResult<()> {
    let mut args: Vec<String> = vec!["push".to_owned(), "--progress".to_owned()];
    if request.set_upstream {
        args.push("--set-upstream".to_owned());
    }
    if request.force_with_lease {
        args.push("--force-with-lease".to_owned());
    }
    match (request.remote, request.branch) {
        (Some(remote), branch) => {
            validate_remote_name(git, root, remote)?;
            args.push(remote.to_owned());
            if let Some(branch) = branch {
                validate_revision(branch)?;
                args.push(branch.to_owned());
            }
        }
        (None, Some(_)) => {
            return Err(GitError::InvalidRequest(
                "a branch can only be pushed to a named remote".to_owned(),
            ));
        }
        (None, None) => {}
    }
    run_network(git, root, &args, &CancelToken::default(), on_progress)
}

pub fn delete_remote_branch(
    git: &GitExecutor,
    root: &Path,
    remote: &str,
    branch: &str,
    on_progress: &mut dyn FnMut(Progress),
) -> GitResult<()> {
    validate_remote_name(git, root, remote)?;
    validate_revision(branch)?;
    let args: Vec<String> = ["push", "--progress", remote, "--delete", branch]
        .map(str::to_owned)
        .to_vec();
    run_network(git, root, &args, &CancelToken::default(), on_progress)
}

/// Directory name Git would derive from a clone URL (`.../repo.git` -> `repo`).
pub fn directory_name_from_url(url: &str) -> Option<String> {
    let trimmed: &str = url.trim_end_matches(['/', '\\']);
    let last: &str = trimmed.rsplit(['/', '\\', ':']).next()?;
    let name: &str = last.strip_suffix(".git").unwrap_or(last);
    (!name.is_empty() && name != "." && name != "..").then(|| name.to_owned())
}

/// Clones into `parent/directory_name` (derived from the URL when `None`).
/// A cancelled or failed clone removes the directory it created.
pub fn clone(
    git: &GitExecutor,
    url: &str,
    parent: &Path,
    directory_name: Option<&str>,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> GitResult<RepositoryLocation> {
    validate_url(url)?;
    if !parent.is_dir() {
        return Err(GitError::InvalidPath(parent.to_path_buf()));
    }
    let name: String = match directory_name {
        Some(name) => name.to_owned(),
        None => directory_name_from_url(url).ok_or_else(|| {
            GitError::InvalidRequest("cannot derive a directory name from the URL".to_owned())
        })?,
    };
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err(GitError::InvalidRequest(format!(
            "'{name}' is not a valid directory name"
        )));
    }
    let target: PathBuf = parent.join(&name);
    if target.exists() && std::fs::read_dir(&target)?.next().is_some() {
        return Err(GitError::InvalidRequest(format!(
            "'{}' already exists and is not empty",
            target.display()
        )));
    }
    let existed: bool = target.exists();

    let args: Vec<String> = vec![
        "clone".to_owned(),
        "--progress".to_owned(),
        "--".to_owned(),
        url.to_owned(),
        target.to_string_lossy().into_owned(),
    ];
    if let Err(error) = run_network(git, parent, &args, cancel, on_progress) {
        if target.exists() {
            // Only remove what this clone created; keep a pre-existing empty dir.
            let cleanup: std::io::Result<()> = if existed {
                std::fs::read_dir(&target).and_then(|mut entries| {
                    entries.try_for_each(|entry| {
                        let path: PathBuf = entry?.path();
                        if path.is_dir() {
                            std::fs::remove_dir_all(path)
                        } else {
                            std::fs::remove_file(path)
                        }
                    })
                })
            } else {
                std::fs::remove_dir_all(&target)
            };
            if let Err(cleanup_error) = cleanup {
                tracing::warn!(%cleanup_error, path = %target.display(), "could not remove partial clone");
            }
        }
        return Err(error);
    }
    discover(git, &target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_progress_lines() {
        assert_eq!(
            parse_progress("Receiving objects:  45% (450/1000), 1.20 MiB | 2.00 MiB/s"),
            Some(Progress {
                phase: "Receiving objects".to_owned(),
                current: 450,
                total: 1000
            })
        );
        assert_eq!(
            parse_progress("remote: Counting objects: 100% (5/5), done.").map(|p| p.phase),
            Some("Counting objects".to_owned())
        );
        assert_eq!(parse_progress("From https://github.com/o/r"), None);
        assert_eq!(
            parse_progress(" * [new branch]      main -> origin/main"),
            None
        );
    }

    #[test]
    fn derives_clone_directory_names() {
        assert_eq!(
            directory_name_from_url("https://github.com/o/rustgit.git").as_deref(),
            Some("rustgit")
        );
        assert_eq!(
            directory_name_from_url("git@github.com:o/repo.git").as_deref(),
            Some("repo")
        );
        assert_eq!(
            directory_name_from_url("C:\\code\\local-repo\\").as_deref(),
            Some("local-repo")
        );
        assert_eq!(
            directory_name_from_url("https://host/"),
            Some("host".to_owned())
        );
        assert_eq!(directory_name_from_url(""), None);
    }

    #[test]
    fn rejects_option_like_urls() {
        assert!(validate_url("--upload-pack=touch /tmp/x").is_err());
        assert!(validate_url("https://github.com/o/r.git").is_ok());
    }
}
