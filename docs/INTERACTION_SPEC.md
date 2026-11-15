# RustGit interaction specification

Status markers: **[live]** implemented against the real backend and tested;
**[planned]** frontend work not built yet; **[blocked R-n]** needs backend
request R-n in `integration/INTEGRATION_STATUS.md`. Blocked features are
shown as unavailable in the UI, never simulated. This file is updated as
features land.

**Backend update (merged from `main`, 2026-11-15):** requests R-1 … R-7 are
implemented by contract C-1 with C-2 amendments (`file_diff`, `apply_hunk`,
`stage_paths`, `unstage_paths`, `stage_all`, `unstage_all`, `discard_paths`,
`change_totals`, `commit_context`, `create_commit`, `command_history`). Items
below marked blocked on those requests are now frontend work, not yet built.
R-8 … R-14 are defined in C-2 but not implemented. See
`integration/API_CONTRACT.md` for the authoritative shapes, which differ in
places from the original requests (for example, hunks are identified by
their header string, one hunk per `apply_hunk` call).

## Global

| Shortcut               | Action                                   | Status    |
| ---------------------- | ---------------------------------------- | --------- |
| `Ctrl/Cmd+1`…`3`       | Overview, Changes, History               | [live]    |
| `Ctrl/Cmd+,`           | Settings                                 | [live]    |
| `Ctrl/Cmd+B`           | Toggle navigation rail                   | [live]    |
| `Ctrl/Cmd+I`           | Toggle inspector                         | [live]    |
| `Ctrl/Cmd+J`           | Toggle activity panel                    | [live]    |
| `Ctrl/Cmd+R` / `F5`    | Refresh repository data                  | [live]    |
| `Ctrl/Cmd+K`           | Command palette                          | [planned] |
| `Ctrl/Cmd+P`           | Quick repository switcher                | [live]    |
| `?`                    | Shortcut reference                       | [planned] |

Shortcuts never fire while focus is in a text field, except
`Ctrl/Cmd+Enter` in the commit composer and `Escape`.

## Changes workspace

### File list

- Groups, in this order: Conflicted, Staged, Unstaged, Untracked. Each group
  header shows its count and collapses on click. **[planned]** Group actions
  (Stage all / Unstage all) **[blocked R-3]**.
- Each row: status letter (M, A, D, R, T, C, U, !) with a text label for
  assistive technology, file name, directory in muted text, and a
  "partial" marker when the file has both staged and unstaged changes.
  **[planned]** Row stage/unstage action **[blocked R-3]**.
- Selection: click, or `↑`/`↓`/`Home`/`End` within the list. **[planned]**
  `Space` stages/unstages the selected file **[blocked R-3]**.
- Filter box: case-insensitive substring match on path. **[planned]**
- Context menu (Copy path, Open in editor, Discard). Copy path
  **[planned]**; Open in editor needs an opener command (not yet requested);
  Discard **[blocked R-5]**.

### Diff

- Selecting a file loads its diff. A partially staged file shows two sections
  headed "Staged" and "Not staged". **[blocked R-2]**
- Hunk header row shows the `@@` range and the actions "Stage hunk" /
  "Unstage hunk" / "Discard hunk" (unstaged side only). **[blocked R-4]**
- Line selection: click a `+`/`-` line to toggle selection, `Shift+click` to
  extend; with lines selected the hunk actions become "Stage N lines" /
  "Unstage N lines" / "Discard N lines". Context lines are not selectable.
  **[blocked R-4]**
- Keyboard in the diff: `n`/`p` next/previous hunk, `s` stage focused hunk or
  selection, `u` unstage, `Esc` clear selection. **[blocked R-2, R-4]**
- Toggles: unified / split, ignore whitespace. **[blocked R-2]**
- Untracked files show their full content as additions. **[blocked R-2]**
- Binary and oversized files: an explanation row instead of lines.
  **[blocked R-2]**
- Syntax highlighting, word-level diff, expand context, search in diff.
  **[planned]** after R-2.

### Discard

