# RustGit UI progress

Owner: UI session. Backend progress lives in `BUILD_PROGRESS.md` (core
session). Branch: `worktree-ui-orbital` (based on `origin/main` `f967219`).

Statuses: NOT STARTED · IN PROGRESS · BLOCKED (backend request) ·
IMPLEMENTED · TESTED · COMMITTED · VERIFIED (native app checked).

## Gap analysis at `f967219` against the Orbital Instrumentation spec

| Area                     | What exists                                          | Gap                                                        |
| ------------------------ | ---------------------------------------------------- | ---------------------------------------------------------- |
| Design tokens            | Previous blue/grey palette, WCAG-checked by hand     | Orbital palette, light theme, density, motion setting, contrast test |
| Shell                    | Fixed 208 px sidebar, single main area               | Collapsible rail, switcher, inspector, operation shelf, splitters, persisted layout |
| Repository selection     | Full-page Repositories view                          | Quick switcher in the rail; keyboard switching             |
| Changes                  | Read-only grouped list                               | Filter, selection, keyboard, inspector, partial markers; diff and staging need R-2…R-5 |
| Commit composer          | none                                                 | Needs R-6, R-7                                             |
| History / graph          | none                                                 | Lane layout engine (frontend); data needs R-8, R-9         |
| Branches                 | none                                                 | Needs R-9, R-11                                            |
| Operation center         | none (engine keeps history, not exposed)             | App-operation log (frontend); Git commands need R-1        |
| Command palette          | none                                                 | Frontend only, over live commands                          |
| Conflicts, remotes, stash, worktrees, PRs | none                                | Phase 6, needs R-13, R-14 and more                         |

Tauri commands that exist: `git_info`, `get_settings`, `set_theme`,
`list_repositories`, `add_repository`, `init_repository`, `open_repository`,
`set_repository_pinned`, `remove_repository`, `repository_status`. No events.

## Plan

First three screens, as directed: **Changes, History, Branches**. All three
are mostly blocked on backend capabilities, so the order is:

1. File requests R-1 … R-14 with schemas (done: `docs/integration/`).
2. Design foundation (Orbital tokens, density, motion, contrast test).
3. Shell (rail + switcher, inspector, shelf + activity, splitters, layout
   persistence, shortcuts).
4. Changes on live status: groups, filter, selection, keyboard, inspector.
   Diff/staging/composer UI is wired as soon as R-2…R-7 land.
5. History: lane layout engine as pure, tested code against the minimal
   shape every log response must have (`oid`, `parents`); the screen is
   enabled once R-8/R-9 exist.
6. Branches: once R-9/R-11 exist.
7. Command palette over live commands.

## Tasks

| ID   | Task                                          | Status     | Commit |
| ---- | --------------------------------------------- | ---------- | ------ |
| U-1  | UI research, decisions, interaction spec      | COMMITTED  | see git log |
| U-2  | Integration docs and backend requests         | COMMITTED  | see git log |
| U-3  | Orbital design foundation                     | COMMITTED  | see git log |
| U-4  | Application shell                             | COMMITTED  | see git log |
| U-5  | Changes workspace on live status              | COMMITTED  | see git log |
| U-6  | Commit graph lane layout engine               | COMMITTED  | see git log |
| U-7  | UI test plan and acceptance tracker           | COMMITTED  | see git log |
| U-8  | Diff viewer, staging, commit composer         | NOT STARTED | backend ready: C-1 + C-2 amendments |
| U-9  | History workspace                             | COMMITTED  | see git log |
| —    | Branches workspace                            | BLOCKED    | C-2 branch commands defined, not implemented |
| —    | Command palette                               | NOT STARTED | |

### U-3 Orbital design foundation

