# RustGit IPC API contract

Owner: core engineering session (backend). Consumers: UI session (frontend).

Every command is a Tauri command invoked with `invoke(name, args)`. The
TypeScript mirror of every type lives in `apps/desktop/src/services/types.ts`
and the call wrappers in `apps/desktop/src/services/ipc.ts`. Argument names
are camelCase on the TypeScript side (Tauri converts them).

Contract status values: **IMPLEMENTED** (backend done and tested),
**DEFINED** (interface fixed, backend not built yet; do not call), **CHANGED**
(see change log at the end).

## Conventions

- **Errors.** Every failure rejects with `CommandError`
  `{ kind: ErrorKind, message: string }`. `message` is human-readable, already
  redacted, and includes Git's stderr verbatim when Git failed. Never parse
  `message`; branch on `kind`.
- **Repository identity.** Repository-scoped commands take `id` (or
  `repositoryId`) from `RepositoryEntry.id`, never a path. The backend
  resolves the path from its database.
- **Paths.** File paths are repository-relative with `/` separators, exactly
  as they appear in `FileStatus.path`. Absolute paths and `..` components are
  rejected with `invalid_request`. Paths are treated literally (no glob
  magic).
- **Concurrency.** Reads take a per-repository read lock and may run in
  parallel. Mutations take the per-repository write lock: two mutations on
  the same repository never overlap, and reads wait for a running mutation.
  Different repositories never block each other.
- **Threads.** All Git and SQLite work runs on a blocking thread pool; a slow
  command never blocks the UI thread or other commands.
- **Cancellation.** No command is cancellable yet. All current commands are
  short-lived local operations. Long operations (clone, fetch, pull, push)
  will get an operation id and a `cancel_operation` command; see
  `EVENT_CONTRACT.md`.
- **Mutations return fresh state.** Mutating repository commands return the
  `StatusSnapshot` read *after* the mutation under the same lock, so the UI
  can replace its cached status without another round trip.

### ErrorKind

| kind                      | Meaning                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `git_not_found`           | Git executable missing                                          |
| `not_a_repository`        | Path is not inside a Git repository (moved/deleted)             |
| `invalid_path`            | Path missing or not a directory                                 |
| `invalid_request`         | Arguments rejected before running Git (bad path, empty list...) |
| `stale_diff`              | The hunk the UI referred to no longer exists; re-fetch the diff |
| `git_command_failed`      | Git exited non-zero; `message` contains its stderr              |
| `git_output_unrecognized` | Git output could not be parsed                                  |
| `repository_not_found`    | Repository id not registered                                    |
| `database`                | Local database failure                                          |
| `internal`                | Unexpected failure (task panic, I/O)                            |

`invalid_request` and `stale_diff` are introduced with the staging contract
(change C-1).

## System

### `git_info` — IMPLEMENTED

`() -> GitInfo { version: string, executable: string }`
Errors: `git_not_found`.

### `get_settings` — IMPLEMENTED

`() -> Settings { theme: "system" | "light" | "dark" }`. Invalid stored values
fall back to defaults.

### `set_theme` — IMPLEMENTED

`({ theme }) -> Settings`.

### `command_history` — IMPLEMENTED (amended by C-2, see below)

`() -> CommandRecord[]`, oldest first, at most 200 entries, process lifetime
only (not persisted).

```ts
interface CommandRecord {
  args: string[];        // credentials in URLs replaced by ***
  cwd: string;
  durationMs: number;
  exitCode: number | null; // null if killed by a signal
  stderr: string;          // redacted
}
```

## Repositories

### `list_repositories` — IMPLEMENTED

`() -> RepositoryEntry[]` ordered pinned first, then most recently opened,
then name.

```ts
interface RepositoryEntry {
  id: number; path: string; name: string; pinned: boolean;
  addedAt: number;            // unix seconds
  lastOpenedAt: number | null;
}
```

