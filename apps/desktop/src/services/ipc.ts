import { invoke } from "@tauri-apps/api/core";
import type {
  CommandError,
  ErrorKind,
  GitInfo,
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
} as const;
