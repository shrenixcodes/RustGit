import { useMutation, useQuery, useQueryClient, type QueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { ipc, type IpcError } from "./ipc";
import { queryKeys } from "./queries";
import type { FileDiff, IntegrationResult, Remote, StashDetails, StashEntry, StatusSnapshot, Worktree } from "./types";

// Remotes, stash and worktrees (contract C-2). Keys live in `queryKeys`.

export function useRemotes(repositoryId: number | null): UseQueryResult<Remote[], IpcError> {
  return useQuery({
    queryKey: queryKeys.remotes(repositoryId ?? -1),
    queryFn: () => ipc.listRemotes(repositoryId ?? -1),
    enabled: repositoryId !== null,
  });
}

export type RemoteRequest =
  | { kind: "add"; name: string; url: string }
  | { kind: "set_url"; name: string; url: string; push: boolean }
  | { kind: "remove"; name: string };

export function describeRemoteRequest(request: RemoteRequest): string {
  switch (request.kind) {
    case "add":
      return `Add remote ${request.name}`;
    case "set_url":
      return `Change ${request.push ? "push" : "fetch"} URL of ${request.name}`;
    case "remove":
      return `Remove remote ${request.name}`;
  }
}

export function useRemoteOperation(repositoryId: number): UseMutationResult<Remote[], IpcError, RemoteRequest> {
  const client: QueryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: RemoteRequest) => {
      switch (request.kind) {
        case "add":
          return ipc.addRemote(repositoryId, request.name, request.url);
        case "set_url":
          return ipc.setRemoteUrl(repositoryId, request.name, request.url, request.push);
        case "remove":
          return ipc.removeRemote(repositoryId, request.name);
      }
    },
    meta: { operation: "Remote", describe: (variables: unknown) => describeRemoteRequest(variables as RemoteRequest) },
    onSuccess: (remotes: Remote[]) => client.setQueryData(queryKeys.remotes(repositoryId), remotes),
    onSettled: () => {
      // Removing a remote removes its remote-tracking branches.
      void client.invalidateQueries({ queryKey: queryKeys.refs(repositoryId) });
      void client.invalidateQueries({ queryKey: queryKeys.logAll(repositoryId) });
    },
  });
}

export function useStashes(repositoryId: number | null): UseQueryResult<StashEntry[], IpcError> {
  return useQuery({
    queryKey: queryKeys.stashes(repositoryId ?? -1),
    queryFn: () => ipc.listStashes(repositoryId ?? -1),
    enabled: repositoryId !== null,
  });
}

export function useStashDetails(repositoryId: number, oid: string | null): UseQueryResult<StashDetails, IpcError> {
  return useQuery({
    queryKey: [...queryKeys.stashes(repositoryId), "details", oid ?? ""],
    queryFn: () => ipc.stashDetails(repositoryId, oid ?? ""),
    enabled: oid !== null,
    // A stash's content never changes; its oid identifies it.
    staleTime: Infinity,
  });
}

export function useStashFileDiff(
  repositoryId: number,
  oid: string,
  path: string | null,
  contextLines: number,
): UseQueryResult<FileDiff, IpcError> {
  return useQuery({
    queryKey: [...queryKeys.stashes(repositoryId), "diff", oid, path ?? "", contextLines],
    queryFn: () => ipc.stashFileDiff(repositoryId, oid, path ?? "", contextLines),
    enabled: path !== null,
    staleTime: Infinity,
  });
}

export type StashRequest =
  | { kind: "create"; message: string | null; includeUntracked: boolean }
  | { kind: "apply"; oid: string; pop: boolean; label: string }
  | { kind: "drop"; oid: string; label: string };

export type StashOutcome =
  | { kind: "status"; status: StatusSnapshot }
  | { kind: "integration"; result: IntegrationResult }
  | { kind: "stashes"; stashes: StashEntry[] };

export function describeStashRequest(request: StashRequest): string {
  switch (request.kind) {
    case "create":
      return request.includeUntracked ? "Stash changes and untracked files" : "Stash changes";
    case "apply":
      return `${request.pop ? "Pop" : "Apply"} ${request.label}`;
    case "drop":
      return `Drop ${request.label}`;
  }
}

export function useStashOperation(repositoryId: number): UseMutationResult<StashOutcome, IpcError, StashRequest> {
  const client: QueryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: StashRequest): Promise<StashOutcome> => {
      switch (request.kind) {
        case "create":
          return { kind: "status", status: await ipc.createStash(repositoryId, request.message, request.includeUntracked) };
        case "apply":
          return { kind: "integration", result: await ipc.applyStash(repositoryId, request.oid, request.pop) };
        case "drop":
          return { kind: "stashes", stashes: await ipc.dropStash(repositoryId, request.oid) };
      }
    },
    meta: { operation: "Stash", describe: (variables: unknown) => describeStashRequest(variables as StashRequest) },
    onSuccess: (outcome: StashOutcome) => {
      if (outcome.kind === "status") client.setQueryData(queryKeys.status(repositoryId), outcome.status);
      if (outcome.kind === "integration") client.setQueryData(queryKeys.status(repositoryId), outcome.result.status);
      if (outcome.kind === "stashes") client.setQueryData(queryKeys.stashes(repositoryId), outcome.stashes);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.stashes(repositoryId) });
      void client.invalidateQueries({ queryKey: queryKeys.status(repositoryId) });
      void client.invalidateQueries({ queryKey: queryKeys.diffs(repositoryId) });
      void client.invalidateQueries({ queryKey: queryKeys.totals(repositoryId) });
    },
  });
}

export function useWorktrees(repositoryId: number | null): UseQueryResult<Worktree[], IpcError> {
  return useQuery({
    queryKey: queryKeys.worktrees(repositoryId ?? -1),
    queryFn: () => ipc.listWorktrees(repositoryId ?? -1),
    enabled: repositoryId !== null,
  });
}

export type WorktreeRequest =
  | { kind: "add"; path: string; branch: string | null; newBranch: string | null; commit: string | null }
  | { kind: "remove"; path: string; force: boolean }
  | { kind: "prune" };

export function describeWorktreeRequest(request: WorktreeRequest): string {
  switch (request.kind) {
    case "add":
      return `Add worktree ${request.path}`;
    case "remove":
      return `${request.force ? "Force remove" : "Remove"} worktree ${request.path}`;
    case "prune":
      return "Prune worktrees";
  }
}

export function useWorktreeOperation(repositoryId: number): UseMutationResult<Worktree[], IpcError, WorktreeRequest> {
  const client: QueryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: WorktreeRequest) => {
      switch (request.kind) {
        case "add":
          return ipc.addWorktree({
            id: repositoryId,
            path: request.path,
            branch: request.branch,
            newBranch: request.newBranch,
            commit: request.commit,
          });
        case "remove":
          return ipc.removeWorktree(repositoryId, request.path, request.force);
        case "prune":
          return ipc.pruneWorktrees(repositoryId);
      }
    },
    meta: { operation: "Worktree", describe: (variables: unknown) => describeWorktreeRequest(variables as WorktreeRequest) },
    onSuccess: (worktrees: Worktree[]) => client.setQueryData(queryKeys.worktrees(repositoryId), worktrees),
    onSettled: () => {
      // A new branch may have been created for the worktree.
      void client.invalidateQueries({ queryKey: queryKeys.refs(repositoryId) });
      void client.invalidateQueries({ queryKey: queryKeys.logAll(repositoryId) });
    },
  });
}
