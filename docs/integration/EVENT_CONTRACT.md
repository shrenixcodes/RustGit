# RustGit event contract

**Owner:** core engineering session. Created by the UI session.

## Implemented events

None. The UI refreshes repository status on window focus, after its own
mutations, and on explicit Refresh (`Ctrl+R`/`F5`). It never polls.

## Requested events

### E-1 `repository-changed` (priority P1, request R-12)

Emitted after filesystem changes in a registered, currently open repository,
debounced (proposal: 300 ms trailing, max 2 s).

```ts
interface RepositoryChangedEvent {
  repositoryId: number;
  /** Which areas changed, so the UI invalidates only what is affected. */
  scopes: Array<"worktree" | "index" | "refs" | "head" | "config">;
}
```

UI reaction: invalidate `["repositories", id, "status"]` for
`worktree|index|head`; diffs for `worktree|index`; log and refs for
`refs|head`.

Edge cases the watcher should handle: `.git/index.lock` churn during
RustGit's own operations (suppress or coalesce), linked worktrees (watch the
worktree's own git dir for `index`/`HEAD` and the common dir for `refs`),
very large trees (ignore paths Git ignores).

### E-2 `operation-progress` (priority P2, request R-13)

For long-running network operations (clone, fetch, pull, push).

```ts
interface OperationProgressEvent {
  operationId: string;          // returned by the command that started it
  repositoryId: number | null;  // null for clone before registration
  kind: "clone" | "fetch" | "pull" | "push";
  phase: string;                // Git's own phase text, e.g. "Receiving objects"
  /** Only when Git reported counts; never synthesized. */
  progress: { current: number; total: number } | null;
}
```

### E-3 `operation-finished` (priority P2, request R-13)

```ts
interface OperationFinishedEvent {
  operationId: string;
  repositoryId: number | null;
  outcome: "succeeded" | "failed" | "cancelled";
  error: { kind: string; message: string } | null;
}
```
