import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ipc, toIpcError, type IpcError } from "./ipc";
import { queryKeys } from "./queries";
import type { OperationFinishedEvent, OperationKind, OperationProgressEvent, OperationStarted, PullMode } from "./types";
import { useActivity } from "../stores/activity";
import { useOperations } from "../stores/operations";

/**
 * Long-running Git operations. A `start_*` command returns an id at once;
 * progress and the single finish come from backend events. The activity
 * log records the operation until its finish event, not until `start_*`
 * returned, so "done" in the shelf means Git finished.
 */

/** Activity record ids for network operations, apart from mutation ids. */
const ACTIVITY_ID_BASE = 1_000_000_000;
let nextActivityId: number = ACTIVITY_ID_BASE;

const activityIds: Map<string, number> = new Map();
/** A finish that arrived before `start_*` resolved (events can overtake the reply). */
const earlyFinishes: Map<string, OperationFinishedEvent> = new Map();
const waiters: Map<string, Array<(event: OperationFinishedEvent) => void>> = new Map();

export interface StartOptions {
  kind: OperationKind;
  label: string;
  repositoryId: number | null;
  start: () => Promise<OperationStarted>;
}

/** Starts an operation and registers it; rejects with the start error (also logged). */
export async function startOperation({ kind, label, repositoryId, start }: StartOptions): Promise<string> {
  const activityId: number = nextActivityId++;
  useActivity.getState().started(activityId, label, repositoryId);
  let started: OperationStarted;
  try {
    started = await start();
  } catch (error: unknown) {
    const failure: IpcError = toIpcError(error);
    useActivity.getState().finished(activityId, { kind: failure.kind, message: failure.message });
    throw failure;
  }
  activityIds.set(started.operationId, activityId);
  useOperations.getState().started({ operationId: started.operationId, kind, label, repositoryId });
  const early: OperationFinishedEvent | undefined = earlyFinishes.get(started.operationId);
  if (early !== undefined) {
    earlyFinishes.delete(started.operationId);
    finish(early, null);
  }
  return started.operationId;
}

/** Resolves when the operation's finish event arrives. */
export function whenFinished(operationId: string): Promise<OperationFinishedEvent> {
  return new Promise((resolve) => {
    const list = waiters.get(operationId) ?? [];
    list.push(resolve);
    waiters.set(operationId, list);
  });
}

/** Asks the backend to cancel; `false` means it can no longer be cancelled. */
export async function cancelOperation(operationId: string): Promise<boolean> {
  const cancelled: boolean = await ipc.cancelOperation(operationId);
  if (!cancelled) useOperations.getState().notCancellable(operationId);
  return cancelled;
}

function finish(event: OperationFinishedEvent, client: QueryClient | null): void {
  const activityId: number | undefined = activityIds.get(event.operationId);
  if (activityId === undefined) {
    earlyFinishes.set(event.operationId, event);
    return;
  }
  activityIds.delete(event.operationId);
  const known = useOperations.getState().operations[event.operationId];
  useOperations.getState().finished(event.operationId, event.outcome, event.error);
  const error =
    event.outcome === "succeeded"
      ? null
      : event.error !== null
        ? { kind: event.error.kind, message: event.error.message }
        : { kind: "operation_cancelled" as const, message: "Cancelled." };
  useActivity.getState().finished(activityId, error);

  if (client !== null) {
    const repositoryId: number | null = known?.repositoryId ?? event.repositoryId;
    if (known?.kind === "clone") {
      void client.invalidateQueries({ queryKey: queryKeys.repositories, exact: true });
    } else if (repositoryId !== null) {
      // Fetch moves remote refs, pull also the branch and working tree, push the upstream counts.
      void client.invalidateQueries({ queryKey: queryKeys.repository(repositoryId) });
    }
  }
  const list = waiters.get(event.operationId);
  waiters.delete(event.operationId);
  list?.forEach((resolve) => resolve(event));
}

/** Test hook: route an event as the listener would. */
export function handleFinished(event: OperationFinishedEvent, client: QueryClient | null): void {
  finish(event, client);
}

export function handleProgress(event: OperationProgressEvent): void {
  useOperations.getState().progressed(event.operationId, event.phase, event.progress);
  // Pull cannot be cancelled after its fetch phase; the backend says so on
  // request, but the phase text is Git's own, so cancellation is attempted and
  // the reply decides (see cancelOperation).
}

/** Mounted once: routes operation events to the store, the activity log and the cache. */
export function useOperationEvents(): void {
  const client: QueryClient = useQueryClient();
  useEffect(() => {
    let disposed = false;
    const stops: UnlistenFn[] = [];
    const keep = (stop: UnlistenFn): void => {
      if (disposed) stop();
      else stops.push(stop);
    };
    void listen<OperationProgressEvent>("operation-progress", (event) => handleProgress(event.payload))
      .then(keep)
      .catch(() => {});
    void listen<OperationFinishedEvent>("operation-finished", (event) => finish(event.payload, client))
      .then(keep)
      .catch(() => {});
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, [client]);
}

export const PULL_LABEL: Record<PullMode, string> = {
  ff_only: "Pull (fast-forward only)",
  merge: "Pull with merge",
  rebase: "Pull with rebase",
};

/** Operation starters for one repository; each resolves with the operation id. */
export function networkActions(repositoryId: number) {
  return {
    fetch: (remote: string | null, prune = true): Promise<string> =>
      startOperation({
        kind: "fetch",
        label: remote === null ? "Fetch all remotes" : `Fetch ${remote}`,
        repositoryId,
        start: () => ipc.startFetch(repositoryId, remote, prune),
      }),
    pull: (mode: PullMode): Promise<string> =>
      startOperation({ kind: "pull", label: PULL_LABEL[mode], repositoryId, start: () => ipc.startPull(repositoryId, mode) }),
    push: (args: { remote?: string | null; branch?: string | null; setUpstream: boolean; forceWithLease: boolean }): Promise<string> =>
      startOperation({
        kind: "push",
        label: args.forceWithLease
          ? `Force push ${args.branch ?? "current branch"} (with lease)`
          : args.setUpstream
            ? `Publish ${args.branch ?? "current branch"}${args.remote ? ` to ${args.remote}` : ""}`
            : `Push ${args.branch ?? "current branch"}`,
        repositoryId,
        start: () => ipc.startPush({ id: repositoryId, ...args }),
      }),
    deleteRemoteBranch: (remote: string, branch: string): Promise<string> =>
      startOperation({
        kind: "delete_remote_branch",
        label: `Delete ${remote}/${branch}`,
        repositoryId,
        start: () => ipc.startDeleteRemoteBranch(repositoryId, remote, branch),
      }),
  };
}
