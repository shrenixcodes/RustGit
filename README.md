# RustGit

**Git, without the overhead.**

A lightweight, cross-platform Git desktop client built with Rust and Tauri.

> **Status: 0.3.1.** Installers for Windows, macOS and Linux are on the
> [releases page](https://github.com/shrenixcodes/RustGit/releases). They are
> not code-signed yet, so your OS will warn on first launch. RustGit checks
> the releases page for newer versions and can download and run the installer.

## Features

- **The thread:** one canvas for the repository. The working tree (the
  "loose end") sits on top of the commit graph; unfold any node in place.
- **Changes:** stage and unstage files, hunks or single lines; discard with
  confirmation; commit and amend inline.
- **History:** live commit graph with branch, remote and tag labels, search
  by message, author or commit id, and per-file commit diffs. Handles
  repositories with thousands of commits.
- **Branches (the map):** create, switch, rename, delete, track, merge,
  rebase, cherry-pick and revert.
- **Conflicts:** resolve merge and rebase conflicts block by block, then
  continue or abort.
- **Compare:** commits on each side and changed files between any two
  branches, tags or commits.
- **Sync:** fetch, pull (fast-forward, merge or rebase), push and publish,
  with Git's own progress and cancel; clone. Git authentication goes
  through Git's credential helper; RustGit never stores Git passwords.
- **GitHub:** sign in with the device flow or a personal access token, or
  reuse a token from the GitHub CLI, GitHub Desktop or Git Credential
  Manager. Pick one of your repositories to clone, or create a repository on
  GitHub and publish a local one to it. On Windows and macOS the token is
  kept in the system credential store (Credential Manager, Keychain).
- **New repositories:** create one with an optional README, `.gitignore`
  template and license.
- **Remotes, stash and worktrees:** manage all three from the app.
- **Everywhere:** command palette (`Ctrl/Cmd+K`), full keyboard shortcuts
  (`?`), dark and light themes, live updates when files change on disk, and
  an activity log of every Git command run.

RustGit drives the Git CLI with explicit arguments (no shell). Credentials
in URLs are redacted from errors and from the command log.

Not yet supported: pull requests, interactive rebase, submodules, Git LFS.

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

### GitHub sign-in

Sign-in uses GitHub's OAuth device flow and is enabled only when the build knows
a public OAuth App client id. Register an OAuth App on GitHub with device flow
enabled, then set `RUSTGIT_GITHUB_CLIENT_ID` when building (or running). No
client secret is needed. Without it the GitHub settings section says sign-in is
unavailable; Git itself keeps working through the credential helper and
RustGit's own password prompts.

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
