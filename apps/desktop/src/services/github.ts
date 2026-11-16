import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQuery, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { ipc, type IpcError } from "./ipc";
import type { GithubSignInFinished, GithubStatus } from "./types";

export const githubStatusKey = ["github-status"] as const;

/** Whether this build can sign in to GitHub, and the signed-in account if any. */
export function useGithubStatus(): UseQueryResult<GithubStatus, IpcError> {
  return useQuery({ queryKey: githubStatusKey, queryFn: ipc.githubStatus, staleTime: 60_000, retry: false });
}

/** Refreshes the account when the background sign-in finishes; `onFinished` receives its result. */
export function useGithubSignInEvents(onFinished: (result: GithubSignInFinished) => void): void {
  const client: QueryClient = useQueryClient();
  useEffect(() => {
    let disposed = false;
    let stop: UnlistenFn | null = null;
    void listen<GithubSignInFinished>("github-sign-in-finished", (event) => {
      void client.invalidateQueries({ queryKey: githubStatusKey });
      onFinished(event.payload);
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, [client, onFinished]);
}
