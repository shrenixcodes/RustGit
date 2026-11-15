# RustGit integration status

Shared between the **core engineering session** (Rust engine, Tauri
commands, infrastructure) and the **UI session** (React frontend). Append;
do not rewrite the other session's entries. Each request lists what the UI
needs. The core session decides the final shape and records it in
`API_CONTRACT.md`. Proposed names, fields and error kinds are suggestions.

Priorities: **P0** blocks the first three screens (Changes, History,
Branches); **P1** needed for the same screens' full feature set; **P2** later
phases.

## Summary

| ID   | Capability                            | Priority | Status    | UI depending on it                         |
| ---- | ------------------------------------- | -------- | --------- | ------------------------------------------ |
| R-1  | Command history                       | P0       | requested | Activity panel, command inspector          |
| R-2  | File diff (staged / unstaged)         | P0       | requested | Changes diff viewer, file inspector totals |
| R-3  | Stage / unstage whole paths           | P0       | requested | File list actions, Stage all / Unstage all |
| R-4  | Stage / unstage / discard hunks+lines | P0       | requested | Diff hunk and line actions                 |
| R-5  | Discard working-tree paths            | P1       | requested | File list Discard (with confirmation)      |
| R-6  | Commit identity and HEAD message      | P0       | requested | Commit composer author line, amend         |
| R-7  | Create commit (incl. amend)           | P0       | requested | Commit composer                            |
| R-8  | Paged commit log                      | P0       | requested | History graph                              |
| R-9  | References (branches, remotes, tags)  | P0       | requested | Graph labels, Branches workspace           |
| R-10 | Commit details                        | P1       | requested | Commit inspector                           |
| R-11 | Branch operations                     | P1       | requested | Branches workspace                         |
| R-12 | `repository-changed` event            | P1       | requested | Live refresh everywhere                    |
| R-13 | Network operations + progress events  | P2       | requested | Fetch/pull/push, operation shelf           |
| R-14 | Conflict versions and resolution      | P2       | requested | Conflict workspace                         |

Proposed new `ErrorKind` values: `stale_diff`, `nothing_to_commit`,
`hook_failed`, `identity_missing`, `would_overwrite_changes`,
`branch_not_fully_merged`, `branch_exists`, `invalid_ref_name`,
`operation_in_progress`, `operation_cancelled`, `authentication_failed`.

---

## R-1 Command history — P0

The engine already records the last 200 redacted commands
(`GitExecutor::history`). The UI needs them exposed.

```ts
command_history({ repositoryId?: number, sinceSequence?: number })
  -> CommandRecord[]

interface CommandRecord {
  sequence: number;        // NEW: monotonically increasing, for incremental reads
  startedAt: number;       // NEW: unix milliseconds
  args: string[];          // existing, redacted
  cwd: string;             // existing
  durationMs: number;      // existing
  exitCode: number | null; // existing
  stderr: string;          // existing, redacted
  repositoryId: number | null; // NEW, when known
}
```

Errors: none expected beyond `internal`. Must never include environment
variables, credential helpers' output or unredacted URLs.

## R-2 File diff — P0

```ts
file_diff({
  id: number, path: string,
  side: "unstaged" | "staged",       // worktree vs index, or index vs HEAD
  ignoreWhitespace: boolean,         // -w
  contextLines: number,              // -U<n>, default 3
}) -> FileDiff

interface FileDiff {
  path: string;
  originalPath: string | null;
  side: "unstaged" | "staged";
  /** Opaque fingerprint of the diff text (e.g. hash), echoed back by R-4. */
  diffId: string;
  binary: boolean;
  /** True when the diff exceeded a backend limit; hunks is then empty. */
  truncated: boolean;
  byteSize: number;                  // size of the new side when known
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

interface DiffHunk {
  header: string;        // full "@@ -a,b +c,d @@ context" line
  oldStart: number; oldLines: number;
  newStart: number; newLines: number;
  lines: DiffLine[];
}

interface DiffLine {
  kind: "context" | "addition" | "deletion" | "no_newline";
  oldLine: number | null;
  newLine: number | null;
  text: string;          // without the leading +/-/space and without "\n"
}
```

Behaviour:

- Untracked files (`side: "unstaged"`): diff against an empty file
  (`git diff --no-index /dev/null <path>`), all lines additions.
