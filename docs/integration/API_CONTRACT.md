# RustGit IPC API contract

**Owner:** core engineering session (backend). The UI session wrote this file
from the source at `origin/main` `f967219` because it did not exist yet. If
anything here disagrees with the Rust code, the Rust code wins: please
correct this file and note the change in `INTEGRATION_STATUS.md`.

Frontend wrappers: `apps/desktop/src/services/ipc.ts`.
Frontend types: `apps/desktop/src/services/types.ts`.

## Conventions

- Commands are invoked with `invoke(name, args)`; argument keys are
  camelCase (Tauri converts to snake_case Rust parameters).
- Responses are serde-serialized with `rename_all = "camelCase"`; enums are
  `snake_case` unless noted.
- Every failure rejects with `CommandError { kind: ErrorKind, message: string }`.
- Every command must be listed in `src-tauri/build.rs` `COMMANDS` and granted
  in `capabilities/default.json` as `allow-<kebab-name>`.
- Repository-scoped reads take the per-repository read lock; mutations must
  take the write lock (`RepositoryLocks`).

### ErrorKind (`crates/core/src/error.rs`)

`git_not_found` · `not_a_repository` · `invalid_path` · `git_command_failed` ·
`git_output_unrecognized` · `repository_not_found` · `database` · `internal`

## Implemented commands

| Command                 | Args                          | Returns            | Lock  |
| ----------------------- | ----------------------------- | ------------------ | ----- |
| `git_info`              | —                             | `GitInfo`          | —     |
| `get_settings`          | —                             | `Settings`         | —     |
| `set_theme`             | `{ theme: ThemePreference }`  | `Settings`         | —     |
| `list_repositories`     | —                             | `RepositoryEntry[]`| —     |
| `add_repository`        | `{ path: string }`            | `RepositoryEntry`  | —     |
| `init_repository`       | `{ path: string }`            | `RepositoryEntry`  | —     |
| `open_repository`       | `{ id: number }`              | `RepositoryEntry`  | —     |
| `set_repository_pinned` | `{ id: number, pinned: bool }`| `RepositoryEntry`  | —     |
| `remove_repository`     | `{ id: number }`              | `null`             | —     |
| `repository_status`     | `{ id: number }`              | `StatusSnapshot`   | read  |

Plugin permissions granted: `core:app:allow-version`, `dialog:allow-open`.

### Types

```ts
type ThemePreference = "system" | "light" | "dark";      // serde lowercase
interface Settings { theme: ThemePreference }
interface GitInfo { version: string; executable: string }

interface RepositoryEntry {
  id: number; path: string; name: string; pinned: boolean;
  addedAt: number;              // unix seconds
  lastOpenedAt: number | null;  // unix seconds
}

type ChangeKind = "modified" | "type_changed" | "added" | "deleted"
                | "renamed" | "copied" | "untracked" | "unmerged";

interface FileStatus {
  path: string;
  originalPath: string | null;  // renames/copies
  staged: ChangeKind | null;    // index side (X)
  unstaged: ChangeKind | null;  // worktree side (Y); "untracked" for ??
  conflicted: boolean;          // "u" records
}

interface BranchStatus {
  head: string | null;          // null = detached HEAD
  oid: string | null;           // null = unborn branch
  upstream: string | null;
  ahead: number; behind: number;
}

interface StatusSnapshot { branch: BranchStatus; files: FileStatus[] }
```

Notes:

- `repository_status` runs `git status --porcelain=v2 --branch -z
  --untracked-files=all`; ignored files are never returned.
- `remove_repository` only removes the registry row; files are untouched.
- `open_repository` fails with `not_a_repository` / `invalid_path` when the
  folder moved; the UI offers "Remove from list".

## Events

None are emitted yet. See `EVENT_CONTRACT.md`.

## Requested commands

Proposed by the UI session; not implemented. Full specifications, error
cases and priorities are in `INTEGRATION_STATUS.md` (R-1 … R-14). The UI does
not call any of them until they exist in this table above.
