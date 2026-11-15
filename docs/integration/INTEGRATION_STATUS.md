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
