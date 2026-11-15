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