### `add_repository` — IMPLEMENTED

`({ path }) -> RepositoryEntry`. `path` may be any directory inside the
working tree; the repository root is registered. Idempotent per root.
Linked worktrees (`.git` file) are supported.
Errors: `invalid_path`, `not_a_repository`, `git_not_found`.

### `init_repository` — IMPLEMENTED

`({ path }) -> RepositoryEntry`. Creates the directory if needed and runs
`git init --initial-branch=main`.

### `open_repository` — IMPLEMENTED

`({ id }) -> RepositoryEntry`. Re-validates the repository on disk and updates
`lastOpenedAt`. Errors: `repository_not_found`, `not_a_repository`,
`invalid_path`.

### `set_repository_pinned` — IMPLEMENTED

`({ id, pinned }) -> RepositoryEntry`.

### `remove_repository` — IMPLEMENTED

`({ id }) -> void`. Forgets the repository. **Never touches files on disk.**

### `repository_status` — IMPLEMENTED (read; `StatusSnapshot.inProgress` added by C-2)

`({ id }) -> StatusSnapshot` from
`git status --porcelain=v2 --branch -z --untracked-files=all`.

```ts
type ChangeKind = "modified" | "type_changed" | "added" | "deleted"
  | "renamed" | "copied" | "untracked" | "unmerged";
interface FileStatus {
  path: string;
  originalPath: string | null;   // renames/copies
  staged: ChangeKind | null;     // index vs HEAD; null = clean
  unstaged: ChangeKind | null;   // worktree vs index; "untracked" for new files
  conflicted: boolean;
}
interface BranchStatus {
  head: string | null;     // null = detached HEAD
  oid: string | null;      // null = no commits yet
  upstream: string | null;
  ahead: number; behind: number;
}
interface StatusSnapshot { branch: BranchStatus; files: FileStatus[] }
```

A partially staged file is one entry with both `staged` and `unstaged` set.

## Changes and staging — IMPLEMENTED (change C-1)

All staging commands are mutations (write lock) and return the new
`StatusSnapshot`.

### `stage_paths` / `unstage_paths`

`({ id, paths: string[] }) -> StatusSnapshot`

- `stage_paths` runs `git add --all` for the paths (stages modifications,
  additions and deletions).
- `unstage_paths` runs `git restore --staged` (or `git rm --cached` before the
  first commit).
- Paths are passed to Git through stdin, so the list may be arbitrarily long.
- Errors: `invalid_request` (empty list, absolute path, `..`),
  `git_command_failed`.

### `stage_all` / `unstage_all`

`({ id }) -> StatusSnapshot`. Equivalent to the above for every changed path.

### `discard_paths` — destructive

`({ id, paths: string[] }) -> StatusSnapshot`

Discards **unstaged** changes only: tracked files are restored from the index
(`git restore --worktree`); untracked files are deleted (`git clean -f`).
Staged changes are never touched. The UI must confirm before calling.

### `file_diff` (read) — amended by C-2 (`contextLines`)

`({ id, path, originalPath?, side, ignoreWhitespace }) -> FileDiff`

- `side: "staged" | "unstaged"`. Staged = index vs HEAD; unstaged = worktree
  vs index. Untracked files (side `unstaged`) are diffed against an empty
  file, so every line is an addition.
- `ignoreWhitespace: true` passes `-w`. **Hunks from a whitespace-ignoring
  diff cannot be staged**; partial staging always uses a normal diff.
- Large or binary files return no hunks.

