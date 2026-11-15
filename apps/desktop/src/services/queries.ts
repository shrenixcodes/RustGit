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
  CommandRecord,
  CommitDetails,
  GitInfo,
  LogPage,
  LogSearch,
  RefList,
  RepositoryEntry,
  Settings,
  StatusSnapshot,
  ThemePreference,
} from "./types";
import { useActivity } from "../stores/activity";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Human-readable operation name shown in the activity panel. */
      operation: string;
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
};

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
      const label: string | undefined = mutation.meta?.operation;
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
