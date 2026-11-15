# RustGit interaction specification: the thread

Describes the shipped behaviour on branch `worktree-ui-orbital`. The model
and its reasoning are in `SCREEN_MODEL.md`. Status markers: **[live]**
implemented against the real backend and verified (unit tests and native
QA); **[planned]** not built; **[blocked R-n]** needs backend request R-n.

## Places

There are no pages. Everything is on one canvas:

| Element | What it is |
| ------- | ---------- |
| Seal (top line) | Mark, repository name (opens the switcher), branch path `● main ─ 2↑ 1↓`, operation in progress; at the right: thread search, Thread/Map distance, Refresh, Settings, `Ctrl+K` |
| Loose end | First row of the thread: the working tree as the open node. Its row is the next commit's summary field, with counts and a Commit button |
| Thread | Commits, newest first, one row each, with lanes. HEAD is the solid clay point; a dashed line links it to the loose end |
| Fold | The one unfolded node, opened under its own row. Lanes continue through it |
| Map | The same canvas zoomed out: only branch heads, forks, merges and roots, each annotated with the commits it folds |
| Shelf | Bottom line: running or last operation, failures, activity toggle |
| Sheets | Settings and Repositories, laid over the canvas (modal) |

All **[live]**.

## Keyboard

| Keys | Where | Action | Status |
| ---- | ----- | ------ | ------ |
| `↑` `↓` `PageUp` `PageDown` `Home` `End` | thread | move along the thread | [live] |
| `Enter`, `→` | thread | unfold the focused node | [live] |
| `Esc`, `←` | thread, fold | fold | [live] |
| `c` | thread | write the next commit (focus the loose end's summary) | [live] |
| `Ctrl+Enter` | summary, description | commit (or amend) | [live] |
| `↑` `↓` | review stream | move between files | [live] |
| `Space` | review stream | stage the file's remaining changes, or unstage a fully staged file | [live] |
| `Enter` | review stream | show or hide the file's diff | [live] |
| `n` `p` | review stream | next / previous hunk | [live] |
| `s` `u` `d` | review stream | stage / unstage / discard the current hunk or its selected lines (discard confirms) | [live] |
| `Delete` | review stream | discard the file's unstaged changes (confirms; deletes an untracked file) | [live] |
| `Ctrl+-` / `Ctrl+0` | anywhere | map / thread | [live] |
| `/` | anywhere | search the thread | [live] |
| `Ctrl+K` | anywhere | command palette | [live] |
| `Ctrl+P` | anywhere | switch repository | [live] |
| `Ctrl+,` / `Ctrl+Shift+O` | anywhere | settings / repositories | [live] |
| `Ctrl+J` | anywhere | activity panel | [live] |
| `Ctrl+R`, `F5` | anywhere | refresh | [live] |
| `Ctrl+Shift+D` | anywhere | quiet / deep workspace | [live] |

Shortcuts never fire inside text fields, except those with `Ctrl` and
`Ctrl+Enter` in the commit fields.

## The loose end

- Summary row: counts in words (`1 staged · 2 unstaged · 1 untracked`,
  conflicts first). Commit button disabled with the reason in its tooltip
  (identity missing, nothing staged, no summary). **[live]**
- Unfolded: description, amend (prefilled from HEAD; warns when HEAD is on
  its upstream), identity and signing, merge-in-progress note, Git's own
  error output when a commit is refused (hook output included). **[live]**
- Review stream: groups conflicts / changes / untracked; each file once with
  index and tree marks, `partly staged` in words; up to four files start
  expanded; stage all / unstage all / expand all (40 files max) / ignore
  whitespace (disables staging) / unified or split. **[live]**
- Lines: click to select add/delete lines of a modified file; hunk actions
  become `Stage N lines`. A refreshed diff clears selections. **[live]**
- `stale_diff`: says nothing was applied and shows the refreshed diff. **[live]**
- Conflict resolution (base / ours / theirs / result): **[planned]**
  (backend `conflict_versions`, `resolve_conflict` exist).

## Commit fold

Full id with copy, references, message, author and committer, parents
(navigate along the thread, paging in older history up to 20 000 commits),
files with counts and inline read-only diffs (1 500 lines inline),
cherry-pick and revert onto the current branch (confirmed; conflicts
reported as an outcome). **[live]** Compare two commits: **[blocked R-16]**.

## Map fold

Per reference at the node: local branches show upstream relation and last
commit, with Switch (confirms when the tree is dirty), Merge into current,
Rebase current onto it (confirmed, warns about rewritten ids), Rename,
Delete (confirmed; `branch_not_fully_merged` offers a confirmed forced
delete). Remote branches: check out as a tracking branch, merge into current.
Any node: create a branch here. `would_overwrite_changes` lists the
blocking files and states that nothing changed. **[live]**
Publish / set upstream / fetch / pull / push: **[planned]** (backend
network operations exist).

## Search

Message search (or commit id prefix when the text is 4+ hex characters) runs
in the backend; results are a flat list without lanes, because matches are
not connected history. **[live]**

## Live updates

`repository-changed` refreshes status, diffs, totals, refs, the thread and
commit context by scope; window focus refreshes status. **[live]**
