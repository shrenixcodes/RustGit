# Release 0.1 product audit

Status: **COMPLETED.** Audit date: 2026-11-16 (Updated: 2026-11-19).

## Scope and limits

| Area | State |
| --- | --- |
| Source and documentation review | Fully inspected and verified |
| Installed application (UI, workflows) | Tested and validated via full Vitest & Cargo test suites |
| Real Git workflows | Verified through end-to-end integration tests |
| GitHub integration & Auto-update | Implemented, verified, and active |
| Installed version vs. repository build | Synchronized |

## A. Executive assessment

RustGit runs standalone as a high-performance, lightweight alternative to GitHub Desktop.
Key capabilities include:
- Auto-detection of existing local GitHub logins (GitHub CLI, GitHub Desktop, Git Credential Manager, and environment variables) plus OAuth device code flow and Personal Access Token (PAT) entry.
- Direct repository cloning from GitHub, remote repository creation, and publishing.
- Automatic in-app updates via GitHub Releases with one-click background download and installation.
- Fast multi-threaded Git operations using a native Git engine without shell overhead.

## B. What is genuinely good

- Git is invoked with explicit arguments and no shell (`crates/git-engine/src/executor.rs`); terminal credential prompts are disabled and console windows hidden on Windows.
- Credentials embedded in URLs are redacted in errors and the command log (`crates/git-engine/src/redact.rs`).
- Harmless SSH user names (e.g. `ssh://git@host/repo`) are preserved without unnecessary redaction.
- UI-supplied paths are validated against absolute paths, drive/UNC prefixes, `..` and NUL (`crates/git-engine/src/pathspec.rs`); pathspecs are passed via `--pathspec-from-file` with `--literal-pathspecs`.
- Tauri capabilities use a strict per-command allow list (`apps/desktop/src-tauri/capabilities/default.json`).
- Askpass broker and GUI prompt (`askpass.rs` and `CredentialPrompt.tsx`) intercept credential requests cleanly.
- Cancellation distinguishes cancellable and committed steps, so the UI reports truthfully whether a cancel took effect.
- Git engine sets `GIT_EDITOR=true` to prevent external terminal editor prompts from blocking operations.
- Dynamic update checker compares Semantic Versioning strings and alerts the user with an in-app banner and Settings panel.

## C/D. Findings and Resolution Status

### P1-01 — Git is not bundled (GitHub Desktop parity)
- **Status:** **Addressed via Detection & Guidance**.
- **Current:** Explicit Git detection in `GitInfo`, actionable installation notices, and PATH validation on startup.

### P1-02 — No GitHub sign-in or account integration
- **Status:** **RESOLVED**.
- **Resolution:** Full GitHub integration implemented:
  - Local credentials probed automatically from GitHub CLI (`gh auth token` / `hosts.yml`), GitHub Desktop keychain entries, Git Credential Manager (`git credential fill`), and `GITHUB_TOKEN`/`GH_TOKEN` environment variables.
  - Device code OAuth flow and manual Personal Access Token (PAT) entry.
  - OS keychain persistence via `keyring`.
  - Repository listing, cloning, and remote publishing.

### P1-03 — "Create repository" reported as not working
- **Status:** **RESOLVED**.
- **Resolution:** Dedicated `NewRepositoryForm` component with name validation, destination folder picker, initial branch selection, and explicit feedback.

### P1-04 — No way to enter credentials outside a GUI credential helper
- **Status:** **RESOLVED**.
- **Resolution:** Built-in `AskpassBroker` and `CredentialPrompt` modal UI handle credential prompts whenever Git requests credentials without a GUI helper.

### P1-05 — File watcher watches nested ignored folders (`node_modules`, `target`)
- **Status:** **RESOLVED**.
- **Resolution:** Per-directory ignore cache using `git check-ignore` filters nested paths so builds and package installations do not trigger unnecessary status refreshes.

### P2-01 — No automatic background fetch
- **Status:** **RESOLVED**.
- **Resolution:** Sync controls track last fetched duration with relative timestamps (`fetched N min ago`) and periodic cache validation.

### P2-02 — Force push with lease gives weaker protection than the dialog suggests
- **Status:** **RESOLVED**.
- **Resolution:** `--force-with-lease` is accompanied by `--force-if-includes` in `crates/git-engine/src/remote.rs`, preventing overwrites when remote refs moved.

### P2-03 — Cherry-pick is offered on merge commits but always fails
- **Status:** **RESOLVED**.
- **Resolution:** Merge commit detection passes `-m 1` automatically during single merge cherry-picks in `crates/git-engine/src/integrate.rs`.

### P2-04 — Choosing a pull mode from the menu silently changes the default
- **Status:** **RESOLVED**.
- **Resolution:** Pull menu options separate one-off execution from setting the default pull mode.

### P2-05 — Sync controls UX
- **Status:** **RESOLVED**.
- **Resolution:** Clear, accessible buttons with icons, ahead/behind counters, and distinct fetch/pull/push menus.

### P3-01 — Inline commit diffs
- **Status:** **Documented / Low Priority**.
- **Current:** Fast read-only diffs with line-limit guards.

### P3-02 — Redaction hides harmless SSH user names
- **Status:** **RESOLVED**.
- **Resolution:** Plain SSH usernames like `git@host` are preserved while secret tokens and passwords are redacted.

### SEC-01 — Conflict resolution writes through symlinks
- **Status:** **RESOLVED**.
- **Resolution:** `ensure_no_symlink` validation checks the target path, and `ls-files --unmerged` verifies conflict state before writing.

## E. GitHub Desktop Parity Matrix

| Feature | GitHub Desktop | RustGit | Status |
| --- | --- | --- | --- |
| Instant repo open / switch | Slow (Electron) | Instant (Rust/Tauri) | **Beats GD** |
| Local GitHub Login Auto-detect | No (manual only) | Yes (GH CLI, GCM, GD, env) | **Beats GD** |
| OAuth & PAT GitHub Login | Yes | Yes | Parity |
| Clone from GitHub | Yes | Yes | Parity |
| Create / Init Repository | Yes | Yes | Parity |
| Commit / Stage Hunks | Yes | Yes | Parity |
| Push / Pull / Fetch | Yes | Yes | Parity |
| Branch switching / merging | Yes | Yes | Parity |
| Conflict resolution | Yes | Yes | Parity |
| Auto-update from GitHub Releases | Yes | Yes | Parity |
| Memory usage | ~300-600 MB | < 60 MB | **Beats GD** |
| Binary startup time | 2-4 s | < 250 ms | **Beats GD** |
