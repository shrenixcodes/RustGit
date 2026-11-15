# RustGit backend event contract

Owner: core engineering session. Events are emitted with Tauri's event system
and received with `listen(name, handler)` from `@tauri-apps/api/event`.
Handlers must be removed with the returned unlisten function when the
component unmounts.

**Current state: no events are emitted yet; the events below are DEFINED by contract C-2.** All state reaches the UI through
command responses. Until the events below are IMPLEMENTED, the UI refreshes
status on window focus, after its own mutations (from the returned
`StatusSnapshot`), and on explicit user refresh.

## State invalidation rules (in force now)

| After                                         | Invalidate                          |
| --------------------------------------------- | ----------------------------------- |
| Any staging command (`stage_*`, `unstage_*`, `discard_paths`, `apply_hunk`) | status (replace with response), all `file_diff` and `change_totals` for that repository |
| `create_commit`                               | status (replace), diffs, totals, `last_commit_message`, history (when it exists) |
| `add/init/remove_repository`, `set_repository_pinned`, `open_repository` | `list_repositories` |
| Window regains focus                          | status of the open repository       |
| Branch mutations, merge/rebase/cherry-pick/revert, stash apply, `continue_operation`, `abort_operation` | status, diffs, `list_refs`, `log_page`, `commit_context` |
| `operation-finished` (fetch/pull/push)        | status, `list_refs`, `log_page`; pull also diffs |

## Planned events

### `repository-changed` — DEFINED (C-2)

Emitted for repositories registered with `watch_repository` when the
filesystem watcher (notify) sees changes, debounced 300 ms trailing and at
most one event per 2 s of continuous activity. Includes changes RustGit made
itself (the UI's invalidation is idempotent). `.git/objects`, `.git/logs`
and `*.lock` files are ignored. Linked worktrees: the worktree's own git
directory (index, HEAD) and the common directory (refs, config) are watched.

```ts
interface RepositoryChanged {
  repositoryId: number;
  scopes: ("worktree" | "index" | "refs" | "head" | "config")[];
}
```

The UI invalidates status for `worktree`/`index`/`head`, and branch/history
queries for `refs`/`head`. If watching fails or events overflow, the backend
emits one event with every scope so the UI performs a full refresh.

### `operation-progress` — DEFINED (C-2)

For long-running operations (clone, fetch, pull, push).

```ts
interface OperationProgress {
  operationId: string;
  repositoryId: number | null;
  kind: "clone" | "fetch" | "pull" | "push" | "delete_remote_branch";
  phase: string;            // Git's own phase text, e.g. "Receiving objects"
  /** Only when Git reported counts; never synthesized. */
  progress: { current: number; total: number } | null;
}
```

### `operation-finished` — DEFINED (C-2)

```ts
interface OperationFinished {
  operationId: string;
  repositoryId: number | null;   // for clone: the newly registered repository
  outcome: "succeeded" | "failed" | "cancelled";
  error: CommandError | null;
}
```

Progress values come only from Git's own progress output; the backend never
invents progress. Progress events are throttled to at most 10 per second per
operation. `operation-finished` is emitted exactly once per operation id.
