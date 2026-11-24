import { useEffect, useState } from "react";
import { ChevronUp, CircleAlert, LoaderCircle, CheckCircle2 } from "lucide-react";
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
  // A failed automatic fetch stays in the Activity panel but does not take over the shelf.
  const last: OperationRecord | undefined = operations.find(
    (record) => record.outcome !== "running" && !(record.background && record.outcome === "failed"),
  );

  return (
    <footer
      aria-label="Operations"
      style={{ height: "var(--rg-shelf)" }}
      // Above the activity drawer, which slides up from behind it.
      className="relative z-10 flex shrink-0 items-center gap-3 border-t border-divider bg-bg px-4 font-sans text-xs text-fg-muted select-none"
    >
      {network[0] !== undefined ? (
        <RunningNetworkOperation key={network[0].operationId} operation={network[0]} more={running - 1} />
      ) : current !== undefined ? (
        <RunningOperation record={current} more={running - 1} />
      ) : last !== undefined ? (
        <span className="truncate flex items-center gap-2" title={new Date(last.startedAt).toLocaleString()}>
          <span
            className={`flex size-2 rounded-full ${
              last.outcome === "failed" ? "bg-danger" : "bg-success"
            }`}
          />
          <span className="font-medium text-fg">{last.label.toLowerCase()}</span>
          <span className="text-fg-muted">·</span>
          {last.outcome === "failed" ? (
            <span className="text-danger font-medium">{firstLine(last.error?.message ?? "failed")}</span>
          ) : (
            <span className="text-fg-muted flex items-center gap-1">
              <CheckCircle2 className="size-3 text-success inline" />
              <span>done {formatDuration((last.finishedAt ?? last.startedAt) - last.startedAt)}</span>
            </span>
          )}
        </span>
      ) : (
        <span className="flex items-center gap-2 text-fg-muted">
          <span className="size-1.5 rounded-full bg-fg-muted/40" />
          <span>idle</span>
        </span>
      )}

      <span className="flex-1" />

      {unseenFailures > 0 && (
        <span className="flex items-center gap-1.5 rounded-full border border-danger/40 bg-danger/15 px-2.5 py-0.5 text-2xs text-danger font-semibold">
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
        className={`flex h-6.5 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-all duration-150 active:scale-95 ${
          activityOpen
            ? "border-accent/50 bg-accent/15 text-accent shadow-xs"
            : "border-border/70 bg-elevated/40 text-fg-secondary hover:border-border-control hover:text-fg hover:bg-elevated"
        }`}
      >
        <span>Activity</span>
        <ChevronUp aria-hidden className={`size-3 transition-transform duration-200 ${activityOpen ? "rotate-180" : ""}`} />
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
    <span role="status" className="flex items-center gap-2 text-fg font-medium">
      <LoaderCircle aria-hidden className="size-3.5 text-accent motion-safe:animate-spin" />
      <span>{record.label.toLowerCase()}</span>
      {seconds > 0 && (
        <span className="rounded bg-accent/10 border border-accent/20 px-1 font-mono text-2xs text-accent">
          {seconds}s
        </span>
      )}
      {more > 0 && <span className="text-2xs text-fg-muted font-mono">+{more}</span>}
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
    <span role="status" className="flex min-w-0 items-center gap-2.5 text-fg">
      <LoaderCircle aria-hidden className="size-3.5 shrink-0 text-accent motion-safe:animate-spin" />
      <span className="shrink-0 font-medium">{operation.label.toLowerCase()}</span>
      <span className="truncate text-fg-muted">{describeProgress(operation)}</span>
      <ProgressLine operation={operation} className="w-24 shrink-0" />
      {operation.cancellable ? (
        <button
          type="button"
          onClick={() => void cancelOperation(operation.operationId).then((ok) => setRefused(!ok))}
          className="shrink-0 rounded px-1.5 py-0.5 text-2xs font-semibold text-danger/90 hover:bg-danger/10 hover:text-danger transition-colors"
        >
          cancel
        </button>
      ) : (
        <span className="shrink-0 text-2xs text-fg-muted" title={operation.kind === "push" ? "The remote may already have accepted the push" : undefined}>
          {refused ? "can no longer be cancelled" : "not cancellable"}
        </span>
      )}
      {more > 0 && <span className="shrink-0 text-2xs font-mono text-fg-muted">+{more}</span>}
    </span>
  );
}
