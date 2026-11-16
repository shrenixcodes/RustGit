//! Comparison of two revisions (request R-16): commit counts and changed files.

use std::path::Path;

use serde::Serialize;

use crate::diff::{FileDiff, parse_numstat};
use crate::error::{GitError, GitResult};
use crate::executor::GitExecutor;
use crate::history::{CommitFile, parse_name_status, tree_file_diff, validate_revision};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    /// Resolved full object ids.
    pub base: String,
    pub head: String,
    /// The merge base the files were compared from (three-dot comparison).
    pub merge_base: Option<String>,
    /// Commits reachable from head and not from base.
    pub ahead: u32,
    /// Commits reachable from base and not from head.
    pub behind: u32,
    pub files: Vec<CommitFile>,
}

/// Resolves `revision` to a commit id; unknown revisions are `InvalidRequest`
/// naming the revision and its role.
fn resolve_commit(git: &GitExecutor, root: &Path, revision: &str, role: &str) -> GitResult<String> {
    validate_revision(revision)?;
    let spec: String = format!("{revision}^{{commit}}");
    match git.run_text(
        root,
        [
            "rev-parse",
            "--verify",
            "--quiet",
            "--end-of-options",
            spec.as_str(),
        ],
    ) {
        Ok(oid) if !oid.trim().is_empty() => Ok(oid.trim().to_owned()),
        Ok(_) | Err(GitError::CommandFailed { .. }) => Err(GitError::InvalidRequest(format!(
            "{role} revision '{revision}' does not name a commit"
        ))),
        Err(error) => Err(error),
    }
}

/// The tree the files are compared from: `base` itself, or the merge base of
/// `base` and `head` when `merge_base` is set.
fn from_commit(
    git: &GitExecutor,
    root: &Path,
    base: &str,
    head: &str,
    merge_base: bool,
) -> GitResult<Option<String>> {
    if !merge_base {
        return Ok(Some(base.to_owned()));
    }
    match git.run_text(root, ["merge-base", base, head]) {
        Ok(oid) => Ok(Some(oid.trim().to_owned()).filter(|oid: &String| !oid.is_empty())),
        // Exit 1: unrelated histories; compare from the empty tree.
        Err(GitError::CommandFailed {
            exit_code: Some(1), ..
        }) => Ok(None),
        Err(error) => Err(error),
    }
}

fn tree_changes(
    git: &GitExecutor,
    root: &Path,
    from: Option<&str>,
    to: &str,
    mode: &str,
) -> GitResult<Vec<u8>> {
    let output: std::process::Output = match from {
        Some(from) => git.run(
            root,
            [
                "diff",
                "-z",
                "--find-renames",
                "--no-ext-diff",
                mode,
                from,
                to,
                "--",
            ],
            None,
        )?,
        None => git.run(
            root,
            [
                "diff-tree",
                "-r",
                "-z",
                "--root",
                "--find-renames",
                "--no-commit-id",
                mode,
                to,
                "--",
            ],
            None,
        )?,
    };
    Ok(output.stdout)
}

pub fn compare_revisions(
    git: &GitExecutor,
    root: &Path,
    base: &str,
    head: &str,
    merge_base: bool,
) -> GitResult<Comparison> {
    let base: String = resolve_commit(git, root, base, "base")?;
    let head: String = resolve_commit(git, root, head, "head")?;

    let range: String = format!("{base}...{head}");
    let counts: String = git.run_text(
        root,
        ["rev-list", "--left-right", "--count", range.as_str(), "--"],
    )?;
    let mut numbers = counts.split_whitespace().map(str::parse::<u32>);
    let (behind, ahead) = match (numbers.next(), numbers.next()) {
        (Some(Ok(behind)), Some(Ok(ahead))) => (behind, ahead),
        _ => {
            return Err(GitError::Parse {
                command: "rev-list --count".to_owned(),
                detail: format!("expected two counts, got '{}'", counts.trim()),
            });
        }
    };

    let from: Option<String> = from_commit(git, root, &base, &head, merge_base)?;
    let status_raw: Vec<u8> = tree_changes(git, root, from.as_deref(), &head, "--name-status")?;
    let numstat_raw: Vec<u8> = tree_changes(git, root, from.as_deref(), &head, "--numstat")?;
    let numstat = parse_numstat(&numstat_raw)?;
    let mut files: Vec<CommitFile> = parse_name_status(&status_raw)?;
    for file in &mut files {
        if let Some(totals) = numstat.files.iter().find(|totals| totals.path == file.path) {
            file.additions = totals.added;
            file.deletions = totals.deleted;
        }
    }

    Ok(Comparison {
        merge_base: if merge_base { from } else { None },
        base,
        head,
        ahead,
        behind,
        files,
    })
}

#[expect(
    clippy::too_many_arguments,
    reason = "mirrors the IPC request fields one to one"
)]
pub fn compare_file_diff(
    git: &GitExecutor,
    root: &Path,
    base: &str,
    head: &str,
    merge_base: bool,
    path: &str,
    original_path: Option<&str>,
    context_lines: u32,
) -> GitResult<FileDiff> {
    let base: String = resolve_commit(git, root, base, "base")?;
    let head: String = resolve_commit(git, root, head, "head")?;
    let from: Option<String> = from_commit(git, root, &base, &head, merge_base)?;
    tree_file_diff(
        git,
        root,
        from.as_deref(),
        &head,
        path,
        original_path,
        context_lines,
    )
}
