# Integration status

Statuses: NOT STARTED · IN PROGRESS · BLOCKED · IMPLEMENTED · TESTED ·
VERIFIED. VERIFIED means exercised end to end in the running native
application against a real repository. Compiling is never enough.

"Frontend" refers to the UI on `main`. The UI session's redesign lives on
branch `worktree-ui-orbital` and is not merged yet.

| Feature              | Backend     | API contract | Frontend     | Integration test |
| -------------------- | ----------- | ------------ | ------------ | ---------------- |
| Repository discovery | TESTED      | IMPLEMENTED  | IMPLEMENTED  | VERIFIED (local native smoke) |
| Changes and staging  | TESTED      | IMPLEMENTED  | Status list only on `main`; staging UI is the UI session's | IPC VERIFIED (native smoke) |
| Diff viewer          | TESTED      | IMPLEMENTED  | NOT STARTED  | IPC VERIFIED (native smoke) |
| Commit               | TESTED      | IMPLEMENTED  | NOT STARTED  | IPC VERIFIED (native smoke) |
| History graph        | NOT STARTED | NOT STARTED  | NOT STARTED  | NOT STARTED      |
| Branch management    | NOT STARTED | NOT STARTED  | NOT STARTED  | NOT STARTED      |
| Remotes              | NOT STARTED | NOT STARTED  | NOT STARTED  | NOT STARTED      |
| Conflict resolution  | NOT STARTED | NOT STARTED  | NOT STARTED  | NOT STARTED      |
| Stash                | NOT STARTED | NOT STARTED  | NOT STARTED  | NOT STARTED      |
| Worktrees            | Discovery only (TESTED) | NOT STARTED | NOT STARTED | NOT STARTED |
| GitHub integration   | NOT STARTED | NOT STARTED  | NOT STARTED  | NOT STARTED      |
| Settings (theme)     | TESTED      | IMPLEMENTED  | IMPLEMENTED  | VERIFIED (local native smoke) |

"IPC VERIFIED" means every command was called from the running native
application's WebView against a real repository and its result checked
(`apps/desktop/tests/native/windows-smoke.mjs`); it does not mean a UI for
the feature exists or was tested.

## Ready for the UI session

Contract C-1 (staging, diffs, hunk/line staging, commit, command history) is
implemented. The typed wrappers are in `apps/desktop/src/services/ipc.ts`
(`stagePaths`, `unstagePaths`, `stageAll`, `unstageAll`, `discardPaths`,
`fileDiff`, `applyHunk`, `changeTotals`, `authorIdentity`,
`lastCommitMessage`, `createCommit`, `commandHistory`).

## Open integration notes

- Native smoke test on GitHub's `windows-latest` runner: BLOCKED (WebView2
  DevTools port never opens). Passes locally. See `BUILD_PROGRESS.md` A-4.
- Shared files: `apps/desktop/src/services/types.ts` and
  `apps/desktop/src/services/ipc.ts` are the IPC contract mirror and are
  maintained by the backend session alongside each contract change. Other
  frontend files belong to the UI session.

## UI session update (2026-11-15)

Branch `worktree-ui-orbital` (merged with `main` at `969f594`):

- Implemented against real commands: Orbital design tokens (contrast
  enforced by `styles/tokens.test.ts`), shell (rail with repository
  switcher, inspector host, operation shelf, activity panel), Changes file
  tree on `repository_status`, dense Overview, settings for density and
  motion. Commit graph lane layout engine (pure, tested) waiting for
  `log_page` / `list_refs`.
- Not yet using C-1: diff viewer, staging controls, commit composer and the
  `command_history`-backed activity panel are the next UI task (U-8).
- `types.ts` / `ipc.ts` untouched by the UI session. Test fixtures updated
  for `StatusSnapshot.inProgress` (C-2).
- Native smoke test (`windows-smoke.mjs`, unchanged) passes against the
  redesigned UI. Note for the native test: the UI stores UI preferences and
  the last-opened repository **path** in WebView `localStorage`, which is per
  WebView profile, not per `RUSTGIT_DATA_DIR`. Repository ids are never
  persisted on the UI side because they collide across data directories.
- Rail section buttons keep exact accessible names ("Changes", "Settings").
- No new backend requests.
