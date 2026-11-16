import { useEffect, useState } from "react";
import { ChevronUp, CircleAlert, LoaderCircle } from "lucide-react";
import { formatShortcut } from "./shortcuts";
import { formatDuration } from "./ActivityPanel";
import { ProgressLine } from "./ProgressLine";
import { cancelOperation } from "../services/network";
import { runningCount, useActivity, type OperationRecord } from "../stores/activity";
import { describeProgress, runningOperations, useOperations, type NetworkOperation } from "../stores/operations";
import { usePreferences } from "../stores/preferences";

/**
 * The operation center's persistent, compact form: what is running, what
 * just finished, what failed. Repository state lives in the ridge.
 */
export function OperationShelf() {
  const operations: OperationRecord[] = useActivity((state) => state.operations);
  const unseenFailures: number = useActivity((state) => state.unseenFailures);
  const activityOpen: boolean = usePreferences((state) => state.activityOpen);
  const setActivityOpen = usePreferences((state) => state.setActivityOpen);
  const networkOperations = useOperations((state) => state.operations);
  const network: NetworkOperation[] = runningOperations(networkOperations, null);
  const running: number = runningCount(operations);
  const current: OperationRecord | undefined = operations.find((record) => record.outcome === "running");
  const last: OperationRecord | undefined = operations.find((record) => record.outcome !== "running");

  return (
    <footer
      aria-label="Operations"
      style={{ height: "var(--rg-shelf)" }}
      className="flex shrink-0 items-center gap-4 border-t border-divider bg-bg px-5 font-mono text-xs text-fg-muted"
    >
      {network[0] !== undefined ? (
        <RunningNetworkOperation operation={network[0]} more={running - 1} />
      ) : current !== undefined ? (
        <RunningOperation record={current} more={running - 1} />
      ) : last !== undefined ? (
        <span className="truncate" title={new Date(last.startedAt).toLocaleString()}>
          {last.label.toLowerCase()} ·{" "}
          {last.outcome === "failed" ? (
            <span className="text-danger">failed{last.error !== null ? `: ${firstLine(last.error.message)}` : ""}</span>
          ) : (
            <span>done {formatDuration((last.finishedAt ?? last.startedAt) - last.startedAt)}</span>
          )}
        </span>
      ) : (
        <span>idle</span>
      )}

      <span className="flex-1" />

      {unseenFailures > 0 && (
        <span className="flex items-center gap-1 text-danger">
          <CircleAlert aria-hidden className="size-3" />
          {unseenFailures} failed
        </span>
      )}
      <button
        type="button"
        aria-pressed={activityOpen}
        aria-label={
          unseenFailures > 0 ? `Activity, ${unseenFailures} failed operation${unseenFailures === 1 ? "" : "s"}` : "Activity"
        }
        title={`Activity (${formatShortcut("Mod+J")})`}
        onClick={() => setActivityOpen(!activityOpen)}
        className={`flex h-5 items-center gap-1 rounded-sm px-1.5 hover:text-fg ${activityOpen ? "text-accent" : ""}`}
      >
        activity
        <ChevronUp aria-hidden className={`size-3 transition-transform duration-100 ${activityOpen ? "rotate-180" : ""}`} />
      </button>
    </footer>
  );
}

function RunningOperation({ record, more }: { record: OperationRecord; more: number }) {
  // Elapsed time ticks only while an operation runs; nothing polls the backend.
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const timer: number = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds: number = Math.max(0, Math.floor((now - record.startedAt) / 1000));
  return (
    <span role="status" className="flex items-center gap-1.5 text-fg">
      <LoaderCircle aria-hidden className="size-3 text-accent motion-safe:animate-spin" />
      {record.label.toLowerCase()}
      {seconds > 0 && <span className="tabular-nums text-fg-muted">{seconds}s</span>}
      {more > 0 && <span className="text-fg-muted">+{more}</span>}
    </span>
  );
}

function firstLine(message: string): string {
  const line: string = message.split("\n").find((part) => part.trim() !== "") ?? message;
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

/** A clone, fetch, pull or push: Git's phase, its counts when it gave them, and cancel while the backend allows it. */
function RunningNetworkOperation({ operation, more }: { operation: NetworkOperation; more: number }) {
  const [refused, setRefused] = useState<boolean>(false);
  return (
    <span role="status" className="flex min-w-0 items-center gap-2 text-fg">
      <LoaderCircle aria-hidden className="size-3 shrink-0 text-accent motion-safe:animate-spin" />
      <span className="shrink-0">{operation.label.toLowerCase()}</span>
      <span className="truncate text-fg-muted">{describeProgress(operation)}</span>
      <ProgressLine operation={operation} className="w-24 shrink-0" />
      {operation.cancellable ? (
        <button
          type="button"
          onClick={() => void cancelOperation(operation.operationId).then((ok) => setRefused(!ok))}
          className="shrink-0 rounded-sm px-1 text-fg-secondary underline-offset-2 hover:text-fg hover:underline"
        >
          cancel
        </button>
      ) : (
        <span className="shrink-0 text-fg-muted" title={operation.kind === "push" ? "The remote may already have accepted the push" : undefined}>
          {refused ? "can no longer be cancelled" : "not cancellable"}
        </span>
      )}
      {more > 0 && <span className="shrink-0 text-fg-muted">+{more}</span>}
    </span>
  );
}
