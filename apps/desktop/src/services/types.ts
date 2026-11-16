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

// --- History (contract C-2) ---------------------------------------------

export type LogSearchField = "message" | "author" | "sha";

export interface LogSearch {
  text: string;
  field: LogSearchField;
}

export interface LogCommit {
  oid: string;
  /** First parent first. */
  parents: string[];
  summary: string;
  authorName: string;
  authorEmail: string;
  /** Unix seconds. */
  authorTime: number;
  committerTime: number;
}

export interface LogPage {
  commits: LogCommit[];
  hasMore: boolean;
}

export interface CommitFile {
  path: string;
  originalPath: string | null;
  kind: ChangeKind;
  /** null for binary files. */
  additions: number | null;
  deletions: number | null;
}

export interface CommitDetails {
  oid: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorTime: number;
  committerName: string;
  committerEmail: string;
  committerTime: number;
  message: string;
  files: CommitFile[];
}

/** Result of `compare_revisions` (request R-16). */
export interface Comparison {
  base: string;
  head: string;
  /** Set for a three-dot comparison: the files are compared from here. */
  mergeBase: string | null;
  /** Commits in head and not in base, and the reverse. */
  ahead: number;
  behind: number;
  files: CommitFile[];
}

// --- References and branches (contract C-2) ---------------------------------

export type HeadState =
  | { kind: "branch"; name: string }
  | { kind: "detached"; oid: string }
  | { kind: "unborn"; name: string };

export type RefKind = "local" | "remote" | "tag";

export interface RefEntry {
  fullName: string;
  shortName: string;
  kind: RefKind;
  /** Peeled commit id for annotated tags. */
  oid: string;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  upstreamGone: boolean;
  lastCommitTime: number;
  lastCommitSummary: string;
}

export interface RefList {
  head: HeadState;
  refs: RefEntry[];
}

export type CheckoutMode = "keep_changes" | "abort_if_dirty";
export type MergeStrategy = "default" | "no_ff" | "ff_only";
export type IntegrationOutcome = "up_to_date" | "fast_forward" | "completed" | "conflicts";

export interface IntegrationResult {
  outcome: IntegrationOutcome;
  conflicted: string[];
  status: StatusSnapshot;
}

export interface ConflictVersions {
  base: string | null;
  ours: string | null;
  theirs: string | null;
  working: string;
  oursLabel: string;
  theirsLabel: string;
  binary: boolean;
}

export type ConflictSide = "ours" | "theirs";

// --- Remotes and long-running operations (contract C-2) ---------------------

export interface Remote {
  name: string;
  /** Credentials are redacted. */
  fetchUrl: string | null;
  pushUrl: string | null;
}

export type PullMode = "ff_only" | "merge" | "rebase";

export interface OperationStarted {
  operationId: string;
}

export type OperationKind = "clone" | "fetch" | "pull" | "push" | "delete_remote_branch";

/** Payload of the `operation-progress` event. */
export interface OperationProgressEvent {
  operationId: string;
  repositoryId: number | null;
  kind: OperationKind;
  /** Git's own phase text, e.g. "Receiving objects". */
  phase: string;
  /** Only when Git reported counts; never synthesized. */
  progress: { current: number; total: number } | null;
}

/** Payload of the `operation-finished` event; emitted exactly once per operation. */
export interface OperationFinishedEvent {
  operationId: string;
  /** For clone: the newly registered repository. */
  repositoryId: number | null;
  outcome: "succeeded" | "failed" | "cancelled";
  error: CommandError | null;
}

// --- Stash and worktrees (contract C-2) -------------------------------------

export interface StashEntry {
  index: number;
  /** Stable identity; stash@{n} positions shift. */
  oid: string;
  message: string;
  createdAt: number;
}

export interface StashFile {
  path: string;
  kind: ChangeKind;
  untracked: boolean;
}

export interface StashDetails {
  files: StashFile[];
}

export interface Worktree {
  path: string;
  head: string | null;
  branch: string | null;
  isMain: boolean;
  detached: boolean;
  bare: boolean;
  /** Lock reason ("" when locked without a reason). */
  locked: string | null;
  /** Why the worktree can be pruned (directory missing). */
  prunable: string | null;
}

// --- Filesystem watching (contract C-2) -------------------------------------

export type ChangeScope = "worktree" | "index" | "refs" | "head" | "config";

/** Payload of the `repository-changed` event (debounced 300 ms, max 2 s). */
export interface RepositoryChangedEvent {
  repositoryId: number;
  scopes: ChangeScope[];
}
