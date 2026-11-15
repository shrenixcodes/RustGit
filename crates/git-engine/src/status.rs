use std::path::Path;

use serde::Serialize;

use crate::error::{GitError, GitResult};
use crate::executor::GitExecutor;

/// The kind of change recorded for one side (index or working tree) of a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Modified,
    TypeChanged,
    Added,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Unmerged,
}

/// A path with changes. `staged`/`unstaged` are `None` when that side is clean.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: String,
    pub original_path: Option<String>,
    pub staged: Option<ChangeKind>,
    pub unstaged: Option<ChangeKind>,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchStatus {
    /// Branch name, or `None` on a detached HEAD.
    pub head: Option<String>,
    /// HEAD commit id, or `None` before the first commit.
    pub oid: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusSnapshot {
    pub branch: BranchStatus,
    pub files: Vec<FileStatus>,
}

/// Reads the working tree status with `git status --porcelain=v2 -z`.
pub fn read_status(git: &GitExecutor, root: &Path) -> GitResult<StatusSnapshot> {
    let output: std::process::Output = git.run(
        root,
        [
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ],
        None,
    )?;
    parse_porcelain_v2(&output.stdout)
}

/// Parses NUL-separated porcelain v2 status output.
pub fn parse_porcelain_v2(raw: &[u8]) -> GitResult<StatusSnapshot> {
    let mut snapshot: StatusSnapshot = StatusSnapshot::default();
    let mut records = raw
        .split(|byte: &u8| *byte == 0)
        .filter(|record: &&[u8]| !record.is_empty())
        .map(String::from_utf8_lossy);

    while let Some(record) = records.next() {
        let record: &str = record.as_ref();
        if let Some(header) = record.strip_prefix("# ") {
            parse_branch_header(header, &mut snapshot.branch)?;
            continue;
        }

        let (kind, rest) = record.split_at(record.chars().next().map_or(0, char::len_utf8));
        let rest: &str = rest.trim_start();
        match kind {
            "1" => {
                let fields: Vec<&str> = rest.splitn(8, ' ').collect();
                let xy: &str = field(&fields, 0, record)?;
                let path: &str = field(&fields, 7, record)?;
                snapshot.files.push(changed_entry(xy, path, None));
            }
            "2" => {
                let fields: Vec<&str> = rest.splitn(9, ' ').collect();
                let xy: &str = field(&fields, 0, record)?;
                let path: &str = field(&fields, 8, record)?;
                let original = records.next().ok_or_else(|| parse_error(record))?;
                snapshot
                    .files
                    .push(changed_entry(xy, path, Some(original.into_owned())));
            }
            "u" => {
                let fields: Vec<&str> = rest.splitn(10, ' ').collect();
                let path: &str = field(&fields, 9, record)?;
                snapshot.files.push(FileStatus {
                    path: path.to_owned(),
                    original_path: None,
                    staged: None,
                    unstaged: Some(ChangeKind::Unmerged),
                    conflicted: true,
                });
            }
            "?" => snapshot.files.push(FileStatus {
                path: rest.to_owned(),
                original_path: None,
                staged: None,
                unstaged: Some(ChangeKind::Untracked),
                conflicted: false,
            }),
            // Ignored files are not requested; skip defensively.
            "!" => {}
            _ => return Err(parse_error(record)),
        }
    }

    Ok(snapshot)
}

fn parse_branch_header(header: &str, branch: &mut BranchStatus) -> GitResult<()> {
    let (key, value) = header.split_once(' ').unwrap_or((header, ""));
    match key {
        "branch.oid" => branch.oid = (value != "(initial)").then(|| value.to_owned()),
        "branch.head" => branch.head = (value != "(detached)").then(|| value.to_owned()),
        "branch.upstream" => branch.upstream = Some(value.to_owned()),
        "branch.ab" => {
            let mut parts = value.split(' ');
            let ahead: Option<u32> = parts
                .next()
                .and_then(|part: &str| part.strip_prefix('+'))
                .and_then(|n: &str| n.parse().ok());
            let behind: Option<u32> = parts
                .next()
                .and_then(|part: &str| part.strip_prefix('-'))
                .and_then(|n: &str| n.parse().ok());
            match (ahead, behind) {
                (Some(ahead), Some(behind)) => {
                    branch.ahead = ahead;
                    branch.behind = behind;
                }
                _ => return Err(parse_error(header)),
            }
        }
        // Other headers (e.g. stash count) are informational.
        _ => {}
    }
    Ok(())
}

fn changed_entry(xy: &str, path: &str, original_path: Option<String>) -> FileStatus {
    let mut chars = xy.chars();
    let staged: Option<ChangeKind> = chars.next().and_then(change_kind);
    let unstaged: Option<ChangeKind> = chars.next().and_then(change_kind);
    FileStatus {
        path: path.to_owned(),
        original_path,
        staged,
        unstaged,
        conflicted: false,
    }
}

fn change_kind(code: char) -> Option<ChangeKind> {
    match code {
        'M' => Some(ChangeKind::Modified),
        'T' => Some(ChangeKind::TypeChanged),
        'A' => Some(ChangeKind::Added),
        'D' => Some(ChangeKind::Deleted),
        'R' => Some(ChangeKind::Renamed),
        'C' => Some(ChangeKind::Copied),
        'U' => Some(ChangeKind::Unmerged),
        _ => None,
    }
}

fn field<'a>(fields: &[&'a str], index: usize, record: &str) -> GitResult<&'a str> {
    fields
        .get(index)
        .copied()
        .ok_or_else(|| parse_error(record))
}

