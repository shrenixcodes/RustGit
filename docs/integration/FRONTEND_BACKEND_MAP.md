# Frontend ↔ backend map

Which backend contract each UI surface depends on. UI behavior is specified
by the UI session in `docs/INTERACTION_SPEC.md` (UI branch); this file only
records the dependencies. Contract details: `API_CONTRACT.md`.

| UI surface                        | Commands / events                                                   | Contract status |
| --------------------------------- | ------------------------------------------------------------------- | --------------- |
| Repository list, add, create      | `list_repositories`, `add_repository`, `init_repository`, `set_repository_pinned`, `remove_repository` | IMPLEMENTED |
| Open repository                   | `open_repository`                                                   | IMPLEMENTED     |
| Overview / operation shelf status | `repository_status`                                                 | IMPLEMENTED     |
| Settings: theme, Git info         | `get_settings`, `set_theme`, `git_info`                             | IMPLEMENTED     |
| Changes file list                 | `repository_status`                                                 | IMPLEMENTED     |
| Stage / unstage file, group       | `stage_paths`, `unstage_paths`, `stage_all`, `unstage_all`          | IMPLEMENTED     |
| Discard file (confirm dialog)     | `discard_paths`                                                     | IMPLEMENTED     |
| Diff panel (staged / not staged)  | `file_diff`                                                         | IMPLEMENTED     |
| Stage / unstage / discard hunk or lines | `apply_hunk`                                                  | IMPLEMENTED     |
| Commit composer totals            | `change_totals` (`side: "staged"`)                                  | IMPLEMENTED     |
| Commit composer author line, signing, amend prefill, published-HEAD warning | `commit_context`               | IMPLEMENTED     |
| Commit / amend                    | `create_commit`                                                     | IMPLEMENTED     |
| Activity panel (command log)      | `command_history`                                                   | IMPLEMENTED     |
| Automatic refresh                 | `watch_repository`, `unwatch_repository`, event `repository-changed` | IMPLEMENTED    |
| History graph and log search      | `log_page`, `list_refs` (labels)                                    | IMPLEMENTED     |
| Commit inspector                  | `commit_details`, `commit_file_diff`                                | IMPLEMENTED     |
| Branches workspace                | `list_refs`, `create_branch`, `checkout_branch`, `rename_branch`, `delete_branch`, `set_upstream` | IMPLEMENTED |
| Merge / rebase / cherry-pick / revert | `merge_branch`, `rebase_branch`, `cherry_pick`, `revert_commit`, `continue_operation`, `abort_operation` | IMPLEMENTED |
| Conflict workspace                | `conflict_versions`, `resolve_conflict`                             | IMPLEMENTED     |
| Remotes                           | `list_remotes`, `add_remote`, `set_remote_url`, `remove_remote`     | IMPLEMENTED     |
| Fetch / pull / push / clone, operation shelf | `start_*`, `cancel_operation`, events `operation-progress`, `operation-finished` | IMPLEMENTED |
| Stashes                           | `list_stashes`, `create_stash`, `apply_stash`, `drop_stash`, `stash_details`, `stash_file_diff` | IMPLEMENTED |
| Worktrees                         | `list_worktrees`, `add_worktree`, `remove_worktree`, `prune_worktrees` | IMPLEMENTED  |
| Pull requests, GitHub account     | none                                                                | BLOCKED (see INTEGRATION_STATUS) |

## Requests from the UI session

Requirements read from the UI session's `docs/INTERACTION_SPEC.md` and
`docs/UX_DECISIONS.md` (uncommitted in its worktree on 2026-11-15) and
answered by contracts C-1 and C-2 (request-by-request mapping in
`API_CONTRACT.md`, section "Contract C-2"):

- Staged and not-staged diff sections per file → `file_diff` with `side`.
- Hunk and line staging/unstaging/discarding → `apply_hunk`.
- Untracked files shown as additions; staging a hunk of an untracked file
  stages the whole file → `file_diff` treats untracked as all-added;
  `apply_hunk` on untracked files stages the whole file only when
  `lineIndices` is omitted.
- Binary and oversized detection (2 MB / 20 000 lines) → `FileDiff.binary`,
  `FileDiff.tooLarge`.
- "N files staged · +a −d" → `change_totals`.
- Missing identity disables commit → `author_identity`.
- Hook failure shows stderr verbatim with exit code → `create_commit` errors.
- Activity panel with arguments, cwd, duration, exit code, stderr →
  `command_history`.
