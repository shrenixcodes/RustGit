//! Merge, rebase, cherry-pick and revert, their continuation/abort, and
//! conflict resolution. Conflicts are an outcome, not an error.

use std::path::Path;
use std::process::Output;

use serde::{Deserialize, Serialize};

use crate::error::{GitError, GitResult};
use crate::executor::GitExecutor;
use crate::history::validate_revision;
use crate::pathspec::validate_relative_path;
use crate::refs::classify_overwrite;
use crate::status::{FileStatus, InProgress, StatusSnapshot, in_progress, read_status};

/// Commit messages use Git's defaults; no editor may open in a GUI process.
const NO_EDITOR: [&str; 2] = ["-c", "core.editor=true"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationOutcome {
    UpToDate,
    FastForward,
    Completed,
    Conflicts,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationResult {
    pub outcome: IntegrationOutcome,
    pub conflicted: Vec<String>,
    pub status: StatusSnapshot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MergeStrategy {
    Default,
    NoFf,
    FfOnly,
}

fn ensure_idle(git: &GitExecutor, root: &Path) -> GitResult<()> {
    match in_progress(git, root)? {
        InProgress::None => Ok(()),
        other => Err(GitError::OperationInProgress(other.describe().to_owned())),
    }
}

/// Interprets the result of a command that may stop with conflicts.
fn finish(
    git: &GitExecutor,
    root: &Path,
    args: &[String],
    output: Output,
) -> GitResult<IntegrationResult> {
    let status: StatusSnapshot = read_status(git, root)?;
    let conflicted: Vec<String> = status
        .files
        .iter()
        .filter(|file: &&FileStatus| file.conflicted)
        .map(|file: &FileStatus| file.path.clone())
        .collect();
    let stdout: String = String::from_utf8_lossy(&output.stdout).into_owned();

    if output.status.success() {
        let outcome: IntegrationOutcome =
            if stdout.contains("Already up to date") || stdout.contains("is up to date") {
                IntegrationOutcome::UpToDate
            } else if stdout.contains("Fast-forward") || stdout.contains("Fast-forwarded") {
                IntegrationOutcome::FastForward
            } else {
                IntegrationOutcome::Completed
            };
        return Ok(IntegrationResult {
            outcome,
            conflicted,
            status,
        });
    }
    // Stopped part-way: Git left the operation in progress for the user.
    if status.in_progress != InProgress::None {
        return Ok(IntegrationResult {
            outcome: IntegrationOutcome::Conflicts,
            conflicted,
            status,
        });
    }
    let stderr: String = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    Err(classify_overwrite(GitError::CommandFailed {
        command: args.join(" "),
        exit_code: output.status.code(),
        stderr: if stderr.is_empty() {
            stdout.trim().to_owned()
        } else {
            stderr
        },
    }))
}

fn run_integration(
    git: &GitExecutor,
    root: &Path,
    args: Vec<String>,
) -> GitResult<IntegrationResult> {
    let output: Output = git.run_unchecked(root, &args, None)?;
    finish(git, root, &args, output)
}

fn owned(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part: &&str| (*part).to_owned()).collect()
}

pub fn merge_branch(
    git: &GitExecutor,
    root: &Path,
    source: &str,
    strategy: MergeStrategy,
) -> GitResult<IntegrationResult> {
    validate_revision(source)?;
    ensure_idle(git, root)?;
    let mut args: Vec<String> = owned(&NO_EDITOR);
    args.extend(owned(&["merge", "--no-edit"]));
    match strategy {
        MergeStrategy::Default => {}
        MergeStrategy::NoFf => args.push("--no-ff".to_owned()),
        MergeStrategy::FfOnly => args.push("--ff-only".to_owned()),
    }
    args.push(source.to_owned());
    run_integration(git, root, args)
}

/// Non-interactive rebase of the current branch onto `onto`.
pub fn rebase_branch(git: &GitExecutor, root: &Path, onto: &str) -> GitResult<IntegrationResult> {
    validate_revision(onto)?;
    ensure_idle(git, root)?;
    let mut args: Vec<String> = owned(&NO_EDITOR);
    args.extend(owned(&["rebase", onto]));
    run_integration(git, root, args)
}

pub fn cherry_pick(
    git: &GitExecutor,
    root: &Path,
    oids: &[String],
) -> GitResult<IntegrationResult> {
    if oids.is_empty() {
        return Err(GitError::InvalidRequest("no commits given".to_owned()));
    }
    for oid in oids {
        validate_revision(oid)?;
    }
    ensure_idle(git, root)?;
    let mut merge_commits: usize = 0;
    for oid in oids {
        let parents: String = git.run_text(
            root,
            ["log", "-1", "--format=%P", "--end-of-options", oid, "--"],
        )?;
        if parents.split_whitespace().count() > 1 {
            merge_commits += 1;
        }
    }
    if merge_commits > 0 && oids.len() > 1 {
        return Err(GitError::InvalidRequest(
            "merge commits can only be cherry-picked on their own".to_owned(),
        ));
    }
    let mut args: Vec<String> = owned(&NO_EDITOR);
    args.push("cherry-pick".to_owned());
    if merge_commits > 0 {
        // Replay the changes the merge brought in relative to its first parent.
        args.extend(owned(&["-m", "1"]));
    }
    args.extend(oids.iter().cloned());
    run_integration(git, root, args)
}

pub fn revert_commit(git: &GitExecutor, root: &Path, oid: &str) -> GitResult<IntegrationResult> {
    validate_revision(oid)?;
    ensure_idle(git, root)?;
    let parents: String = git.run_text(
        root,
        ["log", "-1", "--format=%P", "--end-of-options", oid, "--"],
    )?;
    let mut args: Vec<String> = owned(&NO_EDITOR);
    args.extend(owned(&["revert", "--no-edit"]));
    if parents.split_whitespace().count() > 1 {
        // Reverting a merge: undo the changes it brought relative to the mainline.
        args.extend(owned(&["-m", "1"]));
    }
    args.push(oid.to_owned());
    run_integration(git, root, args)
}

/// Refuses to write through a symlink at the target or any parent below `root`.
fn ensure_no_symlink(root: &Path, target: &Path) -> GitResult<()> {
    let mut current = target;
    while current != root {
        if let Ok(meta) = std::fs::symlink_metadata(current)
            && meta.file_type().is_symlink()
        {
            return Err(GitError::InvalidRequest(
                "refusing to write through a symbolic link".to_owned(),
            ));
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => break,
        }
    }
    Ok(())
}

/// Continues the in-progress merge, rebase, cherry-pick or revert.
pub fn continue_operation(git: &GitExecutor, root: &Path) -> GitResult<IntegrationResult> {
    let mut args: Vec<String> = owned(&NO_EDITOR);
    match in_progress(git, root)? {
        InProgress::None => {
            return Err(GitError::InvalidRequest(
                "no operation is in progress".to_owned(),
            ));
        }
        InProgress::Merging => args.extend(owned(&["commit", "--no-edit"])),
        InProgress::Rebasing => args.extend(owned(&["rebase", "--continue"])),
        InProgress::CherryPicking => args.extend(owned(&["cherry-pick", "--continue"])),
        InProgress::Reverting => args.extend(owned(&["revert", "--continue"])),
    }
    run_integration(git, root, args)
}

/// Skips the current step of an in-progress rebase, cherry-pick or revert,
/// for example when resolving its conflicts left nothing to commit. A merge
/// has no steps to skip.
pub fn skip_operation(git: &GitExecutor, root: &Path) -> GitResult<IntegrationResult> {
    let command: &str = match in_progress(git, root)? {
        InProgress::None => {
            return Err(GitError::InvalidRequest(
                "no operation is in progress".to_owned(),
            ));
        }
        InProgress::Merging => {
            return Err(GitError::InvalidRequest(
                "a merge cannot skip a step; continue or abort it".to_owned(),
            ));
        }
        InProgress::Rebasing => "rebase",
        InProgress::CherryPicking => "cherry-pick",
        InProgress::Reverting => "revert",
    };
    let mut args: Vec<String> = owned(&NO_EDITOR);
    args.extend(owned(&[command, "--skip"]));
    run_integration(git, root, args)
}

/// Aborts the in-progress operation and restores the pre-operation state.
pub fn abort_operation(git: &GitExecutor, root: &Path) -> GitResult<StatusSnapshot> {
    let command: &str = match in_progress(git, root)? {
        InProgress::None => {
            return Err(GitError::InvalidRequest(
                "no operation is in progress".to_owned(),
            ));
        }
        InProgress::Merging => "merge",
        InProgress::Rebasing => "rebase",
        InProgress::CherryPicking => "cherry-pick",
        InProgress::Reverting => "revert",
    };
    git.run(root, [command, "--abort"], None)?;
    read_status(git, root)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictVersions {
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    pub working: String,
    pub ours_label: String,
    pub theirs_label: String,
    pub binary: bool,
}

pub fn conflict_versions(
    git: &GitExecutor,
    root: &Path,
    path: &str,
) -> GitResult<ConflictVersions> {
    validate_relative_path(path)?;
    let stages: String = git.run_text(
        root,
        ["--literal-pathspecs", "ls-files", "--unmerged", "--", path],
    )?;
    if stages.trim().is_empty() {
        return Err(GitError::InvalidRequest(format!(
            "'{path}' is not conflicted"
        )));
    }
    let stage = |number: u8| -> GitResult<Option<Vec<u8>>> {
        let present: bool = stages
            .lines()
            .any(|line: &str| line.split_whitespace().nth(2) == Some(&number.to_string()));
        if !present {
            return Ok(None);
        }
        Ok(Some(
            git.run(
                root,
                ["cat-file", "blob", &format!(":{number}:{path}")],
                None,
            )?
            .stdout,
        ))
    };
    let base: Option<Vec<u8>> = stage(1)?;
    let ours: Option<Vec<u8>> = stage(2)?;
    let theirs: Option<Vec<u8>> = stage(3)?;
    let working: Vec<u8> = std::fs::read(root.join(path)).unwrap_or_default();

    let binary: bool = [&base, &ours, &theirs]
        .into_iter()
        .flatten()
        .chain(std::iter::once(&working))
        .any(|content: &Vec<u8>| content.iter().take(8000).any(|byte: &u8| *byte == 0));
    let text = |content: Option<Vec<u8>>| -> Option<String> {
        if binary {
            None
        } else {
            content.map(|bytes: Vec<u8>| String::from_utf8_lossy(&bytes).into_owned())
        }
    };
    let (ours_label, theirs_label) = labels(git, root)?;
    Ok(ConflictVersions {
        base: text(base),
        ours: text(ours),
        theirs: text(theirs),
        working: if binary {
            String::new()
        } else {
            String::from_utf8_lossy(&working).into_owned()
        },
        ours_label,
        theirs_label,
        binary,
    })
}

fn describe(git: &GitExecutor, root: &Path, revision: &str) -> String {
    git.run_text(root, ["log", "-1", "--format=%h %s", revision, "--"])
        .map(|text: String| text.trim().to_owned())
        .unwrap_or_else(|_| revision.to_owned())
}

fn labels(git: &GitExecutor, root: &Path) -> GitResult<(String, String)> {
    let branch: String = git
        .run_text(root, ["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|text: String| text.trim().to_owned())
        .unwrap_or_else(|_| "HEAD".to_owned());
    Ok(match in_progress(git, root)? {
        InProgress::Rebasing => (
            format!("Base being rebased onto ({})", describe(git, root, "HEAD")),
            format!(
                "Commit being replayed ({})",
                describe(git, root, "REBASE_HEAD")
            ),
        ),
        InProgress::Merging => (
            format!("Current branch ({branch})"),
            format!("Incoming ({})", describe(git, root, "MERGE_HEAD")),
        ),
        InProgress::CherryPicking => (
            format!("Current branch ({branch})"),
            format!(
                "Cherry-picked commit ({})",
                describe(git, root, "CHERRY_PICK_HEAD")
            ),
        ),
        InProgress::Reverting => (
            format!("Current branch ({branch})"),
            format!("Revert of ({})", describe(git, root, "REVERT_HEAD")),
        ),
        InProgress::None => (format!("Current branch ({branch})"), "Incoming".to_owned()),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictSide {
    Ours,
    Theirs,
}

/// Resolves a conflicted file with explicit content or one side, then stages it.
pub fn resolve_conflict(
    git: &GitExecutor,
    root: &Path,
    path: &str,
    content: Option<&str>,
    take: Option<ConflictSide>,
) -> GitResult<StatusSnapshot> {
    validate_relative_path(path)?;
    let unmerged: String = git.run_text(
        root,
        ["--literal-pathspecs", "ls-files", "--unmerged", "--", path],
    )?;
    if unmerged.trim().is_empty() {
        return Err(GitError::InvalidRequest(format!(
            "'{path}' has no conflict to resolve"
        )));
    }
    // Removing a file with `git rm` already records the resolution.
    let mut needs_add: bool = true;
    match (content, take) {
        (Some(content), None) => {
            let target = root.join(path);
            ensure_no_symlink(root, &target)?;
            std::fs::write(target, content)?
        }
        (None, Some(side)) => {
            let (flag, stage): (&str, &str) = match side {
                ConflictSide::Ours => ("--ours", "2"),
                ConflictSide::Theirs => ("--theirs", "3"),
            };
            // Each line is "<mode> <oid> <stage>\t<path>". A side without a
            // stage deleted the file, so taking it means removing the file.
            let side_exists: bool = unmerged.lines().any(|line: &str| {
                line.split('\t')
                    .next()
                    .and_then(|meta: &str| meta.split(' ').nth(2))
                    == Some(stage)
            });
            if side_exists {
                git.run(
                    root,
                    ["--literal-pathspecs", "checkout", flag, "--", path],
                    None,
                )?;
            } else {
                git.run(
                    root,
                    ["--literal-pathspecs", "rm", "--quiet", "--", path],
                    None,
                )?;
                needs_add = false;
            }
        }
        _ => {
            return Err(GitError::InvalidRequest(
                "give exactly one of content or take".to_owned(),
            ));
        }
    }
    if needs_add {
        git.run(root, ["--literal-pathspecs", "add", "--", path], None)?;
    }
    let remaining: String = git.run_text(
        root,
        ["--literal-pathspecs", "ls-files", "--unmerged", "--", path],
    )?;
    if !remaining.trim().is_empty() {
        return Err(GitError::CommandFailed {
            command: "add".to_owned(),
            exit_code: None,
            stderr: format!("'{path}' is still unmerged"),
        });
    }
    read_status(git, root)
}
