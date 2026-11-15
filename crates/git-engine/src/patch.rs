//! Partial staging, unstaging and discarding by rebuilding a patch from the
//! current diff and applying it with `git apply`.

use std::path::Path;

use serde::Deserialize;

use crate::diff::{
    DiffFileStatus, DiffHunk, DiffLine, DiffLineKind, DiffRequest, DiffSide, FileDiff, file_diff,
};
use crate::error::{GitError, GitResult};
use crate::executor::GitExecutor;
use crate::index::{discard_paths, stage_paths};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HunkAction {
    Stage,
    Unstage,
    Discard,
}

#[derive(Debug, Clone)]
pub struct HunkRequest<'a> {
    pub path: &'a str,
    pub side: DiffSide,
    pub action: HunkAction,
    /// Exact `DiffHunk::header` the UI displayed.
    pub hunk_header: &'a str,
    /// Indices into `DiffHunk::lines` of add/delete lines; `None` = whole hunk.
    pub line_indices: Option<&'a [usize]>,
}

/// Applies one hunk (or a selection of its lines) to the index or worktree.
pub fn apply_hunk(git: &GitExecutor, root: &Path, request: &HunkRequest<'_>) -> GitResult<()> {
    let expected_side: DiffSide = match request.action {
        HunkAction::Stage | HunkAction::Discard => DiffSide::Unstaged,
        HunkAction::Unstage => DiffSide::Staged,
    };
    if request.side != expected_side {
        return Err(GitError::InvalidRequest(format!(
            "{:?} requires the {:?} diff",
            request.action, expected_side
        )));
    }

    let diff: FileDiff = file_diff(
        git,
        root,
        &DiffRequest {
            path: request.path,
            original_path: None,
            side: request.side,
            ignore_whitespace: false,
        },
    )?;
    if diff.binary || diff.too_large {
        return Err(GitError::InvalidRequest(
            "binary or oversized files can only be staged as whole files".to_owned(),
        ));
    }
    let hunk: &DiffHunk = diff
        .hunks
        .iter()
        .find(|hunk: &&DiffHunk| hunk.header == request.hunk_header)
        .ok_or_else(|| GitError::StaleDiff(format!("hunk '{}' not found", request.hunk_header)))?;

    if request.line_indices.is_some() && diff.status != DiffFileStatus::Modified {
        return Err(GitError::InvalidRequest(
            "line selection is only supported for modified files".to_owned(),
        ));
    }

    // Git has no index entry to patch for an untracked file: whole-file only.
    if diff.status == DiffFileStatus::Untracked {
        let paths: [String; 1] = [request.path.to_owned()];
        return match request.action {
            HunkAction::Stage => stage_paths(git, root, &paths),
            HunkAction::Discard => discard_paths(git, root, &paths),
            HunkAction::Unstage => Err(GitError::InvalidRequest(
                "untracked files have nothing staged".to_owned(),
            )),
        };
    }

    let reverse: bool = request.action != HunkAction::Stage;
    let patch: String = build_patch(&diff.file_header, hunk, request.line_indices, reverse)?;
    let mut args: Vec<&str> = vec!["apply", "--whitespace=nowarn"];
    if request.action != HunkAction::Discard {
        args.push("--cached");
    }
    if reverse {
        args.push("--reverse");
    }
    args.push("-");
    git.run(root, args, Some(patch.as_bytes()))?;
    Ok(())
}

