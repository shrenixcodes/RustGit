# RustGit backend event contract

Owner: core engineering session. Events are emitted with Tauri's event system
and received with `listen(name, handler)` from `@tauri-apps/api/event`.
Handlers must be removed with the returned unlisten function when the
component unmounts.

**Current state: no events are emitted.** All state reaches the UI through
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

## Planned events

### `repository://changed` — NOT STARTED

Emitted when the filesystem watcher (notify, debounced ~250 ms) sees changes
in the working tree or in `.git` refs, index or HEAD that RustGit did not
cause itself.

```ts
interface RepositoryChanged {
  repositoryId: number;
  scopes: ("worktree" | "index" | "refs" | "head" | "config")[];
}
```

The UI invalidates status for `worktree`/`index`/`head`, and branch/history
queries for `refs`/`head`. If watching fails or events overflow, the backend
emits one event with every scope so the UI performs a full refresh.

### `operation://progress` — NOT STARTED

For long-running operations (clone, fetch, pull, push).

```ts
interface OperationProgress {
  operationId: string;
  repositoryId: number | null;
  kind: "clone" | "fetch" | "pull" | "push";
  phase: string;            // Git's own phase text, e.g. "Receiving objects"
  percent: number | null;   // null when Git reports no percentage
}
```

### `operation://finished` — NOT STARTED

```ts
interface OperationFinished {
  operationId: string;
  outcome: "succeeded" | "failed" | "cancelled";
  error: CommandError | null;
}
```

Progress values come only from Git's own progress output; the backend never
invents progress.
