import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { ipc, type IpcError } from "./ipc";
import type { GitInfo, RepositoryEntry, Settings, StatusSnapshot, ThemePreference } from "./types";

export const queryKeys = {
  gitInfo: ["git-info"] as const,
  settings: ["settings"] as const,
  repositories: ["repositories"] as const,
  status: (repositoryId: number) => ["repositories", repositoryId, "status"] as const,
};

export function createQueryClient(): QueryClient {
  return new QueryClient({
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
  mutationFn: (variables: TVariables) => Promise<TResult>,
): UseMutationResult<TResult, IpcError, TVariables> {
  const client: QueryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.repositories, exact: true }),
  });
}

export const useAddRepository = () => useRepositoryListMutation(ipc.addRepository);
export const useInitRepository = () => useRepositoryListMutation(ipc.initRepository);
export const useOpenRepository = () => useRepositoryListMutation(ipc.openRepository);
export const useRemoveRepository = () => useRepositoryListMutation(ipc.removeRepository);
export const useSetRepositoryPinned = () =>
  useRepositoryListMutation(({ id, pinned }: { id: number; pinned: boolean }) => ipc.setRepositoryPinned(id, pinned));
