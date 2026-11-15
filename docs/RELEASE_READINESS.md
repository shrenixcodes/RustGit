# Release readiness

## Recommendation: NO-GO

The committed application is not feature-complete for the intended Git client
workflow, and high-severity release requirements remain unverified.

| Gate | Status | Evidence |
| --- | --- | --- |
| Repository discovery and status | PARTIALLY VERIFIED | Disposable-repository tests and documented local native smoke test. |
| Staging, commits, branches, remotes, conflict recovery | NOT VERIFIED | Features are absent from committed `main` or currently uncommitted. |
| Data integrity regression suite | NOT VERIFIED | No verified tests for mutations, conflict recovery, or remote synchronization. |
| Tauri frontend/backend integration | PARTIALLY VERIFIED | Repository/status/theme only; Windows CI native smoke is blocked. |
| Security | FAILED | Open high-severity data-directory override finding and medium-severity trust/logging findings. |
| Performance | NOT TESTED | Harness exists; no figures recorded. |
| Windows native verification | PARTIALLY VERIFIED | Local evidence only; CI path blocked. |
| Linux/macOS native verification | NOT TESTED | No evidence. |
| Installer and upgrade | NOT TESTED | No verification evidence. |

Release approval requires closing or formally accepting each security finding,
passing the full quality suite from a clean checkout, native verification on
each claimed platform, and evidence for the user-facing Git workflows.
