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
