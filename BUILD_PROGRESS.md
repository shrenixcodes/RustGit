# RustGit build progress

Statuses: NOT STARTED · IN PROGRESS · BLOCKED · IMPLEMENTED · TESTED ·
COMMITTED · VERIFIED. A task is complete only when implementation, relevant
tests and its commit exist. VERIFIED additionally requires passing CI.

## Environment (initial inspection, 2026-11-15)

| Tool             | Version / state                                              |
| ---------------- | ------------------------------------------------------------ |
| OS               | Windows 11 Home 10.0.26200                                   |
| Rust             | 1.98.0, `stable-x86_64-pc-windows-gnu`                       |
| C toolchain      | WinLibs MinGW-w64 GCC 16.1 (no MSVC Build Tools installed)   |
| Node.js          | 24.14.1                                                      |
| pnpm             | 12.21.0 (via corepack)                                       |
| Tauri CLI        | 2.12.4 (`@tauri-apps/cli` dev dependency)                    |
| Git              | 2.54.0.windows.1                                             |
| GitHub CLI       | 2.103.3, authenticated                                       |
| WebView2         | 157.0.4341.46                                                |
| Remote           | `origin` → https://github.com/shrenixcodes/RustGit.git       |

Local machine issues found (not project defects, not changed by the build):

- `ComSpec` is set to `C:\Program Files\MySQL\MySQL Server 8.0\bin` instead of
  `C:\Windows\System32\cmd.exe`, which makes every `pnpm run` script fail
  with "Access is denied". Local commands were run with `ComSpec` overridden
  per process.
- `D:\bin` (an old 32-bit MinGW.org GCC 6.3 with `dlltool` 2.28) precedes the
  64-bit WinLibs toolchain on `PATH`, which breaks Rust `windows-gnu` linking.
  Local builds put the WinLibs `bin` directory first on `PATH`.
- The `windows-gnu` linker warns `.rsrc merge failure: multiple non-default
  manifests`. The app launches and renders correctly; release builds are
  produced on MSVC CI runners, where this does not occur.

## Tasks

| ID  | Task                                         | Status    | Commit    |
| --- | -------------------------------------------- | --------- | --------- |
| F-1 | Repository configuration and license         | VERIFIED  | `7285ef2` |
| F-2 | Initialize Tauri desktop application         | VERIFIED  | `696a597` |
| F-3 | Git CLI engine: discovery and status         | VERIFIED  | `05e349c` |
| F-4 | Design tokens and theming                    | VERIFIED  | `422b830` |
| F-5 | CI workflow                                  | VERIFIED  | `5343893` |
| F-6 | README                                       | VERIFIED  | `1050f60` |
| F-7 | GitHub repository metadata                   | VERIFIED  | n/a       |
| A-1 | Repository registry, settings store, IPC     | COMMITTED | `6abdee7` |
| A-2 | Typed IPC client                             | COMMITTED | `6e48c5e` |
| A-3 | App shell and repository manager            | COMMITTED | `460f946` |
| A-4 | Native Windows smoke test (CI: BLOCKED)      | COMMITTED | `21bb177` |

### F-1 Repository configuration and license

`.gitignore`, `.editorconfig`, `.gitattributes` (LF normalization),
`rust-toolchain.toml` (stable + rustfmt + clippy), dual MIT / Apache-2.0
license files. Dependency licenses at this point are MIT and/or Apache-2.0
(Tauri, Serde, Tokio, tracing, thiserror) and SIL OFL 1.1 (fonts), all
compatible with the dual license.

### F-2 Initialize Tauri desktop application

Tauri 2.12.5, React 19.3.1, TypeScript 7.0.2 (strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), Vite 8.3.8, pnpm workspace. Restrictive CSP; the
only capability granted is `core:app:allow-version`. Original icon
(`icons/app-icon.svg`) rendered with `tauri icon`.

Tests: `tsc --noEmit` passed; `vite build` passed; `cargo build` and
`cargo clippy -D warnings` passed. Native launch: `pnpm dev` opened a native
window titled "RustGit" (verified by process window title and a window
screenshot showing the rendered page and the version string returned over
IPC). The window was closed through `CloseMainWindow` and the process exited
with code 0.

### F-3 Git CLI engine

Crate `crates/git-engine`. Runs Git with explicit arguments, never a shell;
sets `GIT_TERMINAL_PROMPT=0`; hides console windows on Windows; keeps a
bounded (200 entries) redacted command history for the future command
inspector. `discover` uses `git rev-parse --path-format=absolute`, so linked
worktrees with a `.git` file are supported. `read_status` parses
`git status --porcelain=v2 --branch -z --untracked-files=all`.

Tests: 5 unit tests (porcelain parser, redaction) and 8 integration tests
against disposable repositories (version, missing Git binary, init/discover
from subdirectory, non-repository and missing paths, linked worktree,
modified/deleted/added/untracked including Unicode paths, unborn branch,
credential redaction on failure). Result: 13 passed, 0 failed.

Git2-rs is not used yet: every operation so far is covered by the Git CLI,
and adding libgit2 would add a C build dependency without a current need.

### F-4 Design tokens and theming

Tokens in `apps/desktop/src/styles/tokens.css`, mapped into Tailwind 4 in
`index.css`. Contrast was computed with the WCAG 2.1 relative luminance
formula; seven brief colors were adjusted in lightness only (listed in
`tokens.css`). Fonts are self-hosted WOFF2 (Inter 400/500/600, JetBrains Mono
400/500; latin and latin-ext subsets, 244 KB total) with OFL license files.

