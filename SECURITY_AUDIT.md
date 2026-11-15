# Security audit

Audit date: 2026-11-15  
Scope: committed `main` architecture; uncommitted changes are not release
approved by this audit.

## Findings

| Severity | Status | Area | Finding and recommended action |
| --- | --- | --- | --- |
| Low | OPEN | Application data directory override | `apps/desktop/src-tauri/src/lib.rs` accepts `RUSTGIT_DATA_DIR` for isolated tests and portable use. This is not a privilege boundary because the launcher already acts as the same user, but it can split user state unexpectedly. Document it as an explicit portable/test mode and add a regression test that normal startup uses the platform app-data directory. |
| Medium | OPEN | Sensitive paths in logs | `apps/desktop/src-tauri/src/lib.rs` logs the full database path at `info`; paths can contain personal or customer names. Downgrade/redact this value or make diagnostic logging opt-in. |
| Medium | OPEN | Git executable trust | `GitExecutor::new("git")` resolves through `PATH`. A malicious earlier `git` executable can run with the user’s privileges. Resolve and validate the executable at startup, display its resolved path, and document this trust boundary. |
| Low | OPEN | Dependency scanning | `cargo-audit` and `cargo-deny` are not installed and there is no dependency vulnerability or license gate in CI. Add a pinned advisory/license scan after deciding the project policy. |
| Informational | VERIFIED | Shell injection | `crates/git-engine/src/executor.rs` uses `std::process::Command` with explicit arguments; no shell command construction was found in the audited Rust paths. Keep this invariant and test every new Git command with hostile literal input. |
| Informational | VERIFIED | Credential prompting/log redaction | The executor disables `GIT_TERMINAL_PROMPT` and redacts credential-like URLs in errors/history. Existing integration coverage exercises an unreachable URL containing credentials. |
| Informational | VERIFIED | Tauri permissions | `apps/desktop/src-tauri/capabilities/default.json` grants a narrow command list plus the native open-dialog capability; no broad filesystem or shell capability was found. Re-audit every new command/capability before release. |

## Verification limits

No dependency advisory scan was run because the required scanners are absent.
No penetration test, code-signing review, or platform keychain review was
performed. Passing dependency checks alone would not close the findings above.
