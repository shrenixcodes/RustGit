/**
 * IPC contract types. These mirror the serde types in
 * `crates/core` and `crates/git-engine`; keep both sides in sync.
 */

export type ErrorKind =
  | "git_not_found"
  | "not_a_repository"
  | "invalid_path"
  | "invalid_request"
  | "stale_diff"
  | "git_command_failed"
  | "git_output_unrecognized"
  | "repository_not_found"
  | "database"
  | "internal";

export interface CommandError {
  kind: ErrorKind;
  message: string;
}

export type ThemePreference = "system" | "light" | "dark";

export interface Settings {
  theme: ThemePreference;
}

export interface GitInfo {
  version: string;
  executable: string;
}

export interface RepositoryEntry {
  id: number;
  path: string;
  name: string;
  pinned: boolean;
  /** Unix seconds. */
  addedAt: number;
  /** Unix seconds, or null if never opened. */
  lastOpenedAt: number | null;
}

export type ChangeKind =
  | "modified"
  | "type_changed"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "unmerged";

export interface FileStatus {
  path: string;
  originalPath: string | null;
  staged: ChangeKind | null;
  unstaged: ChangeKind | null;
  conflicted: boolean;
}

export interface BranchStatus {
  head: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface StatusSnapshot {
  branch: BranchStatus;
  files: FileStatus[];
}

export interface CommandRecord {
  /** Credentials in URLs are replaced by ***. */
  args: string[];
  cwd: string;
  durationMs: number;
  /** null when the process was terminated by a signal. */
  exitCode: number | null;
  stderr: string;
}

export type DiffSide = "staged" | "unstaged";
export type DiffFileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";
export type DiffLineKind = "context" | "add" | "delete";

export interface DiffLine {
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  /** Without the leading +/-/space marker. */
  content: string;
  noNewlineAtEnd: boolean;
}

export interface DiffHunk {
  /** Full "@@ -a,b +c,d @@ section" line; identifies the hunk for apply_hunk. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  originalPath: string | null;
  side: DiffSide;
  status: DiffFileStatus;
  binary: boolean;
  /** More than 2 MiB of diff text or 20 000 lines; hunks are omitted. */
  tooLarge: boolean;
  hunks: DiffHunk[];
  added: number;
  deleted: number;
}

export type HunkAction = "stage" | "unstage" | "discard";

export interface FileTotals {
  path: string;
  /** null for binary files. */
  added: number | null;
  deleted: number | null;
}

export interface ChangeTotals {
  files: FileTotals[];
  added: number;
  deleted: number;
}

export interface AuthorIdentity {
  name: string | null;
  email: string | null;
}

export interface CommitResult {
  oid: string;
  summary: string;
  status: StatusSnapshot;
}
