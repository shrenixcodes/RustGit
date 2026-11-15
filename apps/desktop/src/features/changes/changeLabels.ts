import type { ChangeKind, FileStatus } from "../../services/types";

export const CHANGE_LABELS: Record<ChangeKind, { letter: string; label: string; tone: string }> = {
  modified: { letter: "M", label: "Modified", tone: "text-warning" },
  type_changed: { letter: "T", label: "Type changed", tone: "text-warning" },
  added: { letter: "A", label: "Added", tone: "text-success" },
  deleted: { letter: "D", label: "Deleted", tone: "text-danger" },
  renamed: { letter: "R", label: "Renamed", tone: "text-accent" },
  copied: { letter: "C", label: "Copied", tone: "text-accent" },
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

export interface SplitChanges {
  staged: FileStatus[];
  unstaged: FileStatus[];
  conflicted: FileStatus[];
}

/** A file with both staged and unstaged edits appears in both lists, as in Git. */
export function splitChanges(files: readonly FileStatus[]): SplitChanges {
  const result: SplitChanges = { staged: [], unstaged: [], conflicted: [] };
  for (const file of files) {
    if (file.conflicted) {
      result.conflicted.push(file);
      continue;
    }
    if (file.staged !== null) {
      result.staged.push(file);
    }
    if (file.unstaged !== null) {
      result.unstaged.push(file);
    }
  }
  return result;
}