- Renames on the staged side: `originalPath` set; use `-M`.
- Limit proposal: stop parsing and set `truncated` beyond 20 000 lines or
  8 MB of diff text; the UI shows the size and offers "Open externally".
- Must use `-z`-safe path passing (`-- <path>`), `--no-color`,
  `--no-ext-diff`, and disable `diff.external`/textconv for staging diffs so
  hunk coordinates match what `git apply` will see.

Errors: `invalid_path` (path not in status), `git_command_failed`.

## R-3 Stage / unstage paths — P0

```ts
stage_paths({ id: number, paths: string[] })   -> StatusSnapshot
unstage_paths({ id: number, paths: string[] }) -> StatusSnapshot
```

- Stage: `git add -A -- <paths>` (handles deletions and untracked).
- Unstage: `git restore --staged -- <paths>`; on an unborn branch,
  `git rm --cached -r -- <paths>`.
- Returns the fresh status so the UI does not need a second round trip.
- Takes the write lock.

Errors: `invalid_path`, `git_command_failed` (e.g. `index.lock` exists:
please keep Git's stderr in `message`).

## R-4 Partial staging (hunks and lines) — P0

The UI selects; the backend builds the patch from **its own** fresh diff, so
the frontend never sends patch text that Git would apply.

```ts
apply_selection({
  id: number, path: string,
  side: "unstaged" | "staged",
  action: "stage" | "unstage" | "discard",   // discard only with side "unstaged"
  diffId: string,                            // from R-2; mismatch -> stale_diff
  ignoreWhitespace: boolean, contextLines: number, // same options as the diff shown
  selection: Array<{
    hunk: number;              // index into FileDiff.hunks
    lines: number[] | null;    // indices into hunk.lines; null = whole hunk
  }>,
}) -> StatusSnapshot
```

Semantics (as in `git add -p` / GitHub Desktop line selection):

- stage: build a patch of worktree-vs-index containing only selected
  `addition`/`deletion` lines; unselected additions are dropped, unselected
  deletions become context. Apply with `git apply --cached --recount`.
- unstage: same construction on the index-vs-HEAD diff, applied with
  `git apply --cached --reverse --recount`.
- discard: same construction on the worktree diff, applied with
  `git apply --reverse --recount` (working tree). The UI confirms first.
- Untracked file with `stage`: stage the whole file (`git add`); line
  selection on untracked files may use `git add -N` + patch. Please state
  which in the contract.
- If `ignoreWhitespace` was used for the displayed diff, either rebuild
  without `-w` and map selection, or reject with a clear error; please
  state the choice.

Errors: `stale_diff` (file changed since the diff was read; UI reloads the
diff and keeps nothing applied), `git_command_failed` (patch did not apply;
include stderr).

## R-5 Discard paths — P1

```ts
discard_paths({ id: number, paths: string[], removeUntracked: boolean }) -> StatusSnapshot
```

Tracked: `git restore --worktree -- <paths>` (keep the index as is).
Untracked (only with `removeUntracked`): delete the files. Never touches
paths not listed. The UI always confirms first and names every path.

## R-6 Commit identity and HEAD message — P0

```ts
commit_context({ id: number }) -> {
  authorName: string | null;    // git config user.name (effective for this repo)
  authorEmail: string | null;
  signing: "off" | "gpg" | "ssh" | "x509";  // commit.gpgSign + gpg.format
  head: null | {                // null on an unborn branch
    oid: string;
    summary: string;
    body: string;
    /** True when HEAD is reachable from its upstream (amend would rewrite published history). */
    onUpstream: boolean | null; // null when there is no upstream
  };
  /** In-progress state that changes how committing works. */
  state: "none" | "merging" | "rebasing" | "cherry_picking" | "reverting";
}
```

## R-7 Create commit — P0

```ts
create_commit({ id: number, summary: string, description: string, amend: boolean })
  -> { oid: string; summary: string }
```

- Commits the index only (`git commit -F -` with the message on stdin,
  `--amend` when requested; never `-a`).
- Hooks run (no `--no-verify`).

Errors:
- `nothing_to_commit` (empty index and not amend).
- `identity_missing` (no user.name / user.email).
- `hook_failed` with the hook's stdout+stderr in `message` and, if possible,
  an `exitCode` field (proposed extension of `CommandError`:
  `details?: { exitCode?: number; output?: string }`).
- `git_command_failed` otherwise.

## R-8 Paged commit log — P0

```ts
log_page({
  id: number,
  /** Revisions to walk; default all refs + HEAD (equivalent of --all). */
  revisions: string[] | null,
  skip: number,              // commits already loaded
  limit: number,             // UI uses 300
  search: null | { text: string; field: "message" | "author" | "sha" },
  since: number | null, until: number | null,   // unix seconds
}) -> { commits: LogCommit[]; hasMore: boolean }

interface LogCommit {
  oid: string;
  parents: string[];        // in Git order; first parent first
  summary: string;
  authorName: string; authorEmail: string;
  authorTime: number;       // unix seconds
  committerTime: number;
}
```

Ordering must be stable across pages: `git log --topo-order` (or
`--date-order`) with the same revisions; please document which. The UI's
lane layout depends on children appearing before parents. Format via
`--format` with NUL separators; `-z`.

## R-9 References — P0

```ts
list_refs({ id: number }) -> {
  head: { kind: "branch"; name: string } | { kind: "detached"; oid: string } | { kind: "unborn"; name: string };
  refs: Array<{
    fullName: string;              // refs/heads/main
    shortName: string;             // main, origin/main, v1.0
    kind: "local" | "remote" | "tag";
    oid: string;                   // peeled commit id for annotated tags
    upstream: string | null;       // local branches only
    ahead: number | null; behind: number | null;  // vs upstream; null if none/gone
    upstreamGone: boolean;
    lastCommitTime: number;        // for stale detection
    lastCommitSummary: string;
  }>;
}
```

`git for-each-ref --format=... refs/heads refs/remotes refs/tags` with
`%(upstream:track)` gives most of this in one call.

## R-10 Commit details — P1

```ts
commit_details({ id: number, oid: string }) -> {
  oid: string; parents: string[];
  authorName: string; authorEmail: string; authorTime: number;
  committerName: string; committerEmail: string; committerTime: number;
  message: string;             // full message
  files: Array<{ path: string; originalPath: string | null; kind: ChangeKind;
                 additions: number | null; deletions: number | null }>;  // null for binary
}
commit_file_diff({ id, oid, path, parent?: string }) -> FileDiff  // same shape as R-2
```

## R-11 Branch operations — P1

```ts
create_branch({ id, name, startPoint: string | null, checkout: boolean }) -> list_refs result
checkout_branch({ id, name, mode: "keep_changes" | "abort_if_dirty" }) -> StatusSnapshot
rename_branch({ id, from, to }) -> list_refs result
delete_branch({ id, name, force: boolean }) -> list_refs result
set_upstream({ id, branch, upstream: string | null }) -> list_refs result
merge_branch({ id, source, strategy: "default" | "no_ff" | "ff_only" }) -> { status: StatusSnapshot; conflicted: string[] }
```

Errors: `would_overwrite_changes` with the affected paths (from Git's
"would be overwritten" output) so the UI can offer stash/keep options;
`branch_not_fully_merged` (UI then offers force delete with a warning);
`branch_exists`; `invalid_ref_name` (from `git check-ref-format`).

## R-12 `repository-changed` event — P1

See `EVENT_CONTRACT.md` E-1.

## R-13 Network operations — P2

`fetch`, `pull`, `push` returning `{ operationId }` immediately, with
`operation-progress` / `operation-finished` events (E-2, E-3) and
`cancel_operation({ operationId })` that terminates the Git process safely.
Push must support `--force-with-lease` only, never plain `--force`.

## R-14 Conflicts — P2

```ts
conflict_versions({ id, path }) -> {
  base: string | null; ours: string | null; theirs: string | null;  // stages 1-3; null when absent
  working: string;                  // current file with markers
  oursLabel: string; theirsLabel: string;   // e.g. "HEAD (main)", "feature/x"
  binary: boolean;
}
resolve_conflict({ id, path, content: string | null, take: "ours" | "theirs" | null })
  -> StatusSnapshot   // writes file, runs git add; verifies `git ls-files -u -- path` is empty
```

---

## Log

| Date       | Session | Entry                                                        |
| ---------- | ------- | ------------------------------------------------------------ |
| 2026-11-15 | UI      | Created integration docs; documented existing contract at `f967219`; filed R-1 … R-14. UI work happens on branch `worktree-ui-orbital`. |
