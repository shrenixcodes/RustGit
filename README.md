# RustGit

**Git, without the overhead.**

A lightweight, fast, cross-platform Git desktop client built with Rust, Tauri 2, React, and the Git CLI directly—combining a unified commit thread, Bezier branch graph, inline diffs, and full keyboard control in a small native binary.

> **Status: 0.4.68.** Installers for Windows, macOS, and Linux are available on the
> [releases page](https://github.com/shrenixcodes/RustGit/releases) (currently unsigned,
> so OS Gatekeeper/SmartScreen warnings appear on first launch). RustGit also checks
> GitHub Releases for newer versions and can download and run the installer in-app.

## Features

- **The Thread & Loose End:** One unified canvas where uncommitted changes ("the loose end") sit directly above commit history. Unfold any node in place without leaving context.
- **Smooth Commit Graph & Continuity:** Cubic Bezier branch and merge curves, distinct node markers (merge commits, `HEAD` ring, branch/tag/remote pills), passing branch rails running cleanly behind unfolded commits, and a zoomed-out **Map** mode for repository topology.
- **Inline Review Stream & Staged Totals:** Unified and split diff layouts with word-level change emphasis, live staged `+`/`−` line counts in the commit composer, optional whitespace ignoring, and staging/unstaging/discarding by file, hunk, or `Shift`-selected line ranges.
- **History Search & Per-Commit Inspection:** Search commits by message, `author:`, `branch:`, `since:`, `until:`, or SHA prefix; inspect commit metadata and changed files, with full-width diffs and wrapped lines, and cherry-pick or revert inline.
- **Branches & Conflict Resolution:** Create, switch, rename, delete, track upstream branches, merge, and rebase—plus a block-by-block conflict resolver (`ours` / `theirs` / manual edits) to finish or abort mid-operation.
- **Compare, Stash, Worktrees & Remotes:** Compare any two revisions (commits unique to each side plus file diffs), preview stashed file diffs before applying/popping/dropping, manage linked worktrees, and edit remotes.
- **Sync & GitHub Integration:** Fetch, pull (fast-forward, merge, or rebase), push, publish, clone, and optional automatic background fetching with live Git progress and cancellation. Sign in via GitHub OAuth device flow or PAT (reusing tokens from `gh`, GitHub Desktop, or Git Credential Manager when present) with OS keychain storage on Windows/macOS. Git passwords go through your Git credential helper (`askpass` prompt fallback; never stored by RustGit) and secrets are redacted from errors and command logs.
- **Appearance, Density & Motion Controls:**
  - **Themes:** System, Light, and Dark palettes.
  - **Workspace modes:** `Quiet` (spacious daily workflow) and `Deep` (denser history investigation), toggled with `Ctrl/Cmd+Shift+D`.
  - **Motion preferences:** `Full`, OS-matching (`Follow Windows` / `Follow system`), or `Reduced`.
- **Keyboard-First Workflow:** Global command palette (`Ctrl/Cmd+K`), quick repository switcher (`Ctrl/Cmd+P`), full shortcut reference (`?`), and a collapsible Activity panel showing live Git operations and command history.

> **Direct Git execution:** RustGit spawns the Git CLI with explicit arguments (never through a shell).
>
> **Not yet supported:** Pull requests, interactive rebase, submodules, Git LFS.

## Lightweight & Low-End Performance Design

RustGit is engineered to stay responsive even on dual-core CPUs, 4–8 GB RAM laptops, integrated graphics, and large working trees:

- **Native Tauri 2 footprint:** Uses the platform's system WebView instead of bundling Chromium, with `unsafe_code = "forbid"` workspace lints and size/LTO release optimization (`opt-level = "s"`, `lto = true`, `~3.11 MiB` Windows NSIS installer).
- **Virtualization & chunked DOM rendering:** Commit rows and loose-end diff lines render inside virtualized windows; read-only commit, compare, and stash diffs load incrementally (`250` rows initially, expanding in chunks up to `5,000` inline) to prevent synchronous DOM stalls.
- **Compositor-friendly visuals:** Transitions stay on transform/opacity without expensive backdrop-blur layers; diff layout, longest-line measurement, and date formatting are memoized and bounded.
- **Bounded backend captures & smart watching:** `GitExecutor::run_capped` short-circuits oversized modified, untracked, or committed diff streams right past the `2 MiB` / `20,000`-line limit, commit numstat joins use O(1) hash lookups, query caches garbage-collect inactive diffs/history in `60s`–`90s`, and the filesystem watcher batches and FIFO-caches ignore lookups so ignored build directories (`target/`, `node_modules/`) do not spawn Git subprocess storms.

