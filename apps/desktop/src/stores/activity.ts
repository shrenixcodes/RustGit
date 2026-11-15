import { create } from "zustand";
import type { ErrorKind } from "../services/types";

/**
 * Operations the UI invoked on the backend, with their real outcome.
 * Fed by the TanStack mutation cache (see `services/queries.ts`); nothing
 * here is synthesized. Git command records will come from backend request
 * R-1 (`command_history`) once it exists.
 */

export type OperationOutcome = "running" | "succeeded" | "failed";

export interface OperationRecord {
  id: number;
  label: string;
  repositoryId: number | null;
  startedAt: number;
  finishedAt: number | null;
  outcome: OperationOutcome;
  error: { kind: ErrorKind; message: string } | null;
}

export const ACTIVITY_CAPACITY = 200;

interface ActivityState {
  operations: OperationRecord[];
  /** Failures recorded since the activity panel was last opened. */
  unseenFailures: number;
  started: (id: number, label: string, repositoryId: number | null, at?: number) => void;
  finished: (id: number, error: { kind: ErrorKind; message: string } | null, at?: number) => void;
  markSeen: () => void;
  clear: () => void;
}

export const useActivity = create<ActivityState>()((set) => ({
  operations: [],
  unseenFailures: 0,
  started: (id, label, repositoryId, at = Date.now()) =>
    set((state) => {
      const record: OperationRecord = {
        id,
        label,
        repositoryId,
        startedAt: at,
        finishedAt: null,
        outcome: "running",
        error: null,
      };
      return { operations: [record, ...state.operations].slice(0, ACTIVITY_CAPACITY) };
    }),
  finished: (id, error, at = Date.now()) =>
    set((state) => {
      let failed = false;
      const operations: OperationRecord[] = state.operations.map((record: OperationRecord) => {
        if (record.id !== id || record.outcome !== "running") {
          return record;
        }
        failed = error !== null;
        return { ...record, finishedAt: at, outcome: error === null ? "succeeded" : "failed", error };
      });
      return { operations, unseenFailures: state.unseenFailures + (failed ? 1 : 0) };
    }),
  markSeen: () => set({ unseenFailures: 0 }),
  clear: () => set((state) => ({ operations: state.operations.filter((record) => record.outcome === "running") })),
}));

export function runningCount(operations: readonly OperationRecord[]): number {
  return operations.reduce((count: number, record: OperationRecord) => count + (record.outcome === "running" ? 1 : 0), 0);
}
