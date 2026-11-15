import {
  MutationCache,
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { ipc, toIpcError, type IpcError } from "./ipc";
import type {
  ChangeTotals,
  CommandRecord,
  CommitContext,
  CommitDetails,
  CommitResult,
  FileDiff,
  HunkAction,
  GitInfo,
  LogPage,
  LogSearch,
  RefList,
  RepositoryEntry,
  Settings,
  StatusSnapshot,
  ThemePreference,
  WorkingDiffSide,
} from "./types";
import { useActivity } from "../stores/activity";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Human-readable operation name shown in the activity panel. */
      operation: string;
      /** Optional precise label computed from the mutation variables. */
      describe?: (variables: unknown) => string;
    };
  }
}

/** Filters for the history log. `revision` null walks every branch, remote branch and tag. */
export interface LogFilters {
  revision: string | null;
  search: LogSearch | null;
  /** Unix seconds, inclusive bounds. */
  since: number | null;
  until: number | null;
}

/** Commits per `log_page` request (contract allows 1–2000). */
export const LOG_PAGE_SIZE = 300;

// Every repository-scoped key starts with ["repositories", id], so a
// repository can be invalidated as a whole.
export const queryKeys = {
  gitInfo: ["git-info"] as const,
  settings: ["settings"] as const,
  repositories: ["repositories"] as const,
  commandHistory: ["command-history"] as const,
  repository: (repositoryId: number) => ["repositories", repositoryId] as const,
  status: (repositoryId: number) => ["repositories", repositoryId, "status"] as const,
  refs: (repositoryId: number) => ["repositories", repositoryId, "refs"] as const,
  logAll: (repositoryId: number) => ["repositories", repositoryId, "log"] as const,
  log: (repositoryId: number, filters: LogFilters) => ["repositories", repositoryId, "log", filters] as const,
  commit: (repositoryId: number, oid: string) => ["repositories", repositoryId, "commit", oid] as const,
  diffs: (repositoryId: number) => ["repositories", repositoryId, "diff"] as const,
  diff: (repositoryId: number, path: string, side: WorkingDiffSide, ignoreWhitespace: boolean) =>
    ["repositories", repositoryId, "diff", path, side, ignoreWhitespace] as const,
  totals: (repositoryId: number) => ["repositories", repositoryId, "totals"] as const,
  commitContext: (repositoryId: number) => ["repositories", repositoryId, "commit-context"] as const,
};

/** Context lines for staging diffs; `apply_hunk` must receive the same value. */
export const DIFF_CONTEXT_LINES = 3;

/** Extracts a repository id from mutation variables when the variables carry one. */
function repositoryIdOf(variables: unknown): number | null {
  if (typeof variables === "number") {
    return variables;
  }
  if (typeof variables === "object" && variables !== null) {
    const id: unknown = (variables as Record<string, unknown>).id;
    return typeof id === "number" ? id : null;
  }
  return null;
}

