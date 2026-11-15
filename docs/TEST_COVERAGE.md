# Test coverage

## Verified automated coverage

| Component | Coverage | Status |
| --- | --- | --- |
| Git engine | Git version, missing executable, discovery, plain/missing paths, linked worktrees, porcelain-v2 status, unborn branches, credential redaction | PARTIALLY VERIFIED |
| Core services | SQLite migrations, repository registry, settings, command-error mapping, lock semantics | PARTIALLY VERIFIED |
| Frontend | Theme behavior, typed IPC wrapper behavior, sidebar navigation/state, repository UI, changes grouping | PARTIALLY VERIFIED |
| Native Windows | Repository/status/theme smoke path documented in `apps/desktop/tests/native/windows-smoke.mjs` | PARTIALLY VERIFIED locally; BLOCKED in CI |

## Required additions before release

- Real-repository tests for staging, unstage, discard, hunk application, diffs,
  commits and hook failures.
- Local-bare-remote tests for fetch/pull/push and divergence.
- Native UI tests that prove state refresh after every mutation.
- Conflict, stash, worktree, submodule, binary-file and large-file coverage as
  features ship.
- Linux and macOS native smoke verification.
