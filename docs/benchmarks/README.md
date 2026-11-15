# Benchmark instructions

`scripts/qa/benchmark-status.ps1` produces reproducible Git-status samples
against a disposable local repository. It never uses a user repository or a
network remote.

Examples:

```powershell
./scripts/qa/benchmark-status.ps1 -Tier Small
./scripts/qa/benchmark-status.ps1 -Tier Medium -Samples 15 -OutputPath .\docs\benchmarks\medium-status.json
```

The tiers are fixture targets, not claims about a production repository:

| Tier | Commits | Files | Samples |
| --- | ---: | ---: | ---: |
| Small | 100 | 100 | 10 |
| Medium | 2,000 | 5,000 | 10 |
| Large | 10,000 | 20,000 | 10 |

Record the script output together with OS, CPU, RAM, Git version, Rust version,
build configuration, commit hash, and whether the machine was otherwise idle.
