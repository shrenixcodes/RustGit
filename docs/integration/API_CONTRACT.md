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

### `command_history` — DEFINED

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

### `repository_status` — IMPLEMENTED (read)

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

## Changes and staging — DEFINED (change C-1)

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

### `file_diff` (read)

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

### `apply_hunk` — partial staging, unstaging and discarding

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

## Commits — DEFINED (change C-1)

### `author_identity` (read)

`({ id }) -> { name: string | null, email: string | null }` from the effective
`git config` for that repository. Both must be non-null to commit.

### `last_commit_message` (read)

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

## Change log

- **C-1 (2026-11-15).** Added the staging, diff and commit contracts, and the
  `invalid_request` and `stale_diff` error kinds. No existing command
  changed.
