import { invoke } from "@tauri-apps/api/core";
import type {
  AuthorIdentity,
  ChangeTotals,
  CommandError,
  CommandRecord,
  CommitResult,
  DiffSide,
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
    side: DiffSide;
    ignoreWhitespace: boolean;
  }): Promise<FileDiff> => call("file_diff", { originalPath: null, ...args }),
  /** "discard" is destructive: confirm with the user first. */
  applyHunk: (args: {
    id: number;
    path: string;
    side: DiffSide;
    action: HunkAction;
    hunkHeader: string;
    lineIndices?: number[] | null;
  }): Promise<StatusSnapshot> => call("apply_hunk", { lineIndices: null, ...args }),
  changeTotals: (id: number, side: DiffSide): Promise<ChangeTotals> => call("change_totals", { id, side }),

  // Commits (contract C-1).
  authorIdentity: (id: number): Promise<AuthorIdentity> => call("author_identity", { id }),
  lastCommitMessage: (id: number): Promise<string | null> => call("last_commit_message", { id }),
  createCommit: (id: number, message: string, amend: boolean): Promise<CommitResult> =>
    call("create_commit", { id, message, amend }),

  commandHistory: (): Promise<CommandRecord[]> => call("command_history"),
} as const;