```ts
type DiffLineKind = "context" | "add" | "delete";
interface DiffLine {
  kind: DiffLineKind;
  oldLine: number | null;     // null for additions
  newLine: number | null;     // null for deletions
  content: string;            // without the leading +/-/space
  noNewlineAtEnd: boolean;    // "\ No newline at end of file" followed
}
interface DiffHunk {
  header: string;             // full "@@ -a,b +c,d @@ section" line; hunk identity
  oldStart: number; oldLines: number;
  newStart: number; newLines: number;
  lines: DiffLine[];
}
interface FileDiff {
  path: string;
  originalPath: string | null;
  side: "staged" | "unstaged";
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  binary: boolean;
  tooLarge: boolean;          // > 2 MiB of diff text or > 20 000 lines
  hunks: DiffHunk[];          // empty when binary or tooLarge
  added: number; deleted: number;
}
```

### `apply_hunk` — partial staging, unstaging and discarding (amended by C-2)

`({ id, path, side, action, hunkHeader, lineIndices? }) -> StatusSnapshot`

- `action`: `"stage"` (requires `side: "unstaged"`), `"unstage"` (requires
  `side: "staged"`), `"discard"` (requires `side: "unstaged"`; destructive,
  confirm first).
- `hunkHeader` identifies the hunk (exact `DiffHunk.header`). The backend
  recomputes the diff and fails with `stale_diff` if the hunk is gone or
  changed; the UI should then re-fetch the diff.
- `lineIndices` (optional) are indices into `DiffHunk.lines` of `add`/`delete`
  lines to apply; omitted = the whole hunk. Context indices are rejected with
  `invalid_request`.
- Line selection is only supported for modified files. Untracked, added,
  deleted and binary files return `invalid_request` for line selections;
  use whole-hunk or `stage_paths`.
- Implementation: a patch is rebuilt from the current diff and applied with
  `git apply --cached` (stage), `git apply --cached --reverse` (unstage) or
  `git apply --reverse` (discard). Git validates it; nothing is written if it
  does not apply.

### `change_totals` (read)

`({ id, side }) -> ChangeTotals` from `git diff [--cached] --numstat`.

```ts
interface FileTotals { path: string; added: number | null; deleted: number | null } // null = binary
interface ChangeTotals { files: FileTotals[]; added: number; deleted: number }
```

Untracked files are not included (Git has no numstat for them).

## Commits — IMPLEMENTED (change C-1)

### `author_identity` (read) — REMOVED by C-2, use `commit_context`

`({ id }) -> { name: string | null, email: string | null }` from the effective
`git config` for that repository. Both must be non-null to commit.

### `last_commit_message` (read) — REMOVED by C-2, use `commit_context`

`({ id }) -> string | null` — full message of `HEAD`, `null` before the first
commit. Used to prefill amend.

### `create_commit`

`({ id, message, amend }) -> CommitResult`

```ts
interface CommitResult { oid: string; summary: string; status: StatusSnapshot }
```

- Commits the index only (`git commit -F -`, message through stdin, default
  cleanup). Hooks run normally; signing follows the user's Git config.
- `amend: true` adds `--amend`; an empty index is allowed (message-only amend).
- Failures (empty message, nothing staged, hook rejection, signing failure)
  return `git_command_failed` with Git's stderr and exit code in `message`.
  Nothing is retried and the message is not lost: the UI keeps its fields.

## Contract C-2 — IMPLEMENTED

C-2 answers the UI session's requests R-1 … R-14 (filed on branch
`worktree-ui-orbital`, `docs/integration/INTEGRATION_STATUS.md`). Shapes
follow the requests unless a difference is called out. Mapping:

| Request | Answered by |
| ------- | ----------- |
| R-1 command history | `command_history` (amended) |
| R-2 file diff | `file_diff` (C-1) + `contextLines` |
| R-3 stage/unstage paths | `stage_paths`, `unstage_paths` (C-1) |
| R-4 partial staging | `apply_hunk` (C-1, one hunk per call) + `contextLines` |
| R-5 discard paths | `discard_paths` (C-1) |
| R-6 commit identity and HEAD | `commit_context` |
| R-7 create commit | `create_commit` (C-1) + typed pre-check errors |
| R-8 paged log | `log_page` |
| R-9 references | `list_refs` |
| R-10 commit details | `commit_details`, `commit_file_diff` |
| R-11 branch operations | `create_branch`, `checkout_branch`, `rename_branch`, `delete_branch`, `set_upstream`, `merge_branch` |
| R-12 repository-changed | `watch_repository`, `unwatch_repository`, event `repository-changed` |
| R-13 network operations | `start_fetch`, `start_pull`, `start_push`, `start_clone`, `cancel_operation`, events `operation-progress`, `operation-finished` |
| R-14 conflicts | `conflict_versions`, `resolve_conflict`, `continue_operation`, `skip_operation`, `abort_operation` |