Tests: Vitest, 5 tests for theme resolution and OS change tracking. Result:
5 passed. Native launch screenshot confirmed dark theme and both fonts.

Known limitations: theme preference is not persisted yet; it always follows
the OS until the settings store exists.

### F-5 CI workflow

`.github/workflows/ci.yml`: frontend typecheck/test/build on Ubuntu; Rust fmt,
Clippy (`-D warnings`) and tests on Ubuntu, Windows and macOS. Third-party
actions pinned to commit SHAs; `contents: read` permissions.

CI run 43726161791 on `1050f60`: Frontend, Rust (ubuntu-latest),
Rust (windows-latest) and Rust (macos-latest) all succeeded, so the Git
integration tests pass on all three platforms.
https://github.com/shrenixcodes/RustGit/actions/runs/43726161791

### F-7 GitHub repository metadata

Description set; 20 topics set (the maximum GitHub allows) as requested.

### A-1 Repository registry, settings store, IPC commands

New crate `crates/core` (no Tauri dependency): SQLite store (rusqlite 0.43,
bundled SQLite) with `user_version` migrations
(`crates/core/migrations/0001_initial.sql`), tables `repositories` and
`settings`; per-repository reader/writer locks; `CommandError` with stable
`kind` values. The desktop crate exposes `git_info`, `get_settings`,
`set_theme`, `list_repositories`, `add_repository`, `init_repository`,
`open_repository`, `set_repository_pinned`, `remove_repository` and
`repository_status`. Each is declared in the build-script app manifest and
granted explicitly in `capabilities/default.json`. Git and SQLite calls run
on the blocking thread pool.

Tests: 11 unit tests in `rustgit-core` (migrations, newer-schema rejection,
upsert idempotency, pin ordering, missing ids, theme default/persist/invalid
fallback, error mapping and serialization, lock semantics).

Note: the desktop crate's test harness is disabled (`test = false`). Rust
test binaries do not receive the Windows common-controls v6 manifest that
Tauri's dialog stack requires and fail to load with
`STATUS_ENTRYPOINT_NOT_FOUND`; logic was moved to `crates/core` so it stays
testable. The application binary itself loads correctly.

### A-2 Typed IPC client

`src/services/types.ts` mirrors the Rust serde types; `src/services/ipc.ts`
wraps every command and converts failures into `IpcError` with a typed kind.
Tests: 3 Vitest tests.

### A-3 App shell and repository manager

Sidebar with all planned sections; unimplemented ones are disabled and
labelled "Soon" (History, Branches, Stashes, Worktrees, Remotes, Pull
Requests). Implemented: Repositories (add via native folder picker, create
via `git init`, open with validation, pin, search, remove from list without
deleting files, actionable error for moved/deleted repositories), Overview
(branch, commit, upstream, ahead/behind, staged/unstaged/untracked/conflicted
counts), Changes (read-only staged/unstaged/conflicted lists), Settings
(persisted theme, detected Git version and executable). Status refreshes on
window focus or the Refresh button; nothing polls.

Tests: Vitest 18 passed (repository view: empty state, add via dialog,
cancelled dialog, missing repository error and removal, search; sidebar
enable/disable and navigation; change grouping and counts; theme; IPC).

Known limitations: staging, committing, and filesystem-event refresh are not
implemented; file lists are not virtualized yet; layout is not persisted.

### A-4 Native Windows smoke test

`apps/desktop/tests/native/windows-smoke.mjs` launches the built executable
with `RUSTGIT_DATA_DIR` pointing at a temporary directory, connects to the
WebView2 through the DevTools protocol (playwright-core, no bundled browser)
and drives the real UI against a disposable repository. The folder picker is
a native dialog and is bypassed by invoking the same `add_repository`
command it feeds; everything else goes through the UI.

Local result (Windows 11, debug build with embedded frontend): passed:
empty list, add and open, overview counts and commit id match Git, changes
list, refresh after an external file creation, theme persisted across
reload, window close with exit code 0, no errors in the application log.

CI status: BLOCKED. On `windows-latest` the WebView2 runtime is not
registered by default; after installing it (156.0.4314.58) with Microsoft's
bootstrapper the application starts and opens its database, but the
DevTools port never opens within 60 s (runs 43729125015, 43729658255,
43730094906, 43730706203). The job lives in the manually triggered
`.github/workflows/native-smoke.yml` until the cause is found, so `ci.yml`
reports only checks that actually pass.

Linux (WebKitGTK) and macOS (WKWebView) do not expose the DevTools protocol;
native smoke testing on those platforms is not implemented yet.

## Initial quality checks (2026-11-15)

| Check                                 | Result                         |
| ------------------------------------- | ------------------------------ |
| `cargo fmt --all --check`             | passed                         |
| `cargo clippy --workspace -D warnings`| passed                         |
| `cargo test --workspace --locked`     | 13 passed, 0 failed            |
| `pnpm install --frozen-lockfile`      | passed                         |
| `pnpm typecheck`                      | passed                         |
| `pnpm test`                           | 5 passed, 0 failed             |
| Tauri CLI                             | 2.12.4                         |
| Native app launch (Windows, dev)      | window rendered, clean exit    |
| GitHub CLI authentication             | authenticated                  |
| Remote                                | correct                        |

## Not started

Staging, commits, branches, history
graph, diff viewer, remotes, stashes, worktrees, GitHub integration, settings
persistence (SQLite), filesystem watching, performance benchmarks, native
smoke tests in CI, installers and releases.
