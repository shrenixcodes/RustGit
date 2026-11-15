//! Per-file diffs (`git diff`) parsed into hunks and lines.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{GitError, GitResult};
use crate::executor::GitExecutor;
use crate::pathspec::validate_relative_path;

/// Diffs larger than this are reported as `too_large` without hunks.
pub const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_DIFF_LINES: usize = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffSide {
    /// Index compared with HEAD.
    Staged,
    /// Working tree compared with the index.
    Unstaged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffFileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffLineKind {
    Context,
    Add,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
    pub content: String,
    pub no_newline_at_end: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub original_path: Option<String>,
    pub side: DiffSide,
    pub status: DiffFileStatus,
    pub binary: bool,
    pub too_large: bool,
    pub hunks: Vec<DiffHunk>,
    pub added: u32,
    pub deleted: u32,
    /// Raw file header (`diff --git` … `+++`), used to rebuild patches.
    #[serde(skip)]
    pub(crate) file_header: String,
}

/// Request for a single file's diff.
#[derive(Debug, Clone)]
pub struct DiffRequest<'a> {
    pub path: &'a str,
    pub original_path: Option<&'a str>,
    pub side: DiffSide,
    pub ignore_whitespace: bool,
}

pub fn file_diff(git: &GitExecutor, root: &Path, request: &DiffRequest<'_>) -> GitResult<FileDiff> {
    validate_relative_path(request.path)?;
    if let Some(original) = request.original_path {
        validate_relative_path(original)?;
    }

    let untracked: bool =
        request.side == DiffSide::Unstaged && !is_tracked(git, root, request.path)?;
    let stdout: Vec<u8> = if untracked {
        // Compare against an empty file so every line is an addition.
        // `--no-index` exits with 1 when the files differ.
        let output: std::process::Output = git.run_unchecked(
            root,
            [
                "diff",
                "--no-index",
                "--no-color",
                "--no-ext-diff",
                "--",
                "/dev/null",
                request.path,
            ],
            None,
        )?;
        if output.status.code() != Some(0) && output.status.code() != Some(1) {
            return Err(GitError::CommandFailed {
                command: "diff --no-index".to_owned(),
                exit_code: output.status.code(),
                stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            });
        }
        output.stdout
    } else {
        let mut args: Vec<&str> = vec![
            "--literal-pathspecs",
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--find-renames",
            "--unified=3",
        ];
        if request.side == DiffSide::Staged {
            args.push("--cached");
        }
        if request.ignore_whitespace {
            args.push("--ignore-all-space");
        }
        args.push("--");
        args.push(request.path);
        if let Some(original) = request.original_path {
            args.push(original);
        }
        git.run(root, args, None)?.stdout
    };

    let mut diff: FileDiff = parse_file_diff(&stdout, request.side)?;
    diff.path = request.path.to_owned();
    if diff.original_path.is_none() {
        diff.original_path = request.original_path.map(str::to_owned);
    }
    if untracked {
        diff.status = DiffFileStatus::Untracked;
    }
    Ok(diff)
}

fn is_tracked(git: &GitExecutor, root: &Path, path: &str) -> GitResult<bool> {
    let output: std::process::Output = git.run(
        root,
        ["--literal-pathspecs", "ls-files", "-z", "--", path],
        None,
    )?;
    Ok(!output.stdout.is_empty())
}