Tokens in `src/styles/tokens.css` (dark and light, surfaces, lines, text,
accents, semantic, diff, six graph lanes, density variables). Contrast is
enforced by `src/styles/tokens.test.ts`, which parses the stylesheet and
checks text tokens ≥ 4.5:1 and graphical tokens ≥ 3:1 on all five surfaces of
each theme. One brief color changed (dark muted text, `#71818F` → `#7D8C99`);
violet is limited to non-text use. UI preferences (density, motion, layout
sizes) in `src/stores/preferences.ts`, persisted to `localStorage` and
re-clamped on load. Primitives: `Button`, `IconButton` (always labelled,
tooltip with shortcut), `SegmentedControl` (radio group with arrow keys),
`Kbd`. Shortcut matching in `src/app/shortcuts.ts`. Settings: theme,
density, motion, Git info.

Tests: Vitest 72 passed (50 contrast checks, preferences persistence and
corrupt-value recovery, shortcut matching per platform, existing suites).
`tsc --noEmit` clean. No frontend linter or formatter is configured in the
repository; none was added.

### U-4 Application shell

Navigation rail (collapsible, resizable 184–320 px, auto-collapses below
1100 px with its own expand toggle) with the repository switcher at the top
(`Mod+P`; filter, arrow keys, Enter; shows the active repository's real
branch and change count; errors from `open_repository` stay in the popover).
Unavailable sections are disabled with the reason in the tooltip. Inspector
host (`WorkspaceLayout`): docked and resizable from 1240 px, an overlay
below. Operation shelf: branch or detached HEAD, upstream ahead/behind,
change summary (links to Changes), running operation with elapsed time,
failure count, activity toggle (`Mod+J`). Activity panel: operations the UI
invoked, recorded from the TanStack mutation cache with real outcome,
duration and backend error. Splitters follow the WAI-ARIA window-splitter
pattern; sizes persist. Shortcuts: `Mod+1`/`Mod+2` sections, `Mod+,`
settings, `Mod+Shift+O` repositories, `Mod+B`, `Mod+I`, `Mod+J`, `Mod+P`,
`Mod+R`/`F5` refresh. The last repository is restored by **path** through
`open_repository` (ids belong to one database, `localStorage` to the WebView
profile, so ids would collide across `RUSTGIT_DATA_DIR`s).

### U-5 Changes workspace on live status

Virtualized file tree (ARIA tree, flattened rows) grouped Conflicted /
Staged / Unstaged / Untracked; a partially staged file appears in both
Staged and Unstaged with a "partial" marker and says so in its accessible
name. Filter (deferred, path and original path). Keyboard: arrows,
PageUp/PageDown, Home/End, Left/Right collapse and expand. File inspector:
index and working-tree state, rename source, conflict and partial-staging
explanations, copy path. The diff pane states that diffs are not available
yet; no stage, discard or commit control is rendered (blocked on R-2…R-7).

### U-6 Commit graph lane layout engine

`src/features/history/graphLayout.ts`: single-sweep lane assignment over
topologically ordered commits, incremental across pages (identical output
whether history arrives whole or paged), HEAD's first-parent line keeps lane
color 0, merges and octopus merges, lanes rejoin as early as possible.
Not rendered anywhere until the backend log exists.

### U-7 Native verification and visual QA (2026-11-15)

Built with `tauri build --debug --no-bundle` (as CI does) from this branch.

- Native smoke test (`tests/native/windows-smoke.mjs`, unchanged): the
  first runs exposed two real bugs, both fixed and covered by tests:
  1. the rail's hover shortcut hint was part of each button's accessible
     name ("Changes Ctrl+2"); it is now `aria-hidden`;
  2. remembered repository and section were keyed by database id, which
     collides across `RUSTGIT_DATA_DIR`s that share one WebView profile;
     both are now keyed by path.
  After the fixes: 5 consecutive passes. One earlier run timed out taking a
  screenshot of the Changes view; a frame/resize-observer probe showed no
  render loop (one observer callback, steady frames, 96 ms screenshot) and it
  did not recur. Recorded as unexplained.
- Visual QA (real app, disposable repository with a partially staged file,
  40 untracked files in a deep directory, dot-directories): dark and light
  themes at 1280×800, and 1024×640. No console errors, no application log
  errors. Fixed from review: file names were truncated before long
  directories; the switcher popover wrapped because the 13 px root font
  shrinks rem-based widths; Overview restyled from large cards to dense
  panels.

