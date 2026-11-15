//! Linked worktree management (`git worktree`).

use std::path::Path;

use serde::Serialize;

use crate::error::{GitError, GitResult};
use crate::executor::GitExecutor;
use crate::history::validate_revision;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub is_main: bool,
    pub detached: bool,
    pub bare: bool,
    /// Lock reason (`""` when locked without a reason).
    pub locked: Option<String>,
    /// Reason the worktree can be pruned (its directory is gone).
    pub prunable: Option<String>,
}

pub fn list_worktrees(git: &GitExecutor, root: &Path) -> GitResult<Vec<Worktree>> {
    let output: std::process::Output =
        git.run(root, ["worktree", "list", "--porcelain", "-z"], None)?;
    Ok(parse_worktrees(&output.stdout))
}

/// Parses `git worktree list --porcelain -z`: NUL-terminated attribute lines,
/// records separated by an empty line. The first record is the main worktree.
pub(crate) fn parse_worktrees(raw: &[u8]) -> Vec<Worktree> {
    let text: String = String::from_utf8_lossy(raw).into_owned();
    let mut worktrees: Vec<Worktree> = Vec::new();
    let mut current: Option<Worktree> = None;
    for line in text.split('\0') {
        if line.is_empty() {
            if let Some(worktree) = current.take() {
                worktrees.push(worktree);
            }
            continue;
        }
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));
        if key == "worktree" {
            if let Some(worktree) = current.take() {
                worktrees.push(worktree);
            }
            current = Some(Worktree {
                path: value.to_owned(),
                is_main: worktrees.is_empty(),
                ..Worktree::default()
            });
            continue;
        }
        let Some(worktree) = current.as_mut() else {
            continue;
        };
        match key {
            "HEAD" => worktree.head = Some(value.to_owned()),
            "branch" => {
                worktree.branch = Some(
                    value
                        .strip_prefix("refs/heads/")
                        .unwrap_or(value)
                        .to_owned(),
                );
            }
            "detached" => worktree.detached = true,
            "bare" => worktree.bare = true,
            "locked" => worktree.locked = Some(value.to_owned()),
            "prunable" => worktree.prunable = Some(value.to_owned()),
            _ => {}
        }
    }
    if let Some(worktree) = current {
        worktrees.push(worktree);
    }
    worktrees
}

#[derive(Debug, Clone)]
pub struct AddWorktree<'a> {
    pub path: &'a Path,
    /// Check out an existing branch.
    pub branch: Option<&'a str>,
    /// Create a new branch (from `commit` or HEAD).
    pub new_branch: Option<&'a str>,
    /// Start point; alone it creates a detached worktree.
    pub commit: Option<&'a str>,
}

impl<'a> AddWorktree<'a> {
    /// A request for `path` with no branch or commit chosen yet.
    pub fn at(path: &'a Path) -> Self {
        Self {
            path,
            branch: None,
            new_branch: None,
            commit: None,
        }
    }
}

pub fn add_worktree(git: &GitExecutor, root: &Path, request: &AddWorktree<'_>) -> GitResult<()> {
    let path: String = request.path.to_string_lossy().into_owned();
    if path.is_empty() || path.starts_with('-') {
        return Err(GitError::InvalidRequest(format!(
            "'{path}' is not a valid worktree path"
        )));
    }
    if request.path.exists() && std::fs::read_dir(request.path)?.next().is_some() {
        return Err(GitError::InvalidRequest(format!(
            "'{path}' already exists and is not empty"
        )));
    }
    let mut args: Vec<String> = vec!["worktree".to_owned(), "add".to_owned()];
    match (request.branch, request.new_branch, request.commit) {
        (Some(branch), None, None) => {
            validate_revision(branch)?;
            args.extend([path, branch.to_owned()]);
        }
        (None, Some(new_branch), commit) => {
            validate_revision(new_branch)?;
            args.extend(["-b".to_owned(), new_branch.to_owned(), path]);
            if let Some(commit) = commit {
                validate_revision(commit)?;
                args.push(commit.to_owned());
            }
        }
        (None, None, Some(commit)) => {
            validate_revision(commit)?;
            args.extend(["--detach".to_owned(), path, commit.to_owned()]);
        }
        _ => {
            return Err(GitError::InvalidRequest(
                "give a branch, a new branch (optionally with a commit), or a commit".to_owned(),
            ));
        }
    }
    git.run(root, &args, None)?;
    Ok(())
}

fn same_path(left: &str, right: &Path) -> bool {
    let normalize = |path: &Path| path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    normalize(Path::new(left)) == normalize(right)
}

/// Removes a linked worktree. Without `force`, Git refuses one with changes.
pub fn remove_worktree(git: &GitExecutor, root: &Path, path: &Path, force: bool) -> GitResult<()> {
    let worktrees: Vec<Worktree> = list_worktrees(git, root)?;
    let target: &Worktree = worktrees
        .iter()
        .find(|worktree: &&Worktree| same_path(&worktree.path, path))
        .ok_or_else(|| {
            GitError::InvalidRequest(format!(
                "'{}' is not a worktree of this repository",
                path.display()
            ))
        })?;
    if target.is_main {
        return Err(GitError::InvalidRequest(
            "the main worktree cannot be removed".to_owned(),
        ));
    }
    let mut args: Vec<&str> = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&target.path);
    git.run(root, args, None)?;
    Ok(())
}

pub fn prune_worktrees(git: &GitExecutor, root: &Path) -> GitResult<()> {
    git.run(root, ["worktree", "prune"], None)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_records() {
        let raw: Vec<u8> = [
            "worktree /repo",
            "HEAD aaa",
            "branch refs/heads/main",
            "",
            "worktree /repo-wt",
            "HEAD bbb",
            "detached",
            "locked",
            "",
            "worktree /gone",
            "HEAD ccc",
            "branch refs/heads/old",
            "prunable gitdir file points to non-existent location",
            "",
        ]
        .join("\0")
        .into_bytes();
        let worktrees: Vec<Worktree> = parse_worktrees(&raw);
        assert_eq!(worktrees.len(), 3);
        assert!(worktrees[0].is_main);
        assert_eq!(worktrees[0].branch.as_deref(), Some("main"));
        assert!(worktrees[1].detached);
        assert_eq!(worktrees[1].locked.as_deref(), Some(""));
        assert!(worktrees[2].prunable.is_some());
        assert!(!worktrees[2].is_main);
    }
}