Discarding always opens a confirmation dialog naming the file (and line
count for hunks or selections). Untracked files are deleted from disk after
confirmation. Default focus: Cancel. **[blocked R-4, R-5]**

### Commit composer

- Summary field (single line) and description (multi-line). Guidance: the
  summary counter turns amber after 72 characters; there is no hard limit.
- Shows "N files staged · +a −d". When nothing is staged, the button is
  disabled and the text explains "Stage changes to commit them".
- Amend checkbox: loads the previous commit message into the fields; with
  amend, committing with an empty index is allowed (message-only amend);
  warns when HEAD is already on the upstream.
- `Ctrl/Cmd+Enter` commits.
- Hook failures: the commit fails, the message is kept, and the hook's
  output is shown verbatim with the exit code.
- Author line from the effective Git identity; a missing identity disables
  commit and explains how to set it.

All composer items: **[blocked R-6, R-7]**. Conventional Commit helper and
templates **[planned]** after R-7.

## History workspace

All items in this section are **[live]** on `log_page`, `list_refs` and
`commit_details`, verified in the native app (see `UI_PROGRESS.md` U-9),
except where marked.

- `Ctrl/Cmd+3` opens History. History loads in pages of 300 as the list
  scrolls; it never loads the whole log. Only visible rows are mounted.
- Graph column aligned with log rows on a faint grid; lanes assigned by a
  single sweep over topologically ordered commits, incrementally per page.
  HEAD's first-parent line is cyan (lane color 0); other lanes cycle
  lavender, amber, green, blue, yellow.
- Node shapes: hollow circle = commit, ring with centre dot = merge, filled
  cyan with halo = HEAD. Ref labels: filled cyan = current branch, solid
  outline = local branch, outlined with a cloud = remote branch, amber with
  a tag icon = tag, amber "HEAD" = detached HEAD. Each label's accessible
  text names its kind.
- Columns: message (with labels), author (email in tooltip), relative date
  (absolute in tooltip), short commit id.
- Selection opens the commit inspector: full SHA with Copy, labels, full
  message, author and committer (committer only when different), parents as
  buttons, changed files with +/− (merges compared with the first parent).
- Keyboard in the list: `↑`/`↓`, `PageUp`/`PageDown`, `Home`/`End`, `←` first
  parent (pages in more history if needed, up to 20 000 commits), `→`
  nearest loaded child, `C` copies the full SHA.
- Filters (toolbar): refs (all, HEAD, any local or remote branch), search by
  message / author / commit id prefix (debounced 300 ms, runs in the backend),
  from/to dates. Search results are a flat list without the graph, because
  matches are not connected history; "Show in graph" in the inspector clears
  the search and reveals the commit in the graph.
- Focus: ancestors or descendants of the selected commit (within loaded
  history); other rows are dimmed.
- Live: commits, branch and tag changes made outside RustGit appear without
  refresh (`repository-changed`).
- Compare commits / compare branches, file diffs of a commit, context menu,
  minimap: **[planned]** (diffs reuse the diff viewer being built for
  Changes; comparing needs request R-16).

## Operation shelf and activity panel

- Shelf (always visible): repository name, branch (or "detached HEAD"),
  upstream ahead/behind, number of operations running, failures since the
  panel was last opened, activity toggle. **[planned]**
- Activity panel: newest-first list of operations the UI invoked, with name,
  repository, start time, duration, outcome and error message. **[planned]**
  Git commands with arguments, cwd, exit code and stderr
  **[blocked R-1]**.

## Inspector (file selection)

Path, original path for renames, index state, working-tree state, conflict
state, copy path. **[planned]** Line totals **[blocked R-2]**; actions
**[blocked R-3, R-5]**. Commit, branch and operation inspectors
**[blocked R-10, R-9]** / **[planned]**.

## Resizing

Splitters are focusable `role="separator"` elements with
`aria-valuenow`/`min`/`max`; arrow keys move them by 16 px, `Home`/`End` jump
to the limits, double-click resets. Sizes persist across restarts.
**[planned]**
