/**
 * IPC contract types. These mirror the serde types in
 * `crates/core` and `crates/git-engine`; keep both sides in sync.
 */

export type ErrorKind =
  | "git_not_found"
  | "not_a_repository"
  | "invalid_path"
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
