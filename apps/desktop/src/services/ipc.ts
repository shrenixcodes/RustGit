import { invoke } from "@tauri-apps/api/core";
import type {
  Comparison,
  ChangeTotals,
  CheckoutMode,
  CommitDetails,
  ConflictSide,
  ConflictVersions,
  IntegrationResult,
  LogPage,
  LogSearch,
  MergeStrategy,
  OperationStarted,
  PullMode,
  RefList,
  Remote,
  StashDetails,
  StashEntry,
  Worktree,
  CommandError,
  ErrorDetails,
  CommandRecord,
  CommitContext,
  CommitResult,
  WorkingDiffSide,
  ErrorKind,
  FileDiff,
  GitInfo,
  GithubAccount,
  GithubDeviceCode,
  GithubRepository,
  GithubStatus,
  HunkAction,
  RepositoryEntry,
  Settings,
  StatusSnapshot,
  ThemePreference,
  UpdateCheckResult,
} from "./types";

/** Error thrown by every IPC call; always carries a typed kind. */
export class IpcError extends Error {
  readonly kind: ErrorKind;
  /** `CommandError.details` (exit code, affected paths) when the backend sent them. */
  readonly details: ErrorDetails | undefined;

  constructor(kind: ErrorKind, message: string, details?: ErrorDetails) {
    super(message);
    this.name = "IpcError";
    this.kind = kind;
    this.details = details;
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
    return new IpcError(error.kind, error.message, error.details);
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
  /** Starts repository-changed events for this repository (max 8 watched). */
  watchRepository: (id: number): Promise<void> => call("watch_repository", { id }),
  unwatchRepository: (id: number): Promise<void> => call("unwatch_repository", { id }),

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

  // History (contract C-2).
  logPage: (args: {
    id: number;
    revisions?: string[] | null;
    skip: number;
    /** 1..2000 */
    limit: number;
    search?: LogSearch | null;
    since?: number | null;
    until?: number | null;
  }): Promise<LogPage> => call("log_page", { revisions: null, search: null, since: null, until: null, ...args }),
  commitDetails: (id: number, oid: string): Promise<CommitDetails> => call("commit_details", { id, oid }),
  commitFileDiff: (args: {
    id: number;
    oid: string;
    path: string;
    originalPath?: string | null;
    contextLines?: number | null;
  }): Promise<FileDiff> => call("commit_file_diff", { originalPath: null, contextLines: null, ...args }),
  compareRevisions: (id: number, base: string, head: string, mergeBase: boolean): Promise<Comparison> =>
    call("compare_revisions", { id, base, head, mergeBase }),
  compareFileDiff: (args: {
    id: number;
    base: string;
    head: string;
    mergeBase: boolean;
    path: string;
    originalPath?: string | null;
    contextLines?: number | null;
  }): Promise<FileDiff> => call("compare_file_diff", { originalPath: null, contextLines: null, ...args }),

  // References and branches (contract C-2).
  listRefs: (id: number): Promise<RefList> => call("list_refs", { id }),
  createBranch: (id: number, name: string, startPoint: string | null, checkout: boolean): Promise<RefList> =>
    call("create_branch", { id, name, startPoint, checkout }),
  checkoutBranch: (id: number, name: string, mode: CheckoutMode): Promise<StatusSnapshot> =>
    call("checkout_branch", { id, name, mode }),
  renameBranch: (id: number, from: string, to: string): Promise<RefList> => call("rename_branch", { id, from, to }),
  /** force deletes unmerged work: confirm with the user first. */
  deleteBranch: (id: number, name: string, force: boolean): Promise<RefList> =>
    call("delete_branch", { id, name, force }),
  setUpstream: (id: number, branch: string, upstream: string | null): Promise<RefList> =>
    call("set_upstream", { id, branch, upstream }),

  // Integrations and conflicts (contract C-2).
  mergeBranch: (id: number, source: string, strategy: MergeStrategy): Promise<IntegrationResult> =>
    call("merge_branch", { id, source, strategy }),
  rebaseBranch: (id: number, onto: string): Promise<IntegrationResult> => call("rebase_branch", { id, onto }),
  cherryPick: (id: number, oids: string[]): Promise<IntegrationResult> => call("cherry_pick", { id, oids }),
  revertCommit: (id: number, oid: string): Promise<IntegrationResult> => call("revert_commit", { id, oid }),
  continueOperation: (id: number): Promise<IntegrationResult> => call("continue_operation", { id }),
  abortOperation: (id: number): Promise<StatusSnapshot> => call("abort_operation", { id }),
  conflictVersions: (id: number, path: string): Promise<ConflictVersions> => call("conflict_versions", { id, path }),
  /** Exactly one of content or take. */
  resolveConflict: (
    id: number,
    path: string,
    resolution: { content: string; take?: null } | { take: ConflictSide; content?: null },
  ): Promise<StatusSnapshot> => call("resolve_conflict", { id, path, content: null, take: null, ...resolution }),

  // Remotes and long-running operations (contract C-2). start* resolve with
  // an operation id at once; listen to operation-progress / operation-finished.
  listRemotes: (id: number): Promise<Remote[]> => call("list_remotes", { id }),
  addRemote: (id: number, name: string, url: string): Promise<Remote[]> => call("add_remote", { id, name, url }),
  setRemoteUrl: (id: number, name: string, url: string, push: boolean): Promise<Remote[]> =>
    call("set_remote_url", { id, name, url, push }),
  removeRemote: (id: number, name: string): Promise<Remote[]> => call("remove_remote", { id, name }),
  /** remote null = all remotes. */
  startFetch: (id: number, remote: string | null, prune: boolean): Promise<OperationStarted> =>
    call("start_fetch", { id, remote, prune }),
  startPull: (id: number, mode: PullMode): Promise<OperationStarted> => call("start_pull", { id, mode }),
  /** forceWithLease rewrites remote history: confirm with the user first. */
  startPush: (args: {
    id: number;
    remote?: string | null;
    branch?: string | null;
    setUpstream: boolean;
    forceWithLease: boolean;
  }): Promise<OperationStarted> => call("start_push", { remote: null, branch: null, ...args }),
  /** Destructive on the remote: confirm with the user first. */
  startDeleteRemoteBranch: (id: number, remote: string, branch: string): Promise<OperationStarted> =>
    call("start_delete_remote_branch", { id, remote, branch }),
  startClone: (url: string, parentDirectory: string, directoryName: string | null): Promise<OperationStarted> =>
    call("start_clone", { url, parentDirectory, directoryName }),
  /** false when unknown, finished, or no longer cancellable (push, pull after fetch). */
  cancelOperation: (operationId: string): Promise<boolean> => call("cancel_operation", { operationId }),
  githubStatus: (): Promise<GithubStatus> => call("github_status"),
  githubStartSignIn: (): Promise<GithubDeviceCode> => call("github_start_sign_in"),
  githubCancelSignIn: (): Promise<void> => call("github_cancel_sign_in"),
  githubSavePat: (token: string): Promise<GithubAccount> => call("github_save_pat", { token }),
  githubSignOut: (): Promise<void> => call("github_sign_out"),
  githubListRepositories: (page: number): Promise<GithubRepository[]> => call("github_list_repositories", { page }),
  githubCreateRepository: (name: string, isPrivate: boolean): Promise<GithubRepository> =>
    call("github_create_repository", { name, private: isPrivate }),
  respondCredential: (requestId: string, answer: string | null): Promise<boolean> =>
    call("respond_credential", { requestId, answer }),

  // Stash (contract C-2).
  listStashes: (id: number): Promise<StashEntry[]> => call("list_stashes", { id }),
  createStash: (id: number, message: string | null, includeUntracked: boolean): Promise<StatusSnapshot> =>
    call("create_stash", { id, message, includeUntracked }),
  applyStash: (id: number, oid: string, pop: boolean): Promise<IntegrationResult> =>
    call("apply_stash", { id, oid, pop }),
  /** Destructive: confirm with the user first. */
  dropStash: (id: number, oid: string): Promise<StashEntry[]> => call("drop_stash", { id, oid }),
  stashDetails: (id: number, oid: string): Promise<StashDetails> => call("stash_details", { id, oid }),
  stashFileDiff: (id: number, oid: string, path: string, contextLines: number | null = null): Promise<FileDiff> =>
    call("stash_file_diff", { id, oid, path, contextLines }),

  // Worktrees (contract C-2).
  listWorktrees: (id: number): Promise<Worktree[]> => call("list_worktrees", { id }),
  addWorktree: (args: {
    id: number;
    path: string;
    branch?: string | null;
    newBranch?: string | null;
    commit?: string | null;
  }): Promise<Worktree[]> => call("add_worktree", { branch: null, newBranch: null, commit: null, ...args }),
  /** force discards the worktree's changes: confirm with the user first. */
  removeWorktree: (id: number, path: string, force: boolean): Promise<Worktree[]> =>
    call("remove_worktree", { id, path, force }),
  pruneWorktrees: (id: number): Promise<Worktree[]> => call("prune_worktrees", { id }),

  // System & Updater
  checkForUpdate: (): Promise<UpdateCheckResult> => call("check_for_update"),
  installUpdate: (downloadUrl: string, assetName: string): Promise<void> =>
    call("install_update", { downloadUrl, assetName }),
} as const;