/// Parses the output of `git diff` for a single file.
pub fn parse_file_diff(raw: &[u8], side: DiffSide) -> GitResult<FileDiff> {
    let text: String = String::from_utf8_lossy(raw).into_owned();
    let mut diff: FileDiff = FileDiff {
        path: String::new(),
        original_path: None,
        side,
        status: DiffFileStatus::Modified,
        binary: false,
        too_large: false,
        hunks: Vec::new(),
        added: 0,
        deleted: 0,
        file_header: String::new(),
    };

    let header_end: usize = text
        .find("\n@@ ")
        .map_or(text.len(), |index: usize| index + 1);
    let (header, body) = text.split_at(header_end);
    diff.file_header = header.to_owned();
    for line in header.lines() {
        if line.starts_with("new file mode") {
            diff.status = DiffFileStatus::Added;
        } else if line.starts_with("deleted file mode") {
            diff.status = DiffFileStatus::Deleted;
        } else if let Some(from) = line.strip_prefix("rename from ") {
            diff.status = DiffFileStatus::Renamed;
            diff.original_path = Some(from.to_owned());
        } else if line.starts_with("Binary files ") || line == "GIT binary patch" {
            diff.binary = true;
        }
    }
    if diff.binary {
        return Ok(diff);
    }
    if raw.len() > MAX_DIFF_BYTES || body.lines().count() > MAX_DIFF_LINES {
        diff.too_large = true;
        return Ok(diff);
    }

    let mut old_line: u32 = 0;
    let mut new_line: u32 = 0;
    for line in body.split_inclusive('\n') {
        let line: &str = line.strip_suffix('\n').unwrap_or(line);
        if line.starts_with("@@ ") {
            let hunk: DiffHunk = parse_hunk_header(line)?;
            old_line = hunk.old_start;
            new_line = hunk.new_start;
            diff.hunks.push(hunk);
            continue;
        }
        let Some(hunk) = diff.hunks.last_mut() else {
            continue;
        };
        let (marker, content) = line.split_at(line.chars().next().map_or(0, char::len_utf8));
        let parsed: DiffLine = match marker {
            " " => {
                let parsed = DiffLine {
                    kind: DiffLineKind::Context,
                    old_line: Some(old_line),
                    new_line: Some(new_line),
                    content: content.to_owned(),
                    no_newline_at_end: false,
                };
                old_line += 1;
                new_line += 1;
                parsed
            }
            "+" => {
                diff.added += 1;
                let parsed = DiffLine {
                    kind: DiffLineKind::Add,
                    old_line: None,
                    new_line: Some(new_line),
                    content: content.to_owned(),
                    no_newline_at_end: false,
                };
                new_line += 1;
                parsed
            }
            "-" => {
                diff.deleted += 1;
                let parsed = DiffLine {
                    kind: DiffLineKind::Delete,
                    old_line: Some(old_line),
                    new_line: None,
                    content: content.to_owned(),
                    no_newline_at_end: false,
                };
                old_line += 1;
                parsed
            }
            "\\" => {
                if let Some(previous) = hunk.lines.last_mut() {
                    previous.no_newline_at_end = true;
                }
                continue;
            }
            _ => {
                return Err(GitError::Parse {
                    command: "diff".to_owned(),
                    detail: format!("unexpected line in hunk: {line}"),
                });
            }
        };
        hunk.lines.push(parsed);
    }
    Ok(diff)
}

