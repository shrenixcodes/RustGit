use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{GitError, GitResult};
use crate::executor::GitExecutor;

/// Location details of an opened repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryLocation {
    /// Root of the working tree.
    pub root: PathBuf,
    /// Absolute Git directory. For linked worktrees this is not `<root>/.git`.
    pub git_dir: PathBuf,
    /// Directory shared by all worktrees (refs, config, objects).
    pub common_dir: PathBuf,
    /// Whether `root` is a linked worktree rather than the main working tree.
    pub is_linked_worktree: bool,
}

/// Resolves the repository containing `path` using Git itself, so `.git` files,
/// linked worktrees and other layouts are handled exactly the way Git handles them.
pub fn discover(git: &GitExecutor, path: &Path) -> GitResult<RepositoryLocation> {
    if !path.is_dir() {
        return Err(GitError::InvalidPath(path.to_path_buf()));
    }

    let output: std::process::Output = git.run_unchecked(
        path,
        [
            "rev-parse",
            "--path-format=absolute",
            "--show-toplevel",
            "--git-dir",
            "--git-common-dir",
        ],
        None,
    )?;

    if !output.status.success() {
        let stderr: String = String::from_utf8_lossy(&output.stderr).into_owned();
        if stderr.contains("not a git repository") || stderr.contains("must be run in a work tree")
        {
            return Err(GitError::NotARepository(path.to_path_buf()));
        }
        return Err(GitError::CommandFailed {
            command: "rev-parse".to_owned(),
            exit_code: output.status.code(),
            stderr: stderr.trim().to_owned(),
        });
    }

    let stdout: String = String::from_utf8_lossy(&output.stdout).into_owned();
    let mut lines = stdout.lines();
    let mut next = |field: &str| -> GitResult<PathBuf> {
        lines
            .next()
            .filter(|line: &&str| !line.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| GitError::Parse {
                command: "rev-parse".to_owned(),
                detail: format!("missing {field}"),
            })
    };
    let root: PathBuf = next("toplevel")?;
    let git_dir: PathBuf = next("git-dir")?;
    let common_dir: PathBuf = next("git-common-dir")?;

    Ok(RepositoryLocation {
        is_linked_worktree: normalize(&git_dir) != normalize(&common_dir),
        root,
        git_dir,
        common_dir,
    })
}

/// Initializes a new repository at `path`, creating the directory if needed.
pub fn init(git: &GitExecutor, path: &Path, initial_branch: &str) -> GitResult<RepositoryLocation> {
    std::fs::create_dir_all(path)?;
    let branch_arg: String = format!("--initial-branch={initial_branch}");
    git.run(path, ["init", branch_arg.as_str()], None)?;
    discover(git, path)
}

fn normalize(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}
