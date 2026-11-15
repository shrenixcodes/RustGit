//! Stash entries, identified by commit id rather than the shifting `stash@{n}`.

use std::path::Path;

use serde::Serialize;

use crate::diff::FileDiff;
use crate::error::{GitError, GitResult};
use crate::executor::GitExecutor;
use crate::history::{tree_file_diff, validate_revision};
use crate::integrate::{IntegrationOutcome, IntegrationResult};
use crate::refs::classify_overwrite;
use crate::status::{ChangeKind, FileStatus, StatusSnapshot, read_status};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub index: usize,
    pub oid: String,
    pub message: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashFile {
    pub path: String,
    pub kind: ChangeKind,
    pub untracked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashDetails {
    pub files: Vec<StashFile>,
}

pub fn list_stashes(git: &GitExecutor, root: &Path) -> GitResult<Vec<StashEntry>> {
    let output: std::process::Output = git.run(
        root,
        ["stash", "list", "-z", "--format=%H%x1f%ct%x1f%gs"],
        None,
    )?;
    output
        .stdout
        .split(|byte: &u8| *byte == 0)
        .filter(|record: &&[u8]| !record.is_empty())
        .enumerate()
        .map(|(index, record)| {
            let text: String = String::from_utf8_lossy(record).into_owned();
            let fields: Vec<&str> = text.trim_start_matches('\n').splitn(3, '\u{1f}').collect();
            match fields.as_slice() {
                [oid, time, message] => Ok(StashEntry {
                    index,
                    oid: (*oid).to_owned(),
                    message: (*message).to_owned(),
                    created_at: time.parse().unwrap_or(0),
                }),
                _ => Err(GitError::Parse {
                    command: "stash list".to_owned(),
                    detail: format!("unexpected record: {text}"),
                }),
            }
        })
        .collect()
}

/// Current `stash@{n}` for a stash commit, or `stale_diff` if it is gone.
fn stash_ref(git: &GitExecutor, root: &Path, oid: &str) -> GitResult<String> {
    validate_revision(oid)?;
    list_stashes(git, root)?
        .into_iter()
        .find(|entry: &StashEntry| entry.oid == oid)
        .map(|entry: StashEntry| format!("stash@{{{}}}", entry.index))
        .ok_or_else(|| GitError::StaleDiff(format!("stash {oid} no longer exists")))
}

pub fn create_stash(
    git: &GitExecutor,
    root: &Path,
    message: Option<&str>,
    include_untracked: bool,
) -> GitResult<StatusSnapshot> {
    let before: usize = list_stashes(git, root)?.len();
    let mut args: Vec<&str> = vec!["stash", "push"];
    if include_untracked {
        args.push("--include-untracked");
    }
    if let Some(message) = message.filter(|message: &&str| !message.trim().is_empty()) {
        args.extend(["--message", message]);
    }
    git.run(root, args, None)?;
    if list_stashes(git, root)?.len() == before {
        return Err(GitError::InvalidRequest(
            "there are no local changes to stash".to_owned(),
        ));
    }
    read_status(git, root)
}

/// Applies (or pops) a stash. Conflicts are an outcome; a popped stash is
/// kept by Git when its application conflicts.
pub fn apply_stash(
    git: &GitExecutor,
    root: &Path,
    oid: &str,
    pop: bool,
) -> GitResult<IntegrationResult> {
    let reference: String = stash_ref(git, root, oid)?;
    let command: &str = if pop { "pop" } else { "apply" };
    let output: std::process::Output =
        git.run_unchecked(root, ["stash", command, &reference], None)?;
    let status: StatusSnapshot = read_status(git, root)?;
    let conflicted: Vec<String> = status
        .files
        .iter()
        .filter(|file: &&FileStatus| file.conflicted)
        .map(|file: &FileStatus| file.path.clone())
        .collect();
    if output.status.success() {
        return Ok(IntegrationResult {
            outcome: IntegrationOutcome::Completed,
            conflicted,
            status,
        });
    }
    if !conflicted.is_empty() {
        return Ok(IntegrationResult {
            outcome: IntegrationOutcome::Conflicts,
            conflicted,
            status,
        });
    }
    Err(classify_overwrite(GitError::CommandFailed {
        command: format!("stash {command}"),
        exit_code: output.status.code(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
    }))
}

/// Destructive: the stash's changes are lost unless applied elsewhere.
pub fn drop_stash(git: &GitExecutor, root: &Path, oid: &str) -> GitResult<Vec<StashEntry>> {
    let reference: String = stash_ref(git, root, oid)?;
    git.run(root, ["stash", "drop", &reference], None)?;
    list_stashes(git, root)
}

fn has_untracked_part(git: &GitExecutor, root: &Path, oid: &str) -> GitResult<bool> {
    let output: std::process::Output = git.run_unchecked(
        root,
        ["rev-parse", "--verify", "--quiet", &format!("{oid}^3")],
        None,
    )?;
    Ok(output.status.success())
}

pub fn stash_details(git: &GitExecutor, root: &Path, oid: &str) -> GitResult<StashDetails> {
    stash_ref(git, root, oid)?;
    let base: String = format!("{oid}^1");
    let tracked: std::process::Output = git.run(
        root,
        [
            "diff",
            "-z",
            "--name-status",
            "--find-renames",
            &base,
            oid,
            "--",
        ],
        None,
    )?;
    let mut files: Vec<StashFile> = Vec::new();
    let mut fields = tracked
        .stdout
        .split(|byte: &u8| *byte == 0)
        .map(|field: &[u8]| String::from_utf8_lossy(field).into_owned());
    while let Some(status) = fields.next() {
        if status.is_empty() {
            continue;
        }
        let kind: ChangeKind = match status.chars().next() {
            Some('A') => ChangeKind::Added,
            Some('D') => ChangeKind::Deleted,
            Some('R') => {
                // Skip the original path of a rename.
                fields.next();
                ChangeKind::Renamed
            }
            Some('T') => ChangeKind::TypeChanged,
            _ => ChangeKind::Modified,
        };
        if let Some(path) = fields.next() {
            files.push(StashFile {
                path,
                kind,
                untracked: false,
            });
        }
    }
    if has_untracked_part(git, root, oid)? {
        let untracked: std::process::Output = git.run(
            root,
            ["ls-tree", "-r", "-z", "--name-only", &format!("{oid}^3")],
            None,
        )?;
        files.extend(
            untracked
                .stdout
                .split(|byte: &u8| *byte == 0)
                .filter(|path: &&[u8]| !path.is_empty())
                .map(|path: &[u8]| StashFile {
                    path: String::from_utf8_lossy(path).into_owned(),
                    kind: ChangeKind::Untracked,
                    untracked: true,
                }),
        );
    }
    Ok(StashDetails { files })
}

pub fn stash_file_diff(
    git: &GitExecutor,
    root: &Path,
    oid: &str,
    path: &str,
    context_lines: u32,
) -> GitResult<FileDiff> {
    let details: StashDetails = stash_details(git, root, oid)?;
    let file: &StashFile = details
        .files
        .iter()
        .find(|file: &&StashFile| file.path == path)
        .ok_or_else(|| GitError::InvalidRequest(format!("'{path}' is not part of the stash")))?;
    if file.untracked {
        tree_file_diff(
            git,
            root,
            None,
            &format!("{oid}^3"),
            path,
            None,
            context_lines,
        )
    } else {
        tree_file_diff(
            git,
            root,
            Some(&format!("{oid}^1")),
            oid,
            path,
            None,
            context_lines,
        )
    }
}