Not requested but in the master specification and UI-independent:
`rebase_branch`, `cherry_pick`, `revert_commit`, remotes management, stash
and worktree commands (below).

### Global changes

- **Locale.** Git runs with `LC_ALL=C` so its messages are stable English
  and can be classified into error kinds. Paths and commit text are not
  affected (`-z`, `core.quotepath=false`).
- **New error kinds:** `nothing_to_commit`, `identity_missing`,
  `would_overwrite_changes`, `branch_not_fully_merged`, `branch_exists`,
  `invalid_ref_name`, `operation_in_progress`, `operation_cancelled`,
  `authentication_failed`. Requested `hook_failed` is **not** provided: Git
  does not report reliably that a hook (rather than Git) failed. Hook
  failures arrive as `git_command_failed` with the hook output in `message`.
- **`CommandError.details`** (optional): `{ exitCode: number | null; paths:
  string[] }`. `exitCode` is set for `git_command_failed`; `paths` lists the
  files for `would_overwrite_changes`.
- **`StatusSnapshot.inProgress`**:
  `"none" | "merging" | "rebasing" | "cherry_picking" | "reverting"`.

### `command_history` (amended)

`({ repositoryId?: number | null, sinceSequence?: number | null }) -> CommandRecord[]`

Adds `sequence` (monotonic per process), `startedAt` (unix ms) and
`repositoryId` (registered repository whose root contains `cwd`, else null)
to `CommandRecord`. Filters are optional; both absent returns the full
buffer (200 newest).

### `file_diff`, `apply_hunk` (amended)

Optional `contextLines` (0 … 20, default 3). `apply_hunk` must receive the
same `contextLines` as the diff the hunk came from, otherwise headers differ
and it returns `stale_diff`.

Answers to R-4's open questions: line selection on untracked files is
rejected with `invalid_request` (whole-file staging only; no `git add -N`).
Hunks from whitespace-ignoring diffs are rejected with `stale_diff`. Kept
from C-1 (differs from R-2/R-4): hunk identity is the header string, not a
`diffId`; one hunk per call; line kinds are `add`/`delete`/`context` with a
`noNewlineAtEnd` flag instead of a `no_newline` line; size limit 2 MiB /
20 000 lines via `tooLarge`.

### `commit_context` (read; replaces `author_identity`, `last_commit_message`)

`({ id }) -> CommitContext`

```ts
interface CommitContext {
  authorName: string | null;
  authorEmail: string | null;
  signing: "off" | "gpg" | "ssh" | "x509";   // commit.gpgSign + gpg.format
  head: null | {
    oid: string; summary: string;
    message: string;                // full message (R-6 asked summary+body)
    onUpstream: boolean | null;     // HEAD reachable from upstream; null = no upstream
  };
  inProgress: InProgress;           // same values as StatusSnapshot.inProgress
}
```

### `create_commit` (amended)

Unchanged signature `({ id, message, amend })`. Pre-checks before Git runs:
`identity_missing` when name or email is unset; `nothing_to_commit` when
nothing is staged, `amend` is false and no merge is in progress.

### History

#### `log_page` (read)

`({ id, revisions?: string[] | null, skip, limit, search?, since?, until? }) -> LogPage`