fn parse_error(record: &str) -> GitError {
    GitError::Parse {
        command: "status".to_owned(),
        detail: format!("unrecognized record: {record}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_headers_and_entries() {
        let raw: Vec<u8> = [
            "# branch.oid 1234abcd",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -1",
            "1 .M N... 100644 100644 100644 aaa aaa src/lib.rs",
            "1 A. N... 000000 100644 100644 000 bbb new file.txt",
            "2 R. N... 100644 100644 100644 ccc ccc R100 renamed.rs",
            "old.rs",
            "u UU N... 100644 100644 100644 100644 d1 d2 d3 conflict.txt",
            "? untracked/été.md",
        ]
        .join("\0")
        .into_bytes();
        let snapshot: StatusSnapshot = parse_porcelain_v2(&raw).expect("parses");

        assert_eq!(snapshot.branch.head.as_deref(), Some("main"));
        assert_eq!(snapshot.branch.oid.as_deref(), Some("1234abcd"));
        assert_eq!(snapshot.branch.upstream.as_deref(), Some("origin/main"));
        assert_eq!((snapshot.branch.ahead, snapshot.branch.behind), (2, 1));
        assert_eq!(snapshot.files.len(), 5);

        assert_eq!(snapshot.files[0].unstaged, Some(ChangeKind::Modified));
        assert_eq!(snapshot.files[0].staged, None);
        assert_eq!(snapshot.files[1].path, "new file.txt");
        assert_eq!(snapshot.files[1].staged, Some(ChangeKind::Added));
        assert_eq!(snapshot.files[2].original_path.as_deref(), Some("old.rs"));
        assert_eq!(snapshot.files[2].staged, Some(ChangeKind::Renamed));
        assert!(snapshot.files[3].conflicted);
        assert_eq!(snapshot.files[4].path, "untracked/été.md");
    }

    #[test]
    fn handles_initial_and_detached_states() {
        let initial: StatusSnapshot =
            parse_porcelain_v2(b"# branch.oid (initial)\0# branch.head main\0").expect("parses");
        assert_eq!(initial.branch.oid, None);
        assert_eq!(initial.branch.head.as_deref(), Some("main"));

        let detached: StatusSnapshot =
            parse_porcelain_v2(b"# branch.oid abc\0# branch.head (detached)\0").expect("parses");
        assert_eq!(detached.branch.head, None);
    }

    #[test]
    fn rejects_unknown_record_types() {
        assert!(parse_porcelain_v2(b"x what\0").is_err());
    }
}
