# Regression log

| ID | Date | Status | Area | Reproduction | Required regression coverage |
| --- | --- | --- | --- | --- | --- |
| R-001 | 2026-11-15 | OPEN | Native Windows CI | GitHub `windows-latest` starts the application but WebView2 DevTools does not open within 60 seconds. | Preserve the existing smoke script; add a minimal runner diagnostic test once the root cause is known. |
| R-002 | 2026-11-15 | OPEN | Shared build output | Concurrent local work can block Cargo quality commands on the shared target directory. | Run release checks in a clean worktree or set an isolated `CARGO_TARGET_DIR`; record complete output. |

No fixed production defect is marked verified in this log yet.
