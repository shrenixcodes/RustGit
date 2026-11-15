# Integration status

Statuses: NOT STARTED · IN PROGRESS · BLOCKED · IMPLEMENTED · TESTED ·
VERIFIED. VERIFIED means exercised end to end in the running native
application against a real repository. Compiling is never enough.

"IPC VERIFIED" means every command of the feature was called from the
running native application's WebView against a real repository and its
result checked (`apps/desktop/tests/native/windows-smoke.mjs`, Windows). It
does not mean a UI for the feature exists or was tested.

"Frontend" refers to `main`. The UI session's redesign lives on branch
`worktree-ui-orbital` and is not merged yet.

| Feature              | Backend | API contract | Frontend (main) | Integration test |
| -------------------- | ------- | ------------ | --------------- | ---------------- |
| Repository discovery | TESTED  | IMPLEMENTED  | IMPLEMENTED     | VERIFIED (native smoke, UI driven) |
| Changes and staging  | TESTED  | IMPLEMENTED  | Read-only list; staging UI is the UI session's | IPC VERIFIED |
| Diff viewer          | TESTED  | IMPLEMENTED  | NOT STARTED     | IPC VERIFIED     |
| Commit               | TESTED  | IMPLEMENTED  | NOT STARTED     | IPC VERIFIED     |
| History graph        | TESTED  | IMPLEMENTED  | NOT STARTED     | IPC VERIFIED     |
| Branch management    | TESTED  | IMPLEMENTED  | NOT STARTED     | IPC VERIFIED     |
| Remotes              | TESTED  | IMPLEMENTED  | NOT STARTED     | IPC VERIFIED (push, fetch, clone, events) |
| Conflict resolution  | TESTED  | IMPLEMENTED  | NOT STARTED     | IPC VERIFIED (merge conflict resolved) |
| Stash                | TESTED  | IMPLEMENTED  | NOT STARTED     | IPC VERIFIED     |
| Worktrees            | TESTED  | IMPLEMENTED  | NOT STARTED     | IPC VERIFIED     |
| Filesystem watching  | TESTED  | IMPLEMENTED  | NOT STARTED     | IPC VERIFIED (repository-changed received) |
| GitHub integration   | BLOCKED | NOT STARTED  | NOT STARTED     | NOT STARTED      |
| Settings (theme)     | TESTED  | IMPLEMENTED  | IMPLEMENTED     | VERIFIED (native smoke, UI driven) |

Backend "TESTED" = unit tests plus integration tests against real
temporary repositories, passing on Linux, Windows and macOS CI.

## Ready for the UI session

Contracts C-1 and C-2 are implemented. Every UI request R-1 … R-14 has a
command; differences from the requested shapes are listed in
`API_CONTRACT.md` ("Contract C-2"). Typed wrappers are in
`apps/desktop/src/services/ipc.ts`, payload and event types in
`apps/desktop/src/services/types.ts`.

## Blocked

- **GitHub integration.** The device-authorization flow needs the client
  ID of a GitHub OAuth App (or GitHub App) registered by the project owner.
  RustGit must not borrow another application's client ID or use the gh
  CLI's token. Once a client ID exists, the backend work is: device flow,
  token storage in the OS credential store (keyring), and REST calls for
  user, repositories, pull requests, issues, releases and notifications.
- **Native smoke test on GitHub's `windows-latest` runner.** The WebView2
  DevTools port never opens there. Passes locally. See `BUILD_PROGRESS.md`
  A-4.

## Merge note for the UI branch

`worktree-ui-orbital` contains its own versions of `docs/integration/*.md`
written before these existed on `main`. When merging, keep `main`'s files
(the backend owns the contract) and carry over anything from the UI
branch's request log that is not yet answered here.

## Shared files

`apps/desktop/src/services/types.ts` and `apps/desktop/src/services/ipc.ts`
are the IPC contract mirror and are maintained by the backend session with
each contract change. Other frontend files belong to the UI session.

## UI session update (2026-11-15)

Branch `worktree-ui-orbital`, merged with `main` at `0cca721`:

- Implemented against real commands: Orbital design tokens (contrast
  enforced by `styles/tokens.test.ts`), shell (rail with repository
  switcher, inspector host, operation shelf, activity panel), Changes file
  tree on `repository_status`, dense Overview, density and motion settings,
  commit graph lane layout engine.
- In progress: History workspace on `log_page`, `list_refs`,
  `commit_details`. Then the diff viewer, staging and commit composer on C-1.
- `types.ts` / `ipc.ts` untouched by the UI session.
- The UI stores UI preferences and the last-opened repository **path** in
  WebView `localStorage` (per WebView profile, not per `RUSTGIT_DATA_DIR`).
  Repository ids are never persisted on the UI side because they collide
  across data directories.
- Rail section buttons keep exact accessible names ("Changes", "Settings").
- No new backend requests.
