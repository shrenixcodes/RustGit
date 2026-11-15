//! References (branches, remote branches, tags) and branch operations.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{GitError, GitResult};
use crate::executor::GitExecutor;
use crate::history::validate_revision;
use crate::index::has_head;
use crate::status::{ChangeKind, FileStatus, read_status};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HeadState {
    Branch { name: String },
    Detached { oid: String },
    Unborn { name: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RefKind {
    Local,
    Remote,
    Tag,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefEntry {
    pub full_name: String,
    pub short_name: String,
    pub kind: RefKind,
    pub oid: String,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub upstream_gone: bool,
    pub last_commit_time: i64,
    pub last_commit_summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefList {
    pub head: HeadState,
    pub refs: Vec<RefEntry>,
}

const REF_FORMAT: &str = "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(committerdate:unix)%00%(*committerdate:unix)%00%(contents:subject)%00%(*contents:subject)%00%(symref)";

pub fn list_refs(git: &GitExecutor, root: &Path) -> GitResult<RefList> {
    let output: String = git.run_text(
        root,
        [
            "for-each-ref",
            REF_FORMAT,
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?;
    let refs: Vec<RefEntry> = output
        .lines()
        .filter(|line: &&str| !line.is_empty())
        .filter_map(|line: &str| parse_ref_line(line).transpose())
        .collect::<GitResult<Vec<RefEntry>>>()?;
    Ok(RefList {
        head: head_state(git, root)?,
        refs,
    })
}

fn parse_ref_line(line: &str) -> GitResult<Option<RefEntry>> {
    let fields: Vec<&str> = line.split('\0').collect();
    if fields.len() != 10 {
        return Err(GitError::Parse {
            command: "for-each-ref".to_owned(),
            detail: format!("unexpected record: {line}"),
        });
    }
    // Symbolic refs such as refs/remotes/origin/HEAD are aliases; skip them.
    if !fields[9].is_empty() {
        return Ok(None);
    }
    let full_name: &str = fields[0];
    let (kind, short_name): (RefKind, &str) =
        if let Some(name) = full_name.strip_prefix("refs/heads/") {
            (RefKind::Local, name)
        } else if let Some(name) = full_name.strip_prefix("refs/remotes/") {
            (RefKind::Remote, name)
        } else if let Some(name) = full_name.strip_prefix("refs/tags/") {
            (RefKind::Tag, name)
        } else {
            return Ok(None);
        };
    let peeled: bool = !fields[2].is_empty();
    let upstream: Option<String> = (!fields[3].is_empty()).then(|| fields[3].to_owned());
    let track: &str = fields[4];
    let upstream_gone: bool = track == "gone";
    let (ahead, behind) = if upstream.is_none() || upstream_gone {
        (None, None)
    } else {
        parse_track(track)
    };
    Ok(Some(RefEntry {
        full_name: full_name.to_owned(),
        short_name: short_name.to_owned(),
        kind,
        oid: if peeled { fields[2] } else { fields[1] }.to_owned(),
        upstream,
        ahead,
        behind,
        upstream_gone,
        last_commit_time: if peeled { fields[6] } else { fields[5] }
            .parse()
            .unwrap_or(0),
        last_commit_summary: if peeled { fields[8] } else { fields[7] }.to_owned(),
    }))
}

/// Parses `%(upstream:track,nobracket)`: "", "ahead 1", "behind 2", "ahead 1, behind 2".
fn parse_track(track: &str) -> (Option<u32>, Option<u32>) {
    let mut ahead: u32 = 0;
    let mut behind: u32 = 0;
    for part in track.split(", ") {
        if let Some(count) = part.strip_prefix("ahead ") {
            ahead = count.parse().unwrap_or(0);
        } else if let Some(count) = part.strip_prefix("behind ") {
            behind = count.parse().unwrap_or(0);
        }
    }
    (Some(ahead), Some(behind))
}

fn head_state(git: &GitExecutor, root: &Path) -> GitResult<HeadState> {
    let symbolic: std::process::Output =
        git.run_unchecked(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], None)?;
    let born: bool = has_head(git, root)?;
    if symbolic.status.success() {
        let name: String = String::from_utf8_lossy(&symbolic.stdout).trim().to_owned();
        return Ok(if born {
            HeadState::Branch { name }
        } else {
            HeadState::Unborn { name }
        });
    }
    let oid: String = git.run_text(root, ["rev-parse", "HEAD"])?.trim().to_owned();
    Ok(HeadState::Detached { oid })
}

fn validate_branch_name(git: &GitExecutor, root: &Path, name: &str) -> GitResult<()> {
    if name.starts_with('-') || name.contains('\0') {
        return Err(GitError::InvalidRefName(name.to_owned()));
    }
    let output: std::process::Output =
        git.run_unchecked(root, ["check-ref-format", "--branch", name], None)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(GitError::InvalidRefName(name.to_owned()))
    }
}

fn ref_exists(git: &GitExecutor, root: &Path, full_name: &str) -> GitResult<bool> {
    let output: std::process::Output =
        git.run_unchecked(root, ["show-ref", "--verify", "--quiet", full_name], None)?;
    Ok(output.status.success())
}

/// Turns Git's "would be overwritten" refusal into a typed error.
pub(crate) fn classify_overwrite(error: GitError) -> GitError {
    match error {
        GitError::CommandFailed { ref stderr, .. } if stderr.contains("would be overwritten") => {
            let paths: Vec<String> = stderr
                .lines()
                .filter(|line: &&str| line.starts_with('\t'))
                .map(|line: &str| line.trim().to_owned())
                .collect();
            GitError::WouldOverwriteChanges(paths)
        }
        other => other,
    }
}

pub fn create_branch(
    git: &GitExecutor,
    root: &Path,
    name: &str,
    start_point: Option<&str>,
    checkout: bool,
) -> GitResult<()> {
    validate_branch_name(git, root, name)?;
    if ref_exists(git, root, &format!("refs/heads/{name}"))? {
        return Err(GitError::BranchExists(name.to_owned()));
    }
    if let Some(start) = start_point {
        validate_revision(start)?;
    }
    let mut args: Vec<&str> = if checkout {
        vec!["switch", "--create", name]
    } else {
        vec!["branch", name]
    };
    if let Some(start) = start_point {
        args.push(start);
    }
    git.run(root, args, None).map_err(classify_overwrite)?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckoutMode {
    /// Carry local changes over when Git can do so safely.
    KeepChanges,
    /// Refuse if any tracked file has changes.
    AbortIfDirty,
}

/// Switches to a local branch, or creates a tracking branch for a remote one.
/// Local changes are never discarded.
pub fn checkout_branch(
    git: &GitExecutor,
    root: &Path,
    name: &str,
    mode: CheckoutMode,
) -> GitResult<()> {
    validate_revision(name)?;
    if mode == CheckoutMode::AbortIfDirty {
        let dirty: bool = read_status(git, root)?
            .files
            .iter()
            .any(|file: &FileStatus| {
                file.staged.is_some()
                    || matches!(file.unstaged, Some(kind) if kind != ChangeKind::Untracked)
            });
        if dirty {
            return Err(GitError::WouldOverwriteChanges(Vec::new()));
        }
    }

    let args: Vec<String> = if ref_exists(git, root, &format!("refs/heads/{name}"))? {
        vec!["switch".to_owned(), name.to_owned()]
    } else if ref_exists(git, root, &format!("refs/remotes/{name}"))? {
        let local: &str = name.split_once('/').map_or(name, |(_, branch)| branch);
        if ref_exists(git, root, &format!("refs/heads/{local}"))? {
            return Err(GitError::BranchExists(local.to_owned()));
        }
        vec![
            "switch".to_owned(),
            "--create".to_owned(),
            local.to_owned(),
            "--track".to_owned(),
            name.to_owned(),
        ]
    } else {
        return Err(GitError::InvalidRequest(format!(
            "no branch named '{name}'"
        )));
    };
    git.run(root, &args, None).map_err(classify_overwrite)?;
    Ok(())
}

pub fn rename_branch(git: &GitExecutor, root: &Path, from: &str, to: &str) -> GitResult<()> {
    validate_revision(from)?;
    validate_branch_name(git, root, to)?;
    if ref_exists(git, root, &format!("refs/heads/{to}"))? {
        return Err(GitError::BranchExists(to.to_owned()));
    }
    git.run(root, ["branch", "--move", from, to], None)?;
    Ok(())
}

pub fn delete_branch(git: &GitExecutor, root: &Path, name: &str, force: bool) -> GitResult<()> {
    validate_revision(name)?;
    let flag: &str = if force { "-D" } else { "-d" };
    git.run(root, ["branch", flag, name], None)
        .map_err(|error: GitError| match error {
            GitError::CommandFailed { ref stderr, .. } if stderr.contains("not fully merged") => {
                GitError::BranchNotFullyMerged(name.to_owned())
            }
            other => other,
        })?;
    Ok(())
}

pub fn set_upstream(
    git: &GitExecutor,
    root: &Path,
    branch: &str,
    upstream: Option<&str>,
) -> GitResult<()> {
    validate_revision(branch)?;
    match upstream {
        Some(upstream) => {
            validate_revision(upstream)?;
            git.run(
                root,
                ["branch", &format!("--set-upstream-to={upstream}"), branch],
                None,
            )?;
        }
        None => {
            git.run(root, ["branch", "--unset-upstream", branch], None)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Joins fields with NUL, like `for-each-ref` with `%00`.
    fn record(fields: &[&str]) -> String {
        fields.join("\0")
    }

    #[test]
    fn parses_ref_records() {
        let local = parse_ref_line(&record(&[
            "refs/heads/main",
            "abc",
            "",
            "origin/main",
            "ahead 2, behind 1",
            "100",
            "",
            "Fix it",
            "",
            "",
        ]))
        .expect("parse")
        .expect("entry");
        assert_eq!(local.kind, RefKind::Local);
        assert_eq!((local.ahead, local.behind), (Some(2), Some(1)));
        assert_eq!(local.last_commit_summary, "Fix it");

        let gone = parse_ref_line(&record(&[
            "refs/heads/old",
            "abc",
            "",
            "origin/old",
            "gone",
            "100",
            "",
            "s",
            "",
            "",
        ]))
        .expect("parse")
        .expect("entry");
        assert!(gone.upstream_gone);
        assert_eq!(gone.ahead, None);

        let tag = parse_ref_line(&record(&[
            "refs/tags/v1",
            "tagobj",
            "commit1",
            "",
            "",
            "",
            "200",
            "tag msg",
            "Release",
            "",
        ]))
        .expect("parse")
        .expect("entry");
        assert_eq!(tag.oid, "commit1");
        assert_eq!(tag.last_commit_time, 200);
        assert_eq!(tag.last_commit_summary, "Release");

        let symbolic = parse_ref_line(&record(&[
            "refs/remotes/origin/HEAD",
            "abc",
            "",
            "",
            "",
            "100",
            "",
            "s",
            "",
            "refs/remotes/origin/main",
        ]))
        .expect("parse");
        assert!(symbolic.is_none());
    }

    #[test]
    fn classifies_overwrite_errors() {
        let error: GitError = classify_overwrite(GitError::CommandFailed {
            command: "switch".to_owned(),
            exit_code: Some(1),
            stderr: "error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\n\tdir/b.txt\nPlease commit your changes or stash them before you switch branches.\nAborting".to_owned(),
        });
        assert!(
            matches!(&error, GitError::WouldOverwriteChanges(paths) if paths == &["a.txt", "dir/b.txt"]),
            "{error:?}"
        );
    }
}
