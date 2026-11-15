# Quality assurance report

Audit date: 2026-11-15  
Scope: `main` through `8a7621d`.

## Current architecture assessment

**PARTIALLY VERIFIED.** RustGit is a Tauri 2 desktop application with a React
frontend, a Rust application shell, a SQLite-backed repository registry, and a
Git CLI engine. Git commands are spawned with explicit argument vectors and a
repository-specific current directory. The committed product supports
repository discovery/registration, status, staging/unstaging, diff generation,
partial staging, commits, and theme persistence. History, branches, remotes,
conflict resolution, stashes, worktrees, and GitHub integration are not built.

## Evidence collected

| Area | Status | Evidence |
| --- | --- | --- |
| Repository discovery/status | PARTIALLY VERIFIED | Existing integration tests use `tempfile` repositories and the Git CLI. |
| Linked worktree discovery | PARTIALLY VERIFIED | `crates/git-engine/tests/repository.rs` covers a linked worktree. |
| Frontend unit tests | PARTIALLY VERIFIED | Tests cover sidebar state, themes, IPC wrappers, change grouping, and repository UI. |
| Native Windows flow | PARTIALLY VERIFIED | A local native smoke script is present; its documented CI execution remains blocked. |
| Staging/diff/commit engine | PARTIALLY VERIFIED | Committed real-repository tests and a project-recorded native IPC smoke run cover the C-1 contract; an independent full Rust run is blocked by the local linker configuration. |
| Full local Rust quality baseline | BLOCKED | An isolated retry selected an incompatible `D:\bin\dlltool.exe`; the configured replacement is inaccessible in this environment. |
| Linux/macOS native behavior | NOT TESTED | No native smoke harness exists for these platforms. |

## Test coverage gaps

The committed C-1 suite exercises staging/unstaging, partial staging,
discarding, diffs, commits, path validation, stale-hunk rejection and hook
failure against temporary repositories. Its latest result still requires an
independent clean-environment run. UI tests remain component-level; the native
smoke test invokes C-1 commands through the WebView IPC boundary but no
end-user staging/diff/commit UI is merged on `main`.

## Prioritized QA work

1. Independently execute the committed staging/diff/commit suite from a clean
   Windows toolchain, then on the CI target matrix.
2. Add UI-driven native smoke coverage for staging and commits once the frontend exposes
   those operations.
3. Add controlled local-bare-remote tests for fetch, push, divergence, and
   force-with-lease refusal.
4. Resolve the Windows CI WebView2 DevTools connection issue; add platform
   native verification plans for Linux and macOS.
5. Record repeatable performance baselines using
   `scripts/qa/benchmark-status.ps1`.
