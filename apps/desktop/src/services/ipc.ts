import { invoke } from "@tauri-apps/api/core";
import type {
  ChangeTotals,
  CommandError,
  CommandRecord,
  CommitContext,
  CommitResult,
  WorkingDiffSide,
  ErrorKind,
  FileDiff,
  GitInfo,
  HunkAction,
  RepositoryEntry,
  Settings,
  StatusSnapshot,
  ThemePreference,
} from "./types";

/** Error thrown by every IPC call; always carries a typed kind. */
export class IpcError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = "IpcError";
    this.kind = kind;
  }
}

function isCommandError(value: unknown): value is CommandError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).kind === "string" &&
    typeof (value as Record<string, unknown>).message === "string"
  );
}

export function toIpcError(error: unknown): IpcError {
  if (error instanceof IpcError) {
    return error;
  }
  if (isCommandError(error)) {
    return new IpcError(error.kind, error.message);
  }
  const message: string = error instanceof Error ? error.message : String(error);
  return new IpcError("internal", message);
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw toIpcError(error);
  }
}

export const ipc = {
  gitInfo: (): Promise<GitInfo> => call("git_info"),
  getSettings: (): Promise<Settings> => call("get_settings"),
  setTheme: (theme: ThemePreference): Promise<Settings> => call("set_theme", { theme }),

  listRepositories: (): Promise<RepositoryEntry[]> => call("list_repositories"),
  addRepository: (path: string): Promise<RepositoryEntry> => call("add_repository", { path }),
  initRepository: (path: string): Promise<RepositoryEntry> => call("init_repository", { path }),
  openRepository: (id: number): Promise<RepositoryEntry> => call("open_repository", { id }),
  setRepositoryPinned: (id: number, pinned: boolean): Promise<RepositoryEntry> =>
    call("set_repository_pinned", { id, pinned }),
  removeRepository: (id: number): Promise<void> => call("remove_repository", { id }),
  repositoryStatus: (id: number): Promise<StatusSnapshot> => call("repository_status", { id }),

  // Changes and staging (contract C-1). Mutations return the status after the change.
  stagePaths: (id: number, paths: string[]): Promise<StatusSnapshot> => call("stage_paths", { id, paths }),
  unstagePaths: (id: number, paths: string[]): Promise<StatusSnapshot> => call("unstage_paths", { id, paths }),
  stageAll: (id: number): Promise<StatusSnapshot> => call("stage_all", { id }),
  unstageAll: (id: number): Promise<StatusSnapshot> => call("unstage_all", { id }),
  /** Destructive: confirm with the user first. */
  discardPaths: (id: number, paths: string[]): Promise<StatusSnapshot> => call("discard_paths", { id, paths }),
  fileDiff: (args: {
    id: number;
    path: string;
    originalPath?: string | null;
    side: WorkingDiffSide;
    ignoreWhitespace: boolean;
    /** 0..20, default 3. apply_hunk must use the same value. */
    contextLines?: number | null;
  }): Promise<FileDiff> => call("file_diff", { originalPath: null, contextLines: null, ...args }),
  /** "discard" is destructive: confirm with the user first. */
  applyHunk: (args: {
    id: number;
    path: string;
    side: WorkingDiffSide;
    action: HunkAction;
    hunkHeader: string;
    lineIndices?: number[] | null;
    contextLines?: number | null;
  }): Promise<StatusSnapshot> => call("apply_hunk", { lineIndices: null, contextLines: null, ...args }),
  changeTotals: (id: number, side: WorkingDiffSide): Promise<ChangeTotals> =>
    call("change_totals", { id, side }),

  // Commits (contract C-1).
  commitContext: (id: number): Promise<CommitContext> => call("commit_context", { id }),
  createCommit: (id: number, message: string, amend: boolean): Promise<CommitResult> =>
    call("create_commit", { id, message, amend }),

  commandHistory: (filter: { repositoryId?: number | null; sinceSequence?: number | null } = {}): Promise<
    CommandRecord[]
  > => call("command_history", { repositoryId: null, sinceSequence: null, ...filter }),
} as const;
