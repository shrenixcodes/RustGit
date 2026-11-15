# RustGit

**Git, without the overhead.**

A lightweight, cross-platform Git desktop client built with Rust and Tauri.

> **Status: early development.** RustGit is not yet usable as a Git client.
> There are no releases. The list below shows what exists today; everything
> else is planned and tracked in [BUILD_PROGRESS.md](BUILD_PROGRESS.md).

## What is implemented

- Tauri 2 desktop shell with a React + TypeScript frontend.
- `rustgit-git-engine` crate: runs the Git CLI with explicit arguments (no
  shell), discovers repositories (including linked worktrees), and parses
  `git status --porcelain=v2 -z`. Credentials in URLs are redacted from errors
  and from the command log.
- Design tokens for dark and light themes (WCAG AA text contrast), with the
  theme following the operating system.

## Technology

| Area     | Choice                                              |
| -------- | --------------------------------------------------- |
| Desktop  | Tauri 2                                             |
| Backend  | Rust (stable), Git CLI                              |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4          |
| Fonts    | Inter, JetBrains Mono (self-hosted, SIL OFL 1.1)    |
| Tooling  | pnpm, Cargo, Vitest, GitHub Actions                 |

## Building from source

Prerequisites:

- Rust stable (`rustup`)
- Node.js 22 or later, with pnpm (`corepack enable pnpm`)
- Git
- Platform requirements for Tauri:
  <https://tauri.app/start/prerequisites/>

```bash
pnpm install
```

```bash
pnpm dev
```

`pnpm dev` starts the Vite dev server and launches the native application.

## Testing

```bash
cargo test --workspace
```

```bash
pnpm test
```

```bash
pnpm typecheck
```

The Rust integration tests create disposable Git repositories in temporary
directories; they never touch existing repositories.

## License

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or
[MIT License](LICENSE-MIT) at your option. Bundled fonts are under the SIL
Open Font License 1.1.