/// Parses `@@ -a[,b] +c[,d] @@ section`.
pub(crate) fn parse_hunk_header(line: &str) -> GitResult<DiffHunk> {
    let error = || GitError::Parse {
        command: "diff".to_owned(),
        detail: format!("invalid hunk header: {line}"),
    };
    let ranges: &str = line
        .strip_prefix("@@ ")
        .and_then(|rest: &str| rest.split(" @@").next())
        .ok_or_else(error)?;
    let mut parts = ranges.split(' ');
    let old: &str = parts
        .next()
        .and_then(|p: &str| p.strip_prefix('-'))
        .ok_or_else(error)?;
    let new: &str = parts
        .next()
        .and_then(|p: &str| p.strip_prefix('+'))
        .ok_or_else(error)?;
    let range = |value: &str| -> Option<(u32, u32)> {
        match value.split_once(',') {
            Some((start, count)) => Some((start.parse().ok()?, count.parse().ok()?)),
            None => Some((value.parse().ok()?, 1)),
        }
    };
    let (old_start, old_lines) = range(old).ok_or_else(error)?;
    let (new_start, new_lines) = range(new).ok_or_else(error)?;
    Ok(DiffHunk {
        header: line.to_owned(),
        old_start,
        old_lines,
        new_start,
        new_lines,
        lines: Vec::new(),
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTotals {
    pub path: String,
    /// `None` for binary files.
    pub added: Option<u32>,
    pub deleted: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeTotals {
    pub files: Vec<FileTotals>,
    pub added: u32,
    pub deleted: u32,
}

/// Line totals per file from `git diff --numstat -z` (untracked files excluded).
pub fn change_totals(git: &GitExecutor, root: &Path, side: DiffSide) -> GitResult<ChangeTotals> {
    let mut args: Vec<&str> = vec!["diff", "--numstat", "-z", "--no-color", "--find-renames"];
    if side == DiffSide::Staged {
        args.push("--cached");
    }
    let output: std::process::Output = git.run(root, args, None)?;
    parse_numstat(&output.stdout)
}

pub fn parse_numstat(raw: &[u8]) -> GitResult<ChangeTotals> {
    let mut totals: ChangeTotals = ChangeTotals::default();
    let mut records = raw
        .split(|byte: &u8| *byte == 0)
        .map(|record: &[u8]| String::from_utf8_lossy(record).into_owned());
    while let Some(record) = records.next() {
        if record.is_empty() {
            continue;
        }
        let mut fields = record.splitn(3, '\t');
        let added: Option<u32> = fields.next().and_then(|value: &str| value.parse().ok());
        let deleted: Option<u32> = fields.next().and_then(|value: &str| value.parse().ok());
        let path: String = match fields.next() {
            Some(path) if !path.is_empty() => path.to_owned(),
            // Rename: the path field is empty, followed by old and new paths.
            _ => {
                let _old: Option<String> = records.next();
                records.next().ok_or_else(|| GitError::Parse {
                    command: "diff --numstat".to_owned(),
                    detail: format!("incomplete rename record: {record}"),
                })?
            }
        };
        totals.added += added.unwrap_or(0);
        totals.deleted += deleted.unwrap_or(0);
        totals.files.push(FileTotals {
            path,
            added,
            deleted,
        });
    }
    Ok(totals)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "diff --git a/f.txt b/f.txt\nindex 1..2 100644\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@ fn main\n a\n-b\n+B\n c\n@@ -10 +10,2 @@\n x\n+y\n\\ No newline at end of file\n";

    #[test]
    fn parses_hunks_lines_and_numbers() {
        let diff: FileDiff = parse_file_diff(SAMPLE.as_bytes(), DiffSide::Unstaged).expect("parse");
        assert_eq!(diff.status, DiffFileStatus::Modified);
        assert_eq!(diff.hunks.len(), 2);
        assert_eq!((diff.added, diff.deleted), (2, 1));

        let first: &DiffHunk = &diff.hunks[0];
        assert_eq!(first.header, "@@ -1,3 +1,3 @@ fn main");
        assert_eq!(first.lines[1].kind, DiffLineKind::Delete);
        assert_eq!(first.lines[1].old_line, Some(2));
        assert_eq!(first.lines[2].kind, DiffLineKind::Add);
        assert_eq!(first.lines[2].new_line, Some(2));
        assert_eq!(first.lines[3].old_line, Some(3));

        let second: &DiffHunk = &diff.hunks[1];
        assert_eq!((second.old_start, second.old_lines), (10, 1));
        assert!(second.lines[1].no_newline_at_end);
        assert!(diff.file_header.ends_with("+++ b/f.txt\n"));
    }

    #[test]
    fn detects_binary_new_deleted_and_renamed() {
        let binary = parse_file_diff(
            b"diff --git a/i.png b/i.png\nindex 1..2 100644\nBinary files a/i.png and b/i.png differ\n",
            DiffSide::Staged,
        )
        .expect("parse");
        assert!(binary.binary);
        assert!(binary.hunks.is_empty());

        let added = parse_file_diff(
            b"diff --git a/n b/n\nnew file mode 100644\nindex 0..1\n--- /dev/null\n+++ b/n\n@@ -0,0 +1 @@\n+x\n",
            DiffSide::Staged,
        )
        .expect("parse");
        assert_eq!(added.status, DiffFileStatus::Added);
        assert_eq!(added.hunks[0].lines[0].new_line, Some(1));

        let renamed = parse_file_diff(
            b"diff --git a/o b/n\nsimilarity index 100%\nrename from o\nrename to n\n",
            DiffSide::Staged,
        )
        .expect("parse");
        assert_eq!(renamed.status, DiffFileStatus::Renamed);
        assert_eq!(renamed.original_path.as_deref(), Some("o"));
    }

    #[test]
    fn marks_oversized_diffs() {
        let mut raw: String =
            String::from("diff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1,0 +1,20001 @@\n");
        for _ in 0..=MAX_DIFF_LINES {
            raw.push_str("+x\n");
        }
        let diff: FileDiff = parse_file_diff(raw.as_bytes(), DiffSide::Unstaged).expect("parse");
        assert!(diff.too_large);
        assert!(diff.hunks.is_empty());
    }

    #[test]
    fn parses_numstat_including_renames_and_binary() {
        let raw: &[u8] = b"3\t1\tsrc/a.rs\0-\t-\timg.png\0\x30\t0\t\0old.rs\0new.rs\0";
        let totals: ChangeTotals = parse_numstat(raw).expect("parse");
        assert_eq!(totals.files.len(), 3);
        assert_eq!(totals.files[1].added, None);
        assert_eq!(totals.files[2].path, "new.rs");
        assert_eq!((totals.added, totals.deleted), (3, 1));
    }

    #[test]
    fn rejects_malformed_hunk_header() {
        assert!(parse_hunk_header("@@ nonsense @@").is_err());
    }
}
