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
- Done: History workspace on `log_page`, `list_refs`, `commit_details` and
  `repository-changed` (U-9). Next: diff viewer, staging, commit composer.
- `types.ts` / `ipc.ts` untouched by the UI session.
- The UI stores UI preferences and the last-opened repository **path** in
  WebView `localStorage` (per WebView profile, not per `RUSTGIT_DATA_DIR`).
  Repository ids are never persisted on the UI side because they collide
  across data directories.
- Rail section buttons keep exact accessible names ("Changes", "Settings").
- No new backend requests.

## Request R-15 from the UI session — default theme is dark (2026-11-16)

Product decision from the user: **dark mode is the default.** The UI's own
fallbacks (first paint, settings not yet loaded or failed) are dark on
branch `worktree-ui-orbital`. The persisted default is the backend's:

- `crates/core/src/database/settings.rs`: `ThemePreference` has
  `#[default] System`. Requested: `#[default] Dark`, so a fresh install and
  an invalid stored value both resolve to `"dark"`. Users who explicitly
  chose `"system"` or `"light"` keep their choice (stored values are
  unchanged).
- Tests `theme_defaults_to_system_and_persists` and
  `invalid_stored_theme_falls_back_to_default` assert `System` and need the
  same update.
- No contract shape change: `get_settings` still returns
  `"system" | "light" | "dark"`.
- Native smoke test: it switches to Light and checks persistence, so it is
  unaffected.

Until this lands, a fresh install shows dark for the first paint and then
follows the OS (the backend's `"system"`).

## Request R-16 from the UI session — compare two revisions (2026-11-16)

Feature: "Compare two commits" and "Compare branches" in History and
Branches. `log_page` can already list commits for a range if it accepts
`A..B` revisions (please confirm), but the file-level comparison needs a
range diff.

```ts
compare_revisions({ id, base: string, head: string, mergeBase: boolean })
  -> {
    base: string; head: string;        // resolved full object ids
    mergeBase: string | null;          // when mergeBase: true (three-dot comparison)
    ahead: number; behind: number;     // commits in head not in base, and the reverse
    files: Array<{ path: string; originalPath: string | null; kind: ChangeKind;
                   additions: number | null; deletions: number | null }>;
  }
compare_file_diff({ id, base, head, mergeBase, path, originalPath?, contextLines? }) -> FileDiff  // side "commit"
```

Errors: `invalid_request` for unknown revisions (message names which one).
Same revision validation as `log_page` (no leading `-`).
UI depending on it: History "Compare with selected", Branches "Compare".
Priority: P1 (spec acceptance workflow 10).

## UI session update (2026-11-16): the thread

- The UI no longer has pages: the repository is one canvas (see
  `docs/SCREEN_MODEL.md`). Commands used: everything in C-1, plus `log_page`,
  `list_refs`, `commit_details`, `commit_file_diff`, branch mutations,
  `merge_branch`, `rebase_branch`, `cherry_pick`, `revert_commit`,
  `command_history`, `watch_repository`, `repository-changed`.
- **Shared file changed:** `apps/desktop/src/services/ipc.ts`: `IpcError`
  now carries the optional `details` from `CommandError` (needed to list the
  paths of `would_overwrite_changes`). Backward compatible; commit `560264d`.
- **Core-owned test changed:** `apps/desktop/tests/native/windows-smoke.mjs`
  steps that drove the old Overview and Changes pages now drive the thread
  (same assertions: counts, HEAD id, changed files, refresh, theme). The C-1
  and C-2 IPC checks are untouched. Commit `98cf47f`.
- Still open for the UI: conflict resolution editor (`conflict_versions`,
  `resolve_conflict`), stash, worktrees, remotes and network operations on
  the map. Backend requests still open: R-15 (dark default), R-16 (compare).