```ts
interface LogSearch { text: string; field: "message" | "author" | "sha" }
interface LogCommit {
  oid: string; parents: string[];      // first parent first
  summary: string;
  authorName: string; authorEmail: string;
  authorTime: number; committerTime: number;   // unix seconds
}
interface LogPage { commits: LogCommit[]; hasMore: boolean }
```

- `revisions: null` walks `HEAD`, all branches, remote branches and tags.
- Order: `--topo-order` (children before parents), stable across pages for
  the same arguments.
- `limit` 1 … 2000. `search.field: "sha"` matches a commit id prefix
  (4–64 hex chars) among the walked commits; message/author searches are
  case-insensitive fixed strings.
- An unborn branch returns an empty page.

#### `commit_details` (read)

`({ id, oid }) -> CommitDetails`

```ts
interface CommitDetails {
  oid: string; parents: string[];
  authorName: string; authorEmail: string; authorTime: number;
  committerName: string; committerEmail: string; committerTime: number;
  message: string;
  files: Array<{ path: string; originalPath: string | null; kind: ChangeKind;
                 additions: number | null; deletions: number | null }>;
}
```

Files are compared with the first parent (merges) or the empty tree (root
commit).

#### `commit_file_diff` (read)

`({ id, oid, path, originalPath?, contextLines? }) -> FileDiff` with
`side: "commit"` (new `DiffSide` value, never accepted by `file_diff` or
`apply_hunk`).

### References and branches

#### `list_refs` (read)

`({ id }) -> RefList`

```ts
type HeadState = { kind: "branch"; name: string }
  | { kind: "detached"; oid: string } | { kind: "unborn"; name: string };
interface RefEntry {
  fullName: string; shortName: string;
  kind: "local" | "remote" | "tag";
  oid: string;                 // peeled commit for annotated tags
  upstream: string | null;     // local branches
  ahead: number | null; behind: number | null;
  upstreamGone: boolean;
  lastCommitTime: number; lastCommitSummary: string;
}
interface RefList { head: HeadState; refs: RefEntry[] }
```

Remote `HEAD` symbolic refs (`origin/HEAD`) are omitted.

#### Branch mutations (write lock)

| Command | Arguments | Returns |
| ------- | --------- | ------- |
| `create_branch` | `{ id, name, startPoint: string \| null, checkout: boolean }` | `RefList` |
| `checkout_branch` | `{ id, name, mode: "keep_changes" \| "abort_if_dirty" }` | `StatusSnapshot` |
| `rename_branch` | `{ id, from, to }` | `RefList` |
| `delete_branch` | `{ id, name, force: boolean }` | `RefList` |
| `set_upstream` | `{ id, branch, upstream: string \| null }` | `RefList` |

- Names are validated with `git check-ref-format --branch`
  (`invalid_ref_name`); existing names give `branch_exists`.
- `checkout_branch` with `keep_changes` uses `git switch` (local changes
  carried over when Git can); if Git refuses, `would_overwrite_changes` with
  `details.paths`. `abort_if_dirty` fails with `would_overwrite_changes`
  (empty paths) when any tracked change exists. `name` may be a remote
  branch (`origin/x`): a local tracking branch `x` is created. Changes are
  never discarded.
- `delete_branch` without `force` uses `git branch -d`; an unmerged branch
  gives `branch_not_fully_merged`. `force` uses `-D` (UI confirms).

#### Merge, rebase, cherry-pick, revert (write lock)

```ts
interface IntegrationResult {
  outcome: "up_to_date" | "fast_forward" | "completed" | "conflicts";
  conflicted: string[];        // paths with conflicts
  status: StatusSnapshot;
}
```