/// Builds a single-hunk patch. With a line selection, unselected changes are
/// neutralized: for forward application unselected additions are dropped and
/// unselected deletions become context; for reverse application (the target
/// already contains the new side) unselected additions become context and
/// unselected deletions are dropped.
pub(crate) fn build_patch(
    file_header: &str,
    hunk: &DiffHunk,
    line_indices: Option<&[usize]>,
    reverse: bool,
) -> GitResult<String> {
    let mut patch: String = String::with_capacity(file_header.len() + 64 * hunk.lines.len());
    patch.push_str(file_header);

    let Some(selected) = line_indices else {
        patch.push_str(&hunk.header);
        patch.push('\n');
        for line in &hunk.lines {
            push_line(&mut patch, line.kind, line);
        }
        return Ok(patch);
    };

    if selected.is_empty() {
        return Err(GitError::InvalidRequest("no lines selected".to_owned()));
    }
    for index in selected {
        match hunk.lines.get(*index).map(|line: &DiffLine| line.kind) {
            Some(DiffLineKind::Add | DiffLineKind::Delete) => {}
            Some(DiffLineKind::Context) => {
                return Err(GitError::InvalidRequest(format!(
                    "line {index} is a context line"
                )));
            }
            None => {
                return Err(GitError::InvalidRequest(format!(
                    "line {index} is outside the hunk"
                )));
            }
        }
    }

    let mut body: Vec<(DiffLineKind, &DiffLine)> = Vec::with_capacity(hunk.lines.len());
    for (index, line) in hunk.lines.iter().enumerate() {
        let chosen: bool = selected.contains(&index);
        let kind: Option<DiffLineKind> = match (line.kind, chosen, reverse) {
            (DiffLineKind::Context, _, _) => Some(DiffLineKind::Context),
            (kind, true, _) => Some(kind),
            (DiffLineKind::Add, false, false) => None,
            (DiffLineKind::Delete, false, false) => Some(DiffLineKind::Context),
            (DiffLineKind::Add, false, true) => Some(DiffLineKind::Context),
            (DiffLineKind::Delete, false, true) => None,
        };
        if let Some(kind) = kind {
            body.push((kind, line));
        }
    }

    let old_count: usize = body
        .iter()
        .filter(|(kind, _)| *kind != DiffLineKind::Add)
        .count();
    let new_count: usize = body
        .iter()
        .filter(|(kind, _)| *kind != DiffLineKind::Delete)
        .count();
    // Only this hunk is applied, so both sides start at the line the target
    // currently has: the old side forward, the new side in reverse.
    let start: u32 = if reverse {
        hunk.new_start
    } else {
        hunk.old_start
    };
    patch.push_str(&format!(
        "@@ -{start},{old_count} +{start},{new_count} @@\n"
    ));
    for (kind, line) in body {
        push_line(&mut patch, kind, line);
    }
    Ok(patch)
}

fn push_line(patch: &mut String, kind: DiffLineKind, line: &DiffLine) {
    patch.push(match kind {
        DiffLineKind::Context => ' ',
        DiffLineKind::Add => '+',
        DiffLineKind::Delete => '-',
    });
    patch.push_str(&line.content);
    patch.push('\n');
    if line.no_newline_at_end {
        patch.push_str("\\ No newline at end of file\n");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diff::parse_file_diff;

    const DIFF: &str = "diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n@@ -1,4 +1,4 @@\n a\n-b\n-c\n+B\n+C\n d\n";

    fn hunk() -> (String, DiffHunk) {
        let diff: FileDiff = parse_file_diff(DIFF.as_bytes(), DiffSide::Unstaged).expect("parse");
        (diff.file_header.clone(), diff.hunks[0].clone())
    }

    #[test]
    fn whole_hunk_is_reproduced() {
        let (header, hunk) = hunk();
        assert_eq!(
            build_patch(&header, &hunk, None, false).expect("patch"),
            DIFF
        );
    }

    #[test]
    fn forward_selection_drops_unselected_additions_and_keeps_deletions() {
        let (header, hunk) = hunk();
        // Select "-b" (1) and "+B" (3).
        let patch: String = build_patch(&header, &hunk, Some(&[1, 3]), false).expect("patch");
        assert!(
            patch.ends_with("@@ -1,4 +1,4 @@\n a\n-b\n c\n+B\n d\n"),
            "{patch}"
        );
    }

    #[test]
    fn reverse_selection_keeps_unselected_additions_and_drops_deletions() {
        let (header, hunk) = hunk();
        // Revert only "+C" (4): "-c" unselected is dropped, "+B" becomes context.
        let patch: String = build_patch(&header, &hunk, Some(&[4]), true).expect("patch");
        assert!(
            patch.ends_with("@@ -1,3 +1,4 @@\n a\n B\n+C\n d\n"),
            "{patch}"
        );
    }

    #[test]
    fn rejects_invalid_selections() {
        let (header, hunk) = hunk();
        assert!(build_patch(&header, &hunk, Some(&[]), false).is_err());
        assert!(build_patch(&header, &hunk, Some(&[0]), false).is_err());
        assert!(build_patch(&header, &hunk, Some(&[99]), false).is_err());
    }
}
