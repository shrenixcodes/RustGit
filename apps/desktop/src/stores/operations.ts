import { create } from "zustand";
import type { CommandError, OperationKind } from "../services/types";

/**
 * Long-running Git operations (clone, fetch, pull, push, remote branch
 * deletion). Started by a command that returns an id at once; everything
 * after that comes from the backend's `operation-progress` and
 * `operation-finished` events. Progress is shown only when Git reported it.
 */

export interface NetworkOperation {
  operationId: string;
  kind: OperationKind;
  label: string;
  repositoryId: number | null;
  startedAt: number;
  phase: string | null;
  progress: { current: number; total: number } | null;
  outcome: "running" | "succeeded" | "failed" | "cancelled";
  error: CommandError | null;
  finishedAt: number | null;
  /** Whether the backend may still accept a cancel request. */
  cancellable: boolean;
}

interface OperationsState {
  operations: Record<string, NetworkOperation>;
  started: (operation: Pick<NetworkOperation, "operationId" | "kind" | "label" | "repositoryId">, at?: number) => void;
  progressed: (operationId: string, phase: string, progress: NetworkOperation["progress"]) => void;
  finished: (operationId: string, outcome: Exclude<NetworkOperation["outcome"], "running">, error: CommandError | null, at?: number) => void;
  notCancellable: (operationId: string) => void;
  forget: (operationId: string) => void;
}

/** Operations the backend can cancel at start (pull only during its fetch phase). */
const CANCELLABLE: ReadonlySet<OperationKind> = new Set(["clone", "fetch", "pull"]);

export const useOperations = create<OperationsState>()((set) => ({
  operations: {},
  started: (operation, at = Date.now()) =>
    set((state) => ({
      operations: {
        ...state.operations,
        [operation.operationId]: {
          ...operation,
          startedAt: at,
          phase: null,
          progress: null,
          outcome: "running",
          error: null,
          finishedAt: null,
          cancellable: CANCELLABLE.has(operation.kind),
        },
      },
    })),
  progressed: (operationId, phase, progress) =>
    set((state) => {
      const current: NetworkOperation | undefined = state.operations[operationId];
      if (current === undefined || current.outcome !== "running") return state;
      return { operations: { ...state.operations, [operationId]: { ...current, phase, progress } } };
    }),
  finished: (operationId, outcome, error, at = Date.now()) =>
    set((state) => {
      const current: NetworkOperation | undefined = state.operations[operationId];
      if (current === undefined || current.outcome !== "running") return state;
      return {
        operations: { ...state.operations, [operationId]: { ...current, outcome, error, finishedAt: at, cancellable: false } },
      };
    }),
  notCancellable: (operationId) =>
    set((state) => {
      const current: NetworkOperation | undefined = state.operations[operationId];
      return current === undefined ? state : { operations: { ...state.operations, [operationId]: { ...current, cancellable: false } } };
    }),
  forget: (operationId) =>
    set((state) => {
      const next: Record<string, NetworkOperation> = { ...state.operations };
      delete next[operationId];
      return { operations: next };
    }),
}));

export function runningOperations(operations: Record<string, NetworkOperation>, repositoryId: number | null): NetworkOperation[] {
  return Object.values(operations)
    .filter((operation) => operation.outcome === "running" && (repositoryId === null || operation.repositoryId === repositoryId))
    .sort((a, b) => a.startedAt - b.startedAt);
}

/** "Receiving objects 412/1 024" — counts only when Git gave them. */
export function describeProgress(operation: NetworkOperation): string {
  if (operation.phase === null) return "starting…";
  if (operation.progress === null) return operation.phase;
  return `${operation.phase} ${operation.progress.current.toLocaleString()}/${operation.progress.total.toLocaleString()}`;
}
