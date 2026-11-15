import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CircleAlert, GitBranch, LoaderCircle, PanelBottom } from "lucide-react";
import { formatShortcut } from "./shortcuts";
import { useRepositories, useRepositoryStatus } from "../services/queries";
import type { RepositoryEntry, StatusSnapshot } from "../services/types";
import { runningCount, useActivity, type OperationRecord } from "../stores/activity";
import { usePreferences } from "../stores/preferences";
import { useWorkspace } from "../stores/workspace";
import { countChanges } from "../features/changes/changeLabels";

/** Persistent bottom shelf: repository state and operations. Everything shown is real state. */
export function OperationShelf() {
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const showSection = useWorkspace((state) => state.showSection);
  const repositories = useRepositories();
  const status = useRepositoryStatus(activeRepositoryId);
  const operations: OperationRecord[] = useActivity((state) => state.operations);
  const unseenFailures: number = useActivity((state) => state.unseenFailures);
  const activityOpen: boolean = usePreferences((state) => state.activityOpen);
  const setActivityOpen = usePreferences((state) => state.setActivityOpen);
  const repository: RepositoryEntry | undefined = repositories.data?.find((entry) => entry.id === activeRepositoryId);
  const running: number = runningCount(operations);
  const current: OperationRecord | undefined = operations.find((record) => record.outcome === "running");

  return (
    <footer
      aria-label="Status and operations"
      style={{ height: "var(--rg-shelf)" }}
      className="flex shrink-0 items-center gap-3 border-t border-border bg-sidebar px-2.5 text-xs text-fg-secondary"
    >
      {repository === undefined ? (
        <span className="text-fg-muted">No repository open</span>
      ) : (
        <>
          <span className="truncate font-medium text-fg">{repository.name}</span>
          <RepositoryState status={status.data} failed={status.isError} onShowChanges={() => showSection("changes")} />
        </>
      )}

      <span className="flex-1" />

      {current !== undefined && <RunningOperation record={current} more={running - 1} />}

      <button
        type="button"
        aria-pressed={activityOpen}
        aria-label={
          unseenFailures > 0 ? `Activity, ${unseenFailures} failed operation${unseenFailures === 1 ? "" : "s"}` : "Activity"
        }
        title={`Activity (${formatShortcut("Mod+J")})`}
        onClick={() => setActivityOpen(!activityOpen)}
        className={`flex h-5 items-center gap-1.5 rounded-sm px-1.5 hover:bg-hover hover:text-fg ${
          activityOpen ? "text-accent" : ""
        }`}
      >
        {unseenFailures > 0 && (
          <span className="flex items-center gap-1 text-danger">
            <CircleAlert aria-hidden className="size-3" />
            {unseenFailures} failed
          </span>
        )}
        <PanelBottom aria-hidden className="size-3.5" />
        Activity
      </button>
    </footer>
  );
}

function RepositoryState({
  status,
  failed,
  onShowChanges,
}: {
  status: StatusSnapshot | undefined;
  failed: boolean;
  onShowChanges: () => void;
}) {
  if (status === undefined) {
    return <span className="text-fg-muted">{failed ? "Status unavailable" : "Reading status…"}</span>;
  }
  const { branch } = status;
  const counts = countChanges(status.files);
  return (
    <>
      <span className="flex min-w-0 items-center gap-1 font-mono">
        <GitBranch aria-hidden className="size-3 shrink-0 text-accent" />
        <span className={`truncate ${branch.head === null ? "text-amber" : "text-fg"}`}>
          {branch.head ?? `detached at ${branch.oid?.slice(0, 7) ?? "?"}`}
        </span>
      </span>
      {branch.upstream === null ? (
        <span className="text-fg-muted">no upstream</span>
      ) : (
        <span
          className="flex items-center gap-1.5 font-mono tabular-nums"
          title={`Compared with ${branch.upstream} as of the last fetch`}
        >
          <span className={`flex items-center ${branch.ahead > 0 ? "text-accent" : "text-fg-muted"}`}>
            <ArrowUp aria-hidden className="size-3" />
            <span className="sr-only">ahead </span>
            {branch.ahead}
          </span>
          <span className={`flex items-center ${branch.behind > 0 ? "text-amber" : "text-fg-muted"}`}>
            <ArrowDown aria-hidden className="size-3" />
            <span className="sr-only">behind </span>
            {branch.behind}
          </span>
        </span>
      )}
      <button type="button" onClick={onShowChanges} className="rounded-sm px-1 hover:bg-hover hover:text-fg">
        {counts.conflicted > 0 ? (
          <span className="text-danger">{counts.conflicted} conflicted</span>
        ) : status.files.length === 0 ? (
          <span className="text-success">Working tree clean</span>
        ) : (
          <span>
            <span className="text-amber">{status.files.length}</span> changed
          </span>
        )}
      </button>
    </>
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
      {record.label}
      {seconds > 0 && <span className="font-mono tabular-nums text-fg-muted">{seconds}s</span>}
      {more > 0 && <span className="text-fg-muted">+{more} more</span>}
    </span>
  );
}
