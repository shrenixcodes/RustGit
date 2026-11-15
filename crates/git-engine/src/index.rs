//! Whole-file index and working tree operations: stage, unstage, discard.

use std::path::Path;

use crate::error::GitResult;
use crate::executor::GitExecutor;
use crate::pathspec::{nul_separated, validate_relative_paths};
use crate::status::{ChangeKind, FileStatus, StatusSnapshot, read_status};

/// Global options so paths are never interpreted as globs or pathspec magic.
const LITERAL: &str = "--literal-pathspecs";
const CLEAN_CHUNK: usize = 100;
const FROM_STDIN: [&str; 2] = ["--pathspec-from-file=-", "--pathspec-file-nul"];

/// Stages modifications, additions and deletions of the given paths.
pub fn stage_paths(git: &GitExecutor, root: &Path, paths: &[String]) -> GitResult<()> {
    validate_relative_paths(paths)?;
    git.run(
        root,
        [LITERAL, "add", "--all", FROM_STDIN[0], FROM_STDIN[1]],
        Some(&nul_separated(paths)),
    )?;
    Ok(())
}

/// Removes the given paths from the index, keeping working tree contents.
pub fn unstage_paths(git: &GitExecutor, root: &Path, paths: &[String]) -> GitResult<()> {
    validate_relative_paths(paths)?;
    let input: Vec<u8> = nul_separated(paths);
    if has_head(git, root)? {
        git.run(
            root,
            [LITERAL, "restore", "--staged", FROM_STDIN[0], FROM_STDIN[1]],
            Some(&input),
        )?;
    } else {
        // Before the first commit there is no HEAD to restore from.
        git.run(
            root,
            [
                LITERAL,
                "rm",
                "--cached",
                "-r",
                "--quiet",
                "--ignore-unmatch",
                FROM_STDIN[0],
                FROM_STDIN[1],
            ],
            Some(&input),
        )?;
    }
    Ok(())
}

/// Stages every change in the working tree.
pub fn stage_all(git: &GitExecutor, root: &Path) -> GitResult<()> {
    git.run(root, ["add", "--all"], None)?;
    Ok(())
}

/// Unstages every staged change.
pub fn unstage_all(git: &GitExecutor, root: &Path) -> GitResult<()> {
    let staged: Vec<String> = read_status(git, root)?
        .files
        .into_iter()
        .filter(|file: &FileStatus| file.staged.is_some())
        .flat_map(|file: FileStatus| file.original_path.into_iter().chain([file.path]))
        .collect();
    if staged.is_empty() {
        return Ok(());
    }
    unstage_paths(git, root, &staged)
}

/// Discards unstaged changes: tracked files are restored from the index and
/// untracked files are deleted. Staged changes are left untouched.
pub fn discard_paths(git: &GitExecutor, root: &Path, paths: &[String]) -> GitResult<()> {
    validate_relative_paths(paths)?;
    let status: StatusSnapshot = read_status(git, root)?;
    let (untracked, tracked): (Vec<String>, Vec<String>) =
        paths.iter().cloned().partition(|path: &String| {
            status.files.iter().any(|file: &FileStatus| {
                &file.path == path && file.unstaged == Some(ChangeKind::Untracked)
            })
        });

    if !tracked.is_empty() {
        git.run(
            root,
            [
                LITERAL,
                "restore",
                "--worktree",
                FROM_STDIN[0],
                FROM_STDIN[1],
            ],
            Some(&nul_separated(&tracked)),
        )?;
    }
    if !untracked.is_empty() {
        // `git clean` only ever removes untracked files, never tracked ones.
        // It has no --pathspec-from-file, so chunk to stay under OS limits.
        for chunk in untracked.chunks(CLEAN_CHUNK) {
            let mut args: Vec<&str> = vec![LITERAL, "clean", "--force", "--quiet", "--"];
            args.extend(chunk.iter().map(String::as_str));
            git.run(root, args, None)?;
        }
    }
    Ok(())
}

pub(crate) fn has_head(git: &GitExecutor, root: &Path) -> GitResult<bool> {
    let output: std::process::Output =
        git.run_unchecked(root, ["rev-parse", "--verify", "--quiet", "HEAD"], None)?;
    Ok(output.status.success())
}
