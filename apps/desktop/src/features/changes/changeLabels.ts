import type { ChangeKind, FileStatus } from "../../services/types";

export const CHANGE_LABELS: Record<ChangeKind, { letter: string; label: string; tone: string }> = {
  modified: { letter: "M", label: "Modified", tone: "text-amber" },
  type_changed: { letter: "T", label: "Type changed", tone: "text-amber" },
  added: { letter: "A", label: "Added", tone: "text-success" },
  deleted: { letter: "D", label: "Deleted", tone: "text-danger" },
  renamed: { letter: "R", label: "Renamed", tone: "text-lavender" },
  copied: { letter: "C", label: "Copied", tone: "text-lavender" },
  untracked: { letter: "U", label: "Untracked", tone: "text-success" },
  unmerged: { letter: "!", label: "Conflicted", tone: "text-danger" },
};

export interface StatusCounts {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

export function countChanges(files: readonly FileStatus[]): StatusCounts {
  const counts: StatusCounts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  for (const file of files) {
    if (file.conflicted) {
      counts.conflicted += 1;
      continue;
    }
    if (file.staged !== null) {
      counts.staged += 1;
    }
    if (file.unstaged === "untracked") {
      counts.untracked += 1;
    } else if (file.unstaged !== null) {
      counts.unstaged += 1;
    }
  }
  return counts;
}

export type ChangeGroupId = "conflicted" | "staged" | "unstaged" | "untracked";

export const GROUP_ORDER: readonly ChangeGroupId[] = ["conflicted", "staged", "unstaged", "untracked"];

export const GROUP_TITLES: Record<ChangeGroupId, string> = {
  conflicted: "Conflicted",
  staged: "Staged",
  unstaged: "Unstaged",
  untracked: "Untracked",
};

export type SplitChanges = Record<ChangeGroupId, FileStatus[]>;

/**
 * Groups files the way Git reports them. A file with both staged and
 * unstaged edits appears in both Staged and Unstaged (see `isPartiallyStaged`).
 */
export function splitChanges(files: readonly FileStatus[]): SplitChanges {
  const result: SplitChanges = { conflicted: [], staged: [], unstaged: [], untracked: [] };
  for (const file of files) {
    if (file.conflicted) {
      result.conflicted.push(file);
      continue;
    }
    if (file.staged !== null) {
      result.staged.push(file);
    }
    if (file.unstaged === "untracked") {
      result.untracked.push(file);
    } else if (file.unstaged !== null) {
      result.unstaged.push(file);
    }
  }
  return result;
}

/** True when only part of the file's changes are in the index. */
export function isPartiallyStaged(file: FileStatus): boolean {
  return !file.conflicted && file.staged !== null && file.unstaged !== null && file.unstaged !== "untracked";
}

/** The change kind shown for a file within a group. */
export function kindInGroup(file: FileStatus, group: ChangeGroupId): ChangeKind | null {
  switch (group) {
    case "conflicted":
      return "unmerged";
    case "staged":
      return file.staged;
    case "unstaged":
    case "untracked":
      return file.unstaged;
  }
}

/** Splits a repository-relative path into its file name and directory. */
export function splitPath(path: string): { name: string; directory: string } {
  const trimmed: string = path.endsWith("/") ? path.slice(0, -1) : path;
  const slash: number = trimmed.lastIndexOf("/");
  return slash < 0
    ? { name: trimmed, directory: "" }
    : { name: trimmed.slice(slash + 1), directory: trimmed.slice(0, slash) };
}

/** Case-insensitive match on the path (and original path for renames); all terms must match. */
export function matchesFilter(file: FileStatus, query: string): boolean {
  const terms: string[] = query.toLowerCase().split(/\s+/).filter((term: string) => term.length > 0);
  if (terms.length === 0) {
    return true;
  }
  const haystack: string = `${file.path}\n${file.originalPath ?? ""}`.toLowerCase();
  return terms.every((term: string) => haystack.includes(term));
}

/** Groups of the review stream. A file belongs to exactly one, so it appears once. */
export type NavigatorGroup = "conflicts" | "changes" | "untracked";

export function groupOf(file: FileStatus): NavigatorGroup {
  if (file.conflicted) return "conflicts";
  if (file.staged === null && file.unstaged === "untracked") return "untracked";
  return "changes";
}

/** Plain-language staging state, used for accessible names. */
export function stagingState(file: FileStatus): string {
  if (file.conflicted) return "conflicted";
  if (isPartiallyStaged(file)) return "partially staged";
  if (file.staged !== null) return "staged";
  return file.unstaged === "untracked" ? "untracked" : "not staged";
}

/** The kind shown for a file: what is staged, else what changed in the working tree. */
export function displayKind(file: FileStatus): ChangeKind | null {
  if (file.conflicted) return "unmerged";
  return file.staged ?? file.unstaged;
}
