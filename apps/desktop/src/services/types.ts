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
  | "nothing_to_commit"
  | "identity_missing"
  | "would_overwrite_changes"
  | "branch_not_fully_merged"
  | "branch_exists"
  | "invalid_ref_name"
  | "operation_in_progress"
  | "operation_cancelled"
  | "authentication_failed"
  | "git_command_failed"
  | "git_output_unrecognized"
  | "repository_not_found"
  | "database"
  | "internal";

export interface ErrorDetails {
  /** Exit code of the failed Git process (git_command_failed). */
  exitCode: number | null;
  /** Affected files (would_overwrite_changes). */
  paths: string[];
}

export interface CommandError {
  kind: ErrorKind;
  message: string;
  details?: ErrorDetails;
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

export type InProgress = "none" | "merging" | "rebasing" | "cherry_picking" | "reverting";

export interface StatusSnapshot {
  branch: BranchStatus;
  files: FileStatus[];
  inProgress: InProgress;
}

export interface CommandRecord {
  /** Monotonically increasing per application run. */
  sequence: number;
  /** Unix milliseconds. */
  startedAt: number;
  /** Registered repository whose root contains cwd, if any. */
  repositoryId: number | null;
  /** Credentials in URLs are replaced by ***. */
  args: string[];
  cwd: string;
  durationMs: number;
  /** null when the process was terminated by a signal. */
  exitCode: number | null;
  stderr: string;
}

/** "commit" appears only in responses (commit and stash diffs). */
export type DiffSide = "staged" | "unstaged" | "commit";
export type WorkingDiffSide = Exclude<DiffSide, "commit">;
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

export type SigningMode = "off" | "gpg" | "ssh" | "x509";

export interface HeadCommit {
  oid: string;
  summary: string;
  message: string;
  /** HEAD reachable from its upstream; null when there is no upstream. */
  onUpstream: boolean | null;
}

export interface CommitContext {
  authorName: string | null;
  authorEmail: string | null;
  signing: SigningMode;
  head: HeadCommit | null;
  inProgress: InProgress;
}

export interface CommitResult {
  oid: string;
  summary: string;
  status: StatusSnapshot;
}