| Command | Arguments |
| ------- | --------- |
| `merge_branch` | `{ id, source, strategy: "default" \| "no_ff" \| "ff_only" }` |
| `rebase_branch` | `{ id, onto }` (non-interactive) |
| `cherry_pick` | `{ id, oids: string[] }` |
| `revert_commit` | `{ id, oid }` |
| `continue_operation` | `{ id }` — continues the in-progress merge/rebase/cherry-pick/revert |
| `skip_operation` | `{ id }` — skips the current step of a rebase/cherry-pick/revert (`invalid_request` during a merge) |
| `abort_operation` | `{ id }` — aborts it and restores the pre-operation state |

Conflicts are an outcome, not an error. Starting any of these while another
is in progress gives `operation_in_progress`. Commit messages use Git's
defaults (no editor is opened).

#### Conflicts

`conflict_versions({ id, path }) -> ConflictVersions` (read)

```ts
interface ConflictVersions {
  base: string | null; ours: string | null; theirs: string | null;  // stages 1–3
  working: string;                  // file content with markers
  oursLabel: string; theirsLabel: string;
  binary: boolean;                  // contents are null/empty when binary
}
```

During a rebase Git's "ours" is the branch being rebased onto and "theirs"
is the commit being replayed; the labels state this.

`resolve_conflict({ id, path, content: string | null, take: "ours" | "theirs" | null }) -> StatusSnapshot`
Exactly one of `content` / `take`. Writes the file (or checks out the side),
then `git add`. Taking a side that deleted the file removes it with `git rm`
instead. Fails with `git_command_failed` if the path is still unmerged
afterwards.

### Remotes and network operations

#### Remote configuration (write lock except `list_remotes`)

| Command | Arguments | Returns |
| ------- | --------- | ------- |
| `list_remotes` | `{ id }` | `Remote[]` |
| `add_remote` | `{ id, name, url }` | `Remote[]` |
| `set_remote_url` | `{ id, name, url, push: boolean }` | `Remote[]` |
| `remove_remote` | `{ id, name }` | `Remote[]` |

`interface Remote { name: string; fetchUrl: string | null; pushUrl: string | null }`
URLs are returned with credentials redacted.

#### Long-running operations

Each returns `{ operationId: string }` immediately; the work continues in the
background and reports through `operation-progress` and
`operation-finished` (see `EVENT_CONTRACT.md`).

| Command | Arguments | Cancellable |
| ------- | --------- | ----------- |
| `start_fetch` | `{ id, remote: string \| null, prune: boolean, background?: boolean }` (`null` = all remotes; `background` never prompts for credentials) | yes |
| `start_pull` | `{ id, mode: "ff_only" \| "merge" \| "rebase" }` | fetch phase only (afterwards `cancel_operation` returns `false`) |
| `start_push` | `{ id, remote: string \| null, branch: string \| null, setUpstream: boolean, forceWithLease: boolean }` | no |
| `start_delete_remote_branch` | `{ id, remote, branch }` | no |
| `start_clone` | `{ url, parentDirectory, directoryName: string \| null }` | yes |
| `cancel_operation` | `{ operationId }` -> `boolean` (false if not running or not cancellable now) | — |

- Locking (refined during implementation): fetch, push and remote branch
  deletion only update refs and hold the **read** lock, so status and other
  reads continue while mutations wait. Pull holds the read lock for its
  fetch phase and takes the **write** lock only to integrate; it refuses to
  integrate if a different branch was checked out in between.
- Push never uses plain `--force`; `forceWithLease` passes
  `--force-with-lease` (UI confirms).
- `start_clone` registers the new repository; its `operation-finished` event
  carries `repositoryId`.
- Credentials: Git's configured credential helper is used; RustGit never sees
  or stores secrets and never prompts in a terminal. Failures give
  `authentication_failed`.
- The window must hold `core:event:default` to `listen` to these events;
  it is granted in `capabilities/default.json`.
- `operation-finished` for a pull does not carry the integration result;
  the UI refreshes status (conflicts appear as `inProgress` and conflicted
  files). A pull that stops with conflicts finishes as `failed` with
  `operation_in_progress`, so it is never reported as done.
