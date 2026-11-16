//! Commit log pages, commit details and diffs of committed files.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::diff::{DiffSide, FileDiff, parse_file_diff, parse_numstat, unified_arg};
use crate::error::{GitError, GitResult};
use crate::executor::GitExecutor;
use crate::index::has_head;
use crate::pathspec::validate_relative_path;
use crate::status::ChangeKind;

const FIELD: char = '\u{1f}';
const LOG_FORMAT: &str = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%ct%x1f%s";
const MAX_PAGE: u32 = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchField {
    Message,
    Author,
    Sha,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LogSearch {
    pub text: String,
    pub field: SearchField,
}

#[derive(Debug, Clone, Default)]
pub struct LogQuery {
    /// `None` walks HEAD, branches, remote branches and tags.
    pub revisions: Option<Vec<String>>,
    pub skip: u32,
    pub limit: u32,
    pub search: Option<LogSearch>,
    /// Unix seconds, inclusive bounds on committer time.
    pub since: Option<i64>,
    pub until: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogCommit {
    pub oid: String,
    pub parents: Vec<String>,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    pub author_time: i64,
    pub committer_time: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub commits: Vec<LogCommit>,
    pub has_more: bool,
}

/// Rejects revision arguments that Git could parse as options.
pub(crate) fn validate_revision(revision: &str) -> GitResult<()> {
    if revision.is_empty() || revision.starts_with('-') || revision.contains('\0') {
        return Err(GitError::InvalidRequest(format!(
            "'{revision}' is not a valid revision"
        )));
    }
    Ok(())
}

pub fn log_page(git: &GitExecutor, root: &Path, query: &LogQuery) -> GitResult<LogPage> {
    if query.limit == 0 || query.limit > MAX_PAGE {
        return Err(GitError::InvalidRequest(format!(
            "limit must be between 1 and {MAX_PAGE}"
        )));
    }

    if let Some(LogSearch {
        text,
        field: SearchField::Sha,
    }) = &query.search
    {
        return sha_lookup(git, root, text);
    }

    let mut args: Vec<String> = vec![
        "log".to_owned(),
        "--topo-order".to_owned(),
        "-z".to_owned(),
        LOG_FORMAT.to_owned(),
        format!("--skip={}", query.skip),
        format!("--max-count={}", query.limit + 1),
    ];
    if let Some(search) = &query.search {
        args.push("--regexp-ignore-case".to_owned());
        args.push("--fixed-strings".to_owned());
        match search.field {
            SearchField::Message => args.push(format!("--grep={}", search.text)),
            SearchField::Author => args.push(format!("--author={}", search.text)),
            SearchField::Sha => {}
        }
    }
    if let Some(since) = query.since {
        args.push(format!("--max-age={since}"));
    }
    if let Some(until) = query.until {
        args.push(format!("--min-age={until}"));
    }

    match &query.revisions {
        Some(revisions) => {
            for revision in revisions {
                validate_revision(revision)?;
            }
            args.push("--end-of-options".to_owned());
            args.extend(revisions.iter().cloned());
        }
        None => {
            args.extend(["--branches", "--remotes", "--tags"].map(str::to_owned));
            if has_head(git, root)? {
                args.push("HEAD".to_owned());
            } else if !has_any_ref(git, root)? {
                // Unborn branch and no refs: nothing to walk.
                return Ok(LogPage {
                    commits: Vec::new(),
                    has_more: false,
                });
            }
        }
    }
    args.push("--".to_owned());

    let output: std::process::Output = git.run(root, &args, None)?;
    let mut commits: Vec<LogCommit> = parse_log(&output.stdout)?;
    let has_more: bool = commits.len() > query.limit as usize;
    commits.truncate(query.limit as usize);
    Ok(LogPage { commits, has_more })
}

fn has_any_ref(git: &GitExecutor, root: &Path) -> GitResult<bool> {
    let output: std::process::Output = git.run(
        root,
        [
            "for-each-ref",
            "--count=1",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
        None,
    )?;
    Ok(!output.stdout.is_empty())
}

fn sha_lookup(git: &GitExecutor, root: &Path, text: &str) -> GitResult<LogPage> {
    let prefix: &str = text.trim();
    if !(4..=64).contains(&prefix.len()) || !prefix.chars().all(|c: char| c.is_ascii_hexdigit()) {
        return Err(GitError::InvalidRequest(
            "a commit id search needs 4 to 64 hexadecimal characters".to_owned(),
        ));
    }
    let resolved: std::process::Output = git.run_unchecked(
        root,
        [
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{prefix}^{{commit}}"),
        ],
        None,
    )?;
    if !resolved.status.success() {
        return Ok(LogPage {
            commits: Vec::new(),
            has_more: false,
        });
    }
    let oid: String = String::from_utf8_lossy(&resolved.stdout).trim().to_owned();
    let output: std::process::Output = git.run(
        root,
        [
            "log",
            "-1",
            "-z",
            LOG_FORMAT,
            "--end-of-options",
            &oid,
            "--",
        ],
        None,
    )?;
    Ok(LogPage {
        commits: parse_log(&output.stdout)?,
        has_more: false,
    })
}

pub(crate) fn parse_log(raw: &[u8]) -> GitResult<Vec<LogCommit>> {
    raw.split(|byte: &u8| *byte == 0)
        .filter(|record: &&[u8]| !record.is_empty())
        .map(|record: &[u8]| {
            let text: String = String::from_utf8_lossy(record).into_owned();
            let record: &str = text.trim_start_matches('\n');
            let fields: Vec<&str> = record.splitn(7, FIELD).collect();
            let field = |index: usize| -> GitResult<&str> {
                fields.get(index).copied().ok_or_else(|| GitError::Parse {
                    command: "log".to_owned(),
                    detail: format!("incomplete record: {record}"),
                })
            };
            Ok(LogCommit {
                oid: field(0)?.to_owned(),
                parents: field(1)?.split_whitespace().map(str::to_owned).collect(),
                author_name: field(2)?.to_owned(),
                author_email: field(3)?.to_owned(),
                author_time: field(4)?.parse().unwrap_or(0),
                committer_time: field(5)?.parse().unwrap_or(0),
                summary: field(6)?.to_owned(),
            })
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub path: String,
    pub original_path: Option<String>,
    pub kind: ChangeKind,
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub oid: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub author_time: i64,
    pub committer_name: String,
    pub committer_email: String,
    pub committer_time: i64,
    pub message: String,
    pub files: Vec<CommitFile>,
}

pub fn commit_details(git: &GitExecutor, root: &Path, oid: &str) -> GitResult<CommitDetails> {
    validate_revision(oid)?;
    let header: String = git.run_text(
        root,
        [
            "log",
            "-1",
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B",
            "--end-of-options",
            oid,
            "--",
        ],
    )?;
    let fields: Vec<&str> = header.splitn(9, FIELD).collect();
    if fields.len() != 9 {
        return Err(GitError::Parse {
            command: "log".to_owned(),
            detail: format!("incomplete commit header for {oid}"),
        });
    }
    let parents: Vec<String> = fields[1].split_whitespace().map(str::to_owned).collect();
    let resolved: String = fields[0].to_owned();

    let status_raw: Vec<u8> = tree_diff(git, root, &resolved, parents.first(), "--name-status")?;
    let numstat_raw: Vec<u8> = tree_diff(git, root, &resolved, parents.first(), "--numstat")?;
    let numstat = parse_numstat(&numstat_raw)?;
    let mut files: Vec<CommitFile> = parse_name_status(&status_raw)?;
    for file in &mut files {
        if let Some(totals) = numstat.files.iter().find(|totals| totals.path == file.path) {
            file.additions = totals.added;
            file.deletions = totals.deleted;
        }
    }

    Ok(CommitDetails {
        oid: resolved,
        parents,
        author_name: fields[2].to_owned(),
        author_email: fields[3].to_owned(),
        author_time: fields[4].parse().unwrap_or(0),
        committer_name: fields[5].to_owned(),
        committer_email: fields[6].to_owned(),
        committer_time: fields[7].parse().unwrap_or(0),
        message: fields[8].trim_end().to_owned(),
        files,
    })
}

/// Raw `-z` output comparing `oid` with its first parent (or the empty tree).
fn tree_diff(
    git: &GitExecutor,
    root: &Path,
    oid: &str,
    first_parent: Option<&String>,
    mode: &str,
) -> GitResult<Vec<u8>> {
    let output: std::process::Output = match first_parent {
        Some(parent) => git.run(
            root,
            [
                "diff",
                "-z",
                "--find-renames",
                "--no-ext-diff",
                mode,
                parent,
                oid,
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
                oid,
                "--",
            ],
            None,
        )?,
    };
    Ok(output.stdout)
}

pub(crate) fn parse_name_status(raw: &[u8]) -> GitResult<Vec<CommitFile>> {
    let mut fields = raw
        .split(|byte: &u8| *byte == 0)
        .map(|field: &[u8]| String::from_utf8_lossy(field).into_owned());
    let mut files: Vec<CommitFile> = Vec::new();
    while let Some(status) = fields.next() {
        if status.is_empty() {
            continue;
        }
        let missing = || GitError::Parse {
            command: "diff --name-status".to_owned(),
            detail: format!("missing path after status {status}"),
        };
        let kind: ChangeKind = match status.chars().next() {
            Some('A') => ChangeKind::Added,
            Some('D') => ChangeKind::Deleted,
            Some('R') => ChangeKind::Renamed,
            Some('C') => ChangeKind::Copied,
            Some('T') => ChangeKind::TypeChanged,
            _ => ChangeKind::Modified,
        };
        let (path, original_path) = if matches!(kind, ChangeKind::Renamed | ChangeKind::Copied) {
            let original: String = fields.next().ok_or_else(missing)?;
            (fields.next().ok_or_else(missing)?, Some(original))
        } else {
            (fields.next().ok_or_else(missing)?, None)
        };
        files.push(CommitFile {
            path,
            original_path,
            kind,
            additions: None,
            deletions: None,
        });
    }
    Ok(files)
}

/// Diff of one file between two trees (`from = None` means the empty tree).
pub(crate) fn tree_file_diff(
    git: &GitExecutor,
    root: &Path,
    from: Option<&str>,
    to: &str,
    path: &str,
    original_path: Option<&str>,
    context_lines: u32,
) -> GitResult<FileDiff> {
    validate_relative_path(path)?;
    if let Some(original) = original_path {
        validate_relative_path(original)?;
    }
    let unified: String = unified_arg(context_lines)?;
    let mut args: Vec<&str> = vec!["--literal-pathspecs"];
    match from {
        Some(from) => args.extend([
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--find-renames",
            unified.as_str(),
            from,
            to,
        ]),
        None => args.extend([
            "diff-tree",
            "-p",
            "-r",
            "--root",
            "--no-commit-id",
            "--no-color",
            "--no-ext-diff",
            "--find-renames",
            unified.as_str(),
            to,
        ]),
    }
    args.push("--");
    args.push(path);
    if let Some(original) = original_path {
        args.push(original);
    }
    let output: std::process::Output = git.run(root, args, None)?;
    let mut diff: FileDiff = parse_file_diff(&output.stdout, DiffSide::Commit)?;
    diff.path = path.to_owned();
    if diff.original_path.is_none() {
        diff.original_path = original_path.map(str::to_owned);
    }
    Ok(diff)
}

/// Diff of one file in a commit against its first parent (or the empty tree).
pub fn commit_file_diff(
    git: &GitExecutor,
    root: &Path,
    oid: &str,
    path: &str,
    original_path: Option<&str>,
    context_lines: u32,
) -> GitResult<FileDiff> {
    validate_revision(oid)?;
    let parents: String = git.run_text(
        root,
        ["log", "-1", "--format=%P", "--end-of-options", oid, "--"],
    )?;
    let first_parent: Option<&str> = parents.split_whitespace().next();
    tree_file_diff(
        git,
        root,
        first_parent,
        oid,
        path,
        original_path,
        context_lines,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_log_records() {
        let raw: Vec<u8> = [
            "aaa\u{1f}ppp qqq\u{1f}Ann\u{1f}ann@x\u{1f}10\u{1f}20\u{1f}Merge it",
            "\nbbb\u{1f}\u{1f}Bob\u{1f}bob@x\u{1f}5\u{1f}6\u{1f}Root: with \u{1f} in subject",
        ]
        .join("\0")
        .into_bytes();
        let commits: Vec<LogCommit> = parse_log(&raw).expect("parse");
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].parents, ["ppp", "qqq"]);
        assert_eq!(commits[0].committer_time, 20);
        assert!(commits[1].parents.is_empty());
        assert_eq!(commits[1].summary, "Root: with \u{1f} in subject");
    }

    #[test]
    fn parses_name_status_with_renames() {
        let raw: &[u8] = b"M\0src/a.rs\0R087\0old.rs\0new.rs\0A\0n.txt\0";
        let files: Vec<CommitFile> = parse_name_status(raw).expect("parse");
        assert_eq!(files.len(), 3);
        assert_eq!(files[1].kind, ChangeKind::Renamed);
        assert_eq!(files[1].original_path.as_deref(), Some("old.rs"));
        assert_eq!(files[1].path, "new.rs");
    }

    #[test]
    fn rejects_option_like_revisions() {
        assert!(validate_revision("--output=/tmp/x").is_err());
        assert!(validate_revision("").is_err());
        assert!(validate_revision("main~2").is_ok());
    }
}