## Keyboard Shortcuts

Press `?` anywhere in the app for the complete shortcut reference. Highlights:

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + K` | Open Command Palette |
| `Ctrl/Cmd + P` | Switch Repository |
| `Ctrl/Cmd + N` / `O` | Create or Open Repository |
| `Ctrl/Cmd + Shift + D` | Toggle Quiet / Deep workspace |
| `Ctrl/Cmd + ,` | Open Settings |
| `Ctrl/Cmd + J` | Toggle Activity Panel |
| `Ctrl/Cmd + -` / `0` | Switch Map / Thread view |
| `/` | Search Commit Thread |
| `Ctrl/Cmd + R` or `F5` | Refresh Repository |
| `Ctrl/Cmd + Enter` | Commit Staged Changes |

## Technology Stack

| Area | Choice |
| --- | --- |
| **Desktop** | Tauri 2 (native system WebView) |
| **Backend** | Rust (edition 2024, MSRV 1.88, `unsafe_code = "forbid"`), SQLite (`rusqlite`), Git CLI |
| **Frontend** | React 19, TypeScript 7, TanStack Query 5, Zustand 5, Tailwind CSS 4, Vite 8 |
| **Fonts** | Inter, JetBrains Mono (self-hosted, SIL OFL 1.1) |
| **Tooling** | pnpm 12, Node.js >= 22, Cargo, Vitest 5, GitHub Actions |

## Repository Structure

```text
crates/
  git-engine/    Git CLI execution wrapper, porcelain parsers, diff/patch/status/history engines
  core/          SQLite metadata store, filesystem watcher, askpass broker, GitHub & updater logic
apps/
  desktop/
    src/         React UI, commit graph renderer, virtualized thread/review stream, state & tests
    src-tauri/   Tauri 2 commands, state management, and native desktop bundle setup
```

## Building from Source

### Prerequisites

- Rust stable (`rustup`, minimum 1.88)
- Node.js 22+ and pnpm 12.21.0 (the version specified in `package.json`)
- Git
- [Tauri 2 platform prerequisites](https://tauri.app/start/prerequisites/)

### Development & Release Build

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the Vite development server and launches the native Tauri window. To build an optimized release executable and OS installer bundles:

```bash
pnpm build
```

### Configuration & GitHub Sign-In

- **`RUSTGIT_GITHUB_CLIENT_ID`**: Optional public GitHub OAuth App client ID (with device flow enabled, no secret required) to enable GitHub device-flow sign-in in Settings. Without it, GitHub CLI/GCM token reuse, PAT entry, credential prompts, and all local/remote Git operations continue to work normally.
- **`RUSTGIT_DATA_DIR`**: Optional override directory for isolated local database/state storage.
- **`RUSTGIT_LOG`**: Tracing log filter (defaults to `info`).

## Verification & Testing

```bash
pnpm typecheck
pnpm test
pnpm lint:rust
cargo test --workspace
```

Rust integration tests spin up disposable repositories in temporary directories and never modify user repositories.

The Windows native smoke test launches the built executable against a disposable
repository and exercises the application through WebView2:

```bash
pnpm --filter @rustgit/desktop test:native
```

This command expects `target/debug/rustgit.exe` to have been built first. See
the script's usage comment to test another executable. Linux and macOS builds
are checked by CI, but do not have equivalent native smoke coverage.

## Documentation

The [IPC contract](docs/integration/API_CONTRACT.md) and
[event contract](docs/integration/EVENT_CONTRACT.md) describe backend interfaces.
The dated audit, progress, acceptance and planning documents retain historical
findings; their status tables are not a current release certification.

## License

Dual-licensed under either [Apache License 2.0](LICENSE-APACHE) or [MIT License](LICENSE-MIT) at your option.

Bundled Inter and JetBrains Mono fonts are licensed under the SIL Open Font License 1.1.
