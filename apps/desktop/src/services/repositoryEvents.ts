import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ipc } from "./ipc";
import { queryKeys } from "./queries";
import type { RepositoryChangedEvent } from "./types";

/** Maps a `repository-changed` event to the cached queries it makes stale (EVENT_CONTRACT.md). */
export function invalidateForChange(client: QueryClient, event: RepositoryChangedEvent): void {
  const id: number = event.repositoryId;
  const scopes: ReadonlySet<string> = new Set(event.scopes);
  if (scopes.has("worktree") || scopes.has("index") || scopes.has("head")) {
    void client.invalidateQueries({ queryKey: queryKeys.status(id) });
    void client.invalidateQueries({ queryKey: queryKeys.diffs(id) });
    void client.invalidateQueries({ queryKey: queryKeys.totals(id) });
  }
  if (scopes.has("head") || scopes.has("config")) {
    void client.invalidateQueries({ queryKey: queryKeys.commitContext(id) });
  }
  if (scopes.has("refs") || scopes.has("head")) {
    void client.invalidateQueries({ queryKey: queryKeys.refs(id) });
    void client.invalidateQueries({ queryKey: queryKeys.logAll(id) });
    // refs/stash is a ref; worktrees show their branch and HEAD.
    void client.invalidateQueries({ queryKey: queryKeys.stashes(id) });
    void client.invalidateQueries({ queryKey: queryKeys.worktrees(id) });
  }
  if (scopes.has("config")) {
    void client.invalidateQueries({ queryKey: queryKeys.refs(id) });
    void client.invalidateQueries({ queryKey: queryKeys.remotes(id) });
  }
}

/**
 * Watches the open repository for filesystem changes while it is open, so
 * status, refs and history follow edits made outside RustGit. Failing to
 * watch is not fatal: focus refresh and explicit refresh still work.
 */
export function useRepositoryWatcher(repositoryId: number | null): void {
  const client: QueryClient = useQueryClient();

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    void listen<RepositoryChangedEvent>("repository-changed", (event) => invalidateForChange(client, event.payload))
      .then((stop: UnlistenFn) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // Events unavailable (e.g. outside Tauri); refresh on focus still applies.
      });

    if (repositoryId !== null) {
      ipc.watchRepository(repositoryId).catch(() => {
        // Recorded by the backend command history; not fatal for the UI.
      });
    }

    return () => {
      disposed = true;
      unlisten?.();
      if (repositoryId !== null) {
        ipc.unwatchRepository(repositoryId).catch(() => {});
      }
    };
  }, [client, repositoryId]);
}
