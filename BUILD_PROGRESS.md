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

Application shell, repository manager, staging, commits, branches, history
graph, diff viewer, remotes, stashes, worktrees, GitHub integration, settings
persistence (SQLite), filesystem watching, performance benchmarks, native
smoke tests in CI, installers and releases.