## Backend progress observed

The core session answered R-1 … R-14 with contracts C-1 (implemented:
staging, diff, hunk/line staging, discard, commit, command history) and C-2
(defined; log, refs, branches, network, conflicts, stash, worktrees,
watching). The next UI task is the diff viewer, staging controls and commit
composer against C-1/C-2.

### U-9 History workspace (2026-11-16)

On `log_page` (pages of 300, on demand), `list_refs`, `commit_details`, and
`watch_repository` + `repository-changed` for live updates (status, refs and
log are invalidated by scope; this also makes Changes and the shelf live).
Graph: incremental lane layout (`historyLayout.ts` reuses unchanged pages by
object identity and resumes from the saved lane state), one SVG cell per
row, distinct node shapes for commit / merge / HEAD, labels for current
branch, local, remote, tag and detached HEAD. Commit inspector, keyboard
navigation (first parent, nearest child, copy SHA), refs / search / date
filters, ancestors/descendants focus. Search results are shown without the
graph (they are not connected history), with "Show in graph" to reveal a
commit in context.

Native QA (debug build, Windows, real repositories):
- Small repository with a `--no-ff` merge, a tag and remote-tracking
  branches: labels, merge marker, HEAD, first-parent navigation, message
  search, and a commit made outside RustGit appearing without refresh all
  pass, in dark and light themes.
- Large repository (4 636 commits, a merged topic branch every 25 commits,
  generated with fast-import): first page in 307–460 ms, 40 rows mounted,
  scrolling 40 half-viewports at median 7–11 ms and p95 19–21 ms per frame,
  further pages loaded while scrolling.
- No console or application log errors; the native smoke test passes.

Not done: commit file diffs (need the diff viewer), compare (request R-16),
context menu, minimap. A new search briefly shows "Reading history…" in
place of the previous list while the backend query runs.

### U-10 ShrenixCodes design system (2026-11-16)

Palette, typography, signature labels, quiet/deep personalities, the mark
and the open node; contrast enforced for dark, deep and light surfaces.
Design documents: `SHRENIXCODES_DESIGN_SYSTEM.md`, `SHRENIXCODES_UX_DECISIONS.md`.

### U-11 The thread (2026-11-16)

Replaced the panel model (rail, pages, navigator, diff panel, inspector)
with one canvas, approved by the user from wireframes (`SCREEN_MODEL.md`).
Built on real commands: review stream with hunk and line staging, inline
commit from the loose end, commit folds with cherry-pick and revert, the
map with branch operations, seal, command palette, sheets. Shared-file
changes: `IpcError` now keeps `CommandError.details`; the native smoke test
drives the thread (both recorded in `docs/integration/INTEGRATION_STATUS.md`).

Verification: 178 Vitest tests; native thread QA 16/16 checks against the
Git CLI; native staging QA 13/13; native smoke test passes. Three visual
defects found in native QA and fixed (duplicate open ring on HEAD, lanes
interrupted by folds, oversized commit fold). Remaining work is listed in
`INTERACTION_SPEC.md` as [planned] / [blocked].

### U-12 Conflict resolution (2026-11-16)

At the loose end: the resolver (blocks with per-block choices, full
versions, editable result) on `conflict_versions` / `resolve_conflict`, and
the operation banner (continue / abort) on `continue_operation` /
`abort_operation`. Resolution is confirmed from the status the backend
returns, not from the click. The parser and assembler (`thread/conflicts.ts`)
handle merge, diff3 and zdiff3 markers and keep CRLF. Built without
CodeMirror Merge: per-block choices against the backend's stages did not
need an editor dependency.

Verification: 191 Vitest tests (13 new); native conflict QA 15/15 against
real merge and rebase conflicts (block and whole-file resolution, continue
to a two-parent merge commit, abort of a merge and of a rebase); thread QA
16/16 and the native smoke test still pass. One defect found and fixed: the
resolver was keyed on query update time, so refetches and watcher events
discarded the user's choices.
