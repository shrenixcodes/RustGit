# Performance

## Status

**PARTIALLY VERIFIED.** A repeatable status-refresh harness has been executed
once. This is a Git CLI baseline, not a native-application performance claim.
Measurements must be repeated on an otherwise idle machine and recorded with
the build configuration before comparing releases.

## Recorded baseline

| Date | Fixture | Command | Samples (ms) | Mean | P50 | P95 | Environment |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| 2026-11-15 | 100 commits, 100 files, one modified file | `benchmark-status.ps1 -Tier Small -Samples 3` | 76.812, 57.805, 62.713 | 65.777 ms | 62.713 ms | 76.812 ms | Windows 11 10.0.26200; Git 2.54.0.windows.1 |

## Planned measurements

| Workflow | Small | Medium | Large | Stress |
| --- | --- | --- | --- | --- |
| Git status refresh | Ready | Ready | Ready | Pending fixture definition |
| Repository discovery | Pending | Pending | Pending | Pending |
| Diff loading | Pending | Pending | Pending | Pending |
| History/graph | Not implemented | Not implemented | Not implemented | Not implemented |
| Native startup/memory/CPU | Pending native measurement method | Pending | Pending | Pending |

Run `scripts/qa/benchmark-status.ps1 -Tier Small` on an otherwise idle
machine. The script creates a temporary repository, uses a local Git identity,
performs no network operations, and deletes its fixture in `finally`.

See [benchmark instructions](docs/benchmarks/README.md).