- Cancelling kills the Git process tree (remote helpers and ssh included); Git leaves no partial refs for fetch or
  clone (a cancelled clone's directory is removed). Push is not cancellable
  because the remote may already have accepted it.

### Stash (write lock except reads)

| Command | Arguments | Returns |
| ------- | --------- | ------- |
| `list_stashes` | `{ id }` | `StashEntry[]` |
| `create_stash` | `{ id, message: string \| null, includeUntracked: boolean }` | `StatusSnapshot` |
| `apply_stash` | `{ id, oid, pop: boolean }` | `IntegrationResult` |
| `drop_stash` | `{ id, oid }` | `StashEntry[]` |
| `stash_details` | `{ id, oid }` | `{ files: Array<{ path, kind: ChangeKind, untracked: boolean }> }` |
| `stash_file_diff` | `{ id, oid, path, contextLines? }` | `FileDiff` (`side: "commit"`) |

`interface StashEntry { index: number; oid: string; message: string; createdAt: number }`
Stashes are identified by `oid`; the backend resolves the current
`stash@{n}` and fails with `stale_diff` if the stash no longer exists.
`drop_stash` is destructive (UI confirms).

### Worktrees

| Command | Arguments | Returns |
| ------- | --------- | ------- |
| `list_worktrees` | `{ id }` | `Worktree[]` |
| `add_worktree` | `{ id, path, branch: string \| null, newBranch: string \| null, commit: string \| null }` | `Worktree[]` |
| `remove_worktree` | `{ id, path, force: boolean }` | `Worktree[]` |
| `prune_worktrees` | `{ id }` | `Worktree[]` |

```ts
interface Worktree {
  path: string; head: string | null; branch: string | null;
  isMain: boolean; detached: boolean; bare: boolean;
  locked: string | null;     // lock reason ("" if locked without reason)
  prunable: string | null;   // reason when the worktree directory is gone
}
```

`remove_worktree` without `force` refuses a worktree with changes
(`git_command_failed`); `force` discards them (UI confirms). Removing never
deletes the main worktree.

### Filesystem watching

`watch_repository({ id })` / `unwatch_repository({ id })` -> `void`. The UI
watches the open repository; at most 8 repositories are watched at once
(oldest dropped). Events: `repository-changed` (`EVENT_CONTRACT.md`).

## Change log

- **C-1 (2026-11-15).** Added the staging, diff and commit contracts, and the
  `invalid_request` and `stale_diff` error kinds. No existing command
  changed. Implemented in `6fa0900` (engine) and `c510fc0` (IPC); verified
  through the real WebView IPC by the native smoke test (`b9f3a5e`).

- **C-2 (2026-11-15).** Answers UI requests R-1 … R-14. Changes to C-1
  (no caller existed yet): `command_history` gains filters and
  `sequence`/`startedAt`/`repositoryId`; `file_diff`/`apply_hunk` gain
  `contextLines`; `author_identity` and `last_commit_message` are replaced
  by `commit_context`; `create_commit` gains typed pre-check errors;
  `StatusSnapshot` gains `inProgress`; `DiffSide` gains `"commit"` (output
  only); `CommandError` gains optional `details`. Events renamed to the UI
  session's names. Everything else in C-2 is new. Implemented in
  `969f594`, `7921b64`, `a97525b`, `1116a0c`, `20e9b00`, `0d79e94`,
  `2dd7adc`; verified natively in `73504d1`.

## Known limitations of C-1

- Partial (line) staging rebuilds patches from UTF-8-decoded diff text. For
  files that are not valid UTF-8 the rebuilt patch will not apply; Git
  rejects it and `git_command_failed` is returned. Nothing is written.
- A diff is read fully into memory before the size limit is checked.
- With `ignoreWhitespace: true`, hunk headers differ from the normal diff;
  `apply_hunk` with such a header returns `stale_diff`.
