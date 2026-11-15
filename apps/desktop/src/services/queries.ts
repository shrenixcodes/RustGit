import {
  MutationCache,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { ipc, toIpcError, type IpcError } from "./ipc";
import type { GitInfo, RepositoryEntry, Settings, StatusSnapshot, ThemePreference } from "./types";
import { useActivity } from "../stores/activity";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Human-readable operation name shown in the activity panel. */
      operation: string;
    };
  }
}

export const queryKeys = {
  gitInfo: ["git-info"] as const,
  settings: ["settings"] as const,
  repositories: ["repositories"] as const,
  status: (repositoryId: number) => ["repositories", repositoryId, "status"] as const,
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
    },
  });

  return new QueryClient({
    mutationCache,
    defaultOptions: {
      queries: {
        // Data changes through user actions or (later) filesystem events,
        // never through timers.
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
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