export function createQueryClient(): QueryClient {
  // Assigned below; callbacks only run after construction.
  let client: QueryClient | null = null;
  // Every labelled mutation is an operation the user started; record its real outcome.
  const mutationCache: MutationCache = new MutationCache({
    onMutate: (variables, mutation) => {
      const label: string | undefined = mutation.meta?.describe?.(variables) ?? mutation.meta?.operation;
      if (label !== undefined) {
        useActivity.getState().started(mutation.mutationId, label, repositoryIdOf(variables));
      }
    },
    onSettled: (_data, error, _variables, _context, mutation) => {
      if (mutation.meta?.operation !== undefined) {
        const failure: IpcError | null = error === null ? null : toIpcError(error);
        useActivity
          .getState()
          .finished(mutation.mutationId, failure === null ? null : { kind: failure.kind, message: failure.message });
      }
      // Any mutation may have run Git commands.
      void client?.invalidateQueries({ queryKey: queryKeys.commandHistory });
    },
  });

  client = new QueryClient({
    mutationCache,
    defaultOptions: {
      queries: {
        // Data changes through user actions or filesystem events, never through timers.
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
  return client;
}

/**
 * Git commands the backend ran (redacted), newest last from the backend;
 * fetched only while the activity panel shows them.
 */
export function useCommandHistory(repositoryId: number | null, enabled: boolean): UseQueryResult<CommandRecord[], IpcError> {
  return useQuery({
    queryKey: [...queryKeys.commandHistory, repositoryId],
    queryFn: () => ipc.commandHistory({ repositoryId }),
    enabled,
    staleTime: 0,
  });
}

export function useGitInfo(): UseQueryResult<GitInfo, IpcError> {
  return useQuery({ queryKey: queryKeys.gitInfo, queryFn: ipc.gitInfo, staleTime: Infinity });
}

export function useSettings(): UseQueryResult<Settings, IpcError> {
  return useQuery({ queryKey: queryKeys.settings, queryFn: ipc.getSettings, staleTime: Infinity });
}

export function useSetTheme(): UseMutationResult<Settings, IpcError, ThemePreference> {
  const client: QueryClient = useQueryClient();
  return useMutation({
    mutationFn: ipc.setTheme,
    meta: { operation: "Change theme" },
    onSuccess: (settings: Settings) => client.setQueryData(queryKeys.settings, settings),
  });
}

export function useRepositories(): UseQueryResult<RepositoryEntry[], IpcError> {
  return useQuery({ queryKey: queryKeys.repositories, queryFn: ipc.listRepositories });
}

export function useRepositoryStatus(repositoryId: number | null): UseQueryResult<StatusSnapshot, IpcError> {
  return useQuery({
    queryKey: queryKeys.status(repositoryId ?? -1),
    queryFn: () => ipc.repositoryStatus(repositoryId ?? -1),
    enabled: repositoryId !== null,
    staleTime: 5_000,
  });
}

/** Mutations that change the repository list all refresh it on success. */
function useRepositoryListMutation<TVariables, TResult>(
  operation: string,
  mutationFn: (variables: TVariables) => Promise<TResult>,
): UseMutationResult<TResult, IpcError, TVariables> {
  const client: QueryClient = useQueryClient();
  return useMutation({
    mutationFn,
    meta: { operation },
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.repositories, exact: true }),
  });
}

export const useAddRepository = () => useRepositoryListMutation("Add repository", ipc.addRepository);
export const useInitRepository = () => useRepositoryListMutation("Create repository", ipc.initRepository);
export const useOpenRepository = () => useRepositoryListMutation("Open repository", ipc.openRepository);
export const useRemoveRepository = () => useRepositoryListMutation("Remove repository from list", ipc.removeRepository);
export const useSetRepositoryPinned = () =>
  useRepositoryListMutation("Change repository pin", ({ id, pinned }: { id: number; pinned: boolean }) =>
    ipc.setRepositoryPinned(id, pinned),
  );

export function useRefs(repositoryId: number): UseQueryResult<RefList, IpcError> {
  return useQuery({ queryKey: queryKeys.refs(repositoryId), queryFn: () => ipc.listRefs(repositoryId), staleTime: 10_000 });
}

/**
 * Paged history. Pages are requested on demand (never the whole log), and
 * unchanged page objects keep their identity across refetches (structural
 * sharing), which the incremental graph layout relies on.
 */
export function useLogPages(
  repositoryId: number,
  filters: LogFilters,
): UseInfiniteQueryResult<InfiniteData<LogPage, number>, IpcError> {
  return useInfiniteQuery({
    queryKey: queryKeys.log(repositoryId, filters),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      ipc.logPage({
        id: repositoryId,
        revisions: filters.revision === null ? null : [filters.revision],
        skip: pageParam,
        limit: LOG_PAGE_SIZE,
        search: filters.search,
        since: filters.since,
        until: filters.until,
      }),
    getNextPageParam: (lastPage: LogPage, pages: LogPage[]) =>
      lastPage.hasMore ? pages.reduce((count: number, page: LogPage) => count + page.commits.length, 0) : undefined,
    staleTime: 10_000,
  });
}

export function useCommitDetails(repositoryId: number, oid: string | null): UseQueryResult<CommitDetails, IpcError> {
  return useQuery({
    queryKey: queryKeys.commit(repositoryId, oid ?? ""),
    queryFn: () => ipc.commitDetails(repositoryId, oid ?? ""),
    enabled: oid !== null,
    // A commit id names immutable content.
    staleTime: Infinity,
  });
}

export function useFileDiff(
  repositoryId: number,
  path: string | null,
  originalPath: string | null,
  side: WorkingDiffSide,
  ignoreWhitespace: boolean,
  enabled: boolean,
): UseQueryResult<FileDiff, IpcError> {
  return useQuery({
    queryKey: queryKeys.diff(repositoryId, path ?? "", side, ignoreWhitespace),
    queryFn: () =>
      ipc.fileDiff({
        id: repositoryId,
        path: path ?? "",
        originalPath,
        side,
        ignoreWhitespace,
        contextLines: DIFF_CONTEXT_LINES,
      }),
    enabled: enabled && path !== null,
    staleTime: 5_000,
  });
}

export function useStagedTotals(repositoryId: number): UseQueryResult<ChangeTotals, IpcError> {
  return useQuery({
    queryKey: [...queryKeys.totals(repositoryId), "staged"],
    queryFn: () => ipc.changeTotals(repositoryId, "staged"),
    staleTime: 5_000,
  });
}

export function useCommitContext(repositoryId: number): UseQueryResult<CommitContext, IpcError> {
  return useQuery({ queryKey: queryKeys.commitContext(repositoryId), queryFn: () => ipc.commitContext(repositoryId) });
}

/** Everything that depends on the index or working tree, after a staging change. */
function invalidateWorkingState(client: QueryClient, repositoryId: number): void {
  void client.invalidateQueries({ queryKey: queryKeys.diffs(repositoryId) });
  void client.invalidateQueries({ queryKey: queryKeys.totals(repositoryId) });
  void client.invalidateQueries({ queryKey: queryKeys.commitContext(repositoryId) });
}

export type StagingRequest =
  | { kind: "stage"; paths: string[] }
  | { kind: "unstage"; paths: string[] }
  | { kind: "stage_all" }
  | { kind: "unstage_all" }
  | { kind: "discard"; paths: string[] }
  | {
      kind: "hunk";
      path: string;
      side: WorkingDiffSide;
      action: HunkAction;
      hunkHeader: string;
      lineIndices: number[] | null;
    };

/** Activity label for a staging request, e.g. "Stage 3 lines". */
export function describeStaging(request: StagingRequest): string {
  const files = (count: number): string => (count === 1 ? "file" : `${count} files`);
  switch (request.kind) {
    case "stage":
      return `Stage ${files(request.paths.length)}`;
    case "unstage":
      return `Unstage ${files(request.paths.length)}`;
    case "stage_all":
      return "Stage all";
    case "unstage_all":
      return "Unstage all";
    case "discard":
      return `Discard changes in ${files(request.paths.length)}`;
    case "hunk": {
      const what: string =
        request.lineIndices === null ? "hunk" : `${request.lineIndices.length} line${request.lineIndices.length === 1 ? "" : "s"}`;
      const verb: string = request.action === "stage" ? "Stage" : request.action === "unstage" ? "Unstage" : "Discard";
      return `${verb} ${what}`;
    }
  }
}

/**
 * All index and working-tree changes. The returned status replaces the
 * cached one (it is the repository's state after the change); diffs, totals
 * and commit context are refetched. Nothing is updated optimistically.
 */
export function useStaging(repositoryId: number): UseMutationResult<StatusSnapshot, IpcError, StagingRequest> {
  const client: QueryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: StagingRequest): Promise<StatusSnapshot> => {
      switch (request.kind) {
        case "stage":
          return ipc.stagePaths(repositoryId, request.paths);
        case "unstage":
          return ipc.unstagePaths(repositoryId, request.paths);
        case "stage_all":
          return ipc.stageAll(repositoryId);
        case "unstage_all":
          return ipc.unstageAll(repositoryId);
        case "discard":
          return ipc.discardPaths(repositoryId, request.paths);
        case "hunk":
          return ipc.applyHunk({
            id: repositoryId,
            path: request.path,
            side: request.side,
            action: request.action,
            hunkHeader: request.hunkHeader,
            lineIndices: request.lineIndices,
            contextLines: DIFF_CONTEXT_LINES,
          });
      }
    },
    meta: { operation: "Change staging", describe: (variables: unknown) => describeStaging(variables as StagingRequest) },
    onSuccess: (status: StatusSnapshot) => client.setQueryData(queryKeys.status(repositoryId), status),
    onSettled: (_data, error) => {
      // After a failure (for example a stale diff) the cached status may be out of date too.
      if (error !== null) void client.invalidateQueries({ queryKey: queryKeys.status(repositoryId) });
      invalidateWorkingState(client, repositoryId);
    },
  });
}

export function useCreateCommit(
  repositoryId: number,
): UseMutationResult<CommitResult, IpcError, { message: string; amend: boolean }> {
  const client: QueryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ message, amend }: { message: string; amend: boolean }) => ipc.createCommit(repositoryId, message, amend),
    meta: {
      operation: "Commit",
      describe: (variables: unknown) => ((variables as { amend: boolean }).amend ? "Amend commit" : "Commit"),
    },
    onSuccess: (result: CommitResult) => {
      client.setQueryData(queryKeys.status(repositoryId), result.status);
      void client.invalidateQueries({ queryKey: queryKeys.logAll(repositoryId) });
      void client.invalidateQueries({ queryKey: queryKeys.refs(repositoryId) });
    },
    onSettled: () => invalidateWorkingState(client, repositoryId),
  });
}
