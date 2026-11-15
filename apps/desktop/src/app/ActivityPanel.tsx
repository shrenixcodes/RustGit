import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button, IconButton } from "../components/Button";
import { ErrorNotice } from "../components/ErrorNotice";
import { SegmentedControl, type SegmentOption } from "../components/SegmentedControl";
import { Splitter } from "../components/Splitter";
import { useCommandHistory, useRepositories } from "../services/queries";
import type { CommandRecord, RepositoryEntry } from "../services/types";
import { useActivity, type OperationRecord } from "../stores/activity";
import { usePreferences } from "../stores/preferences";
import { useWorkspace } from "../stores/workspace";

type View = "operations" | "commands";

const VIEWS: readonly SegmentOption<View>[] = [
  { value: "operations", label: "Operations" },
  { value: "commands", label: "Git commands" },
];

/**
 * The operation center, expanded: operations the UI started with their real
 * outcome, and the Git commands the backend ran (redacted by the backend).
 */
export function ActivityPanel() {
  const [view, setView] = useState<View>("operations");
  const height: number = usePreferences((state) => state.sizes.activity);
  const setActivityOpen = usePreferences((state) => state.setActivityOpen);
  const unseenFailures: number = useActivity((state) => state.unseenFailures);
  const markSeen = useActivity((state) => state.markSeen);

  // Failures are "seen" while the panel is open.
  useEffect(() => {
    if (unseenFailures > 0) markSeen();
  }, [unseenFailures, markSeen]);

  return (
    <>
      <Splitter panel="activity" label="Resize activity panel" grows="up" />
      <section aria-label="Activity" style={{ height }} className="flex shrink-0 flex-col bg-surface">
        <header className="flex h-9 shrink-0 items-center gap-4 px-5">
          <h2 className="rg-label">activity</h2>
          <SegmentedControl label="Activity view" options={VIEWS} value={view} onChange={setView} />
          <span className="flex-1" />
          <IconButton label="Close activity panel" shortcut="Mod+J" onClick={() => setActivityOpen(false)}>
            <X aria-hidden className="size-3.5" />
          </IconButton>
        </header>
        {view === "operations" ? <OperationsView /> : <CommandsView />}
      </section>
    </>
  );
}

const TIME_FORMAT: Intl.DateTimeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function OperationsView() {
  const operations: OperationRecord[] = useActivity((state) => state.operations);
  const clear = useActivity((state) => state.clear);
  const repositories = useRepositories();
  const name = (id: number | null): string | null =>
    id === null ? null : (repositories.data?.find((entry: RepositoryEntry) => entry.id === id)?.name ?? null);

  if (operations.length === 0) {
    return <p className="rg-canvas flex flex-1 items-center justify-center text-fg-muted">No operations yet.</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol className="min-h-0 flex-1 overflow-y-auto px-5 font-mono text-xs">
        {operations.map((record: OperationRecord) => (
          <li key={record.id} className="py-1">
            <div className="flex items-center gap-4">
              <time dateTime={new Date(record.startedAt).toISOString()} className="w-20 shrink-0 tabular-nums text-fg-muted">
                {TIME_FORMAT.format(record.startedAt)}
              </time>
              <span
                className={`w-14 shrink-0 ${
                  record.outcome === "failed" ? "text-danger" : record.outcome === "running" ? "text-accent" : "text-success"
                }`}
              >
                {record.outcome === "succeeded" ? "done" : record.outcome}
              </span>
              <span className="min-w-0 flex-1 truncate font-sans text-sm text-fg">{record.label}</span>
              {name(record.repositoryId) !== null && <span className="truncate text-fg-muted">{name(record.repositoryId)}</span>}
              <span className="w-16 shrink-0 text-right tabular-nums text-fg-muted">
                {record.finishedAt === null ? "…" : formatDuration(record.finishedAt - record.startedAt)}
              </span>
            </div>
            {record.error !== null && (
              <p data-selectable className="whitespace-pre-wrap break-words pl-[136px] text-danger">
                <span className="text-fg-muted">{record.error.kind}: </span>
                {record.error.message}
              </p>
            )}
          </li>
        ))}
      </ol>
      <div className="flex justify-end px-3 pb-1">
        <Button variant="ghost" onClick={clear} disabled={operations.every((record) => record.outcome === "running")}>
          Clear
        </Button>
      </div>
    </div>
  );
}

function CommandsView() {
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const history = useCommandHistory(activeRepositoryId, true);
  if (history.isPending) {
    return <p className="px-5 py-2 text-fg-muted">Reading command history…</p>;
  }
  if (history.isError) {
    return (
      <div className="p-3">
        <ErrorNotice title="Could not read command history" error={history.error} />
      </div>
    );
  }
  const records: CommandRecord[] = [...history.data].reverse();
  if (records.length === 0) {
    return <p className="rg-canvas flex flex-1 items-center justify-center text-fg-muted">No Git commands recorded for this repository.</p>;
  }
  return (
    <ol aria-label="Git commands" className="min-h-0 flex-1 overflow-y-auto px-5 font-mono text-xs">
      {records.map((record: CommandRecord) => {
        const failed: boolean = record.exitCode !== 0;
        return (
          <li key={record.sequence} className="py-1">
            <div className="flex items-center gap-4">
              <time dateTime={new Date(record.startedAt).toISOString()} className="w-20 shrink-0 tabular-nums text-fg-muted">
                {TIME_FORMAT.format(record.startedAt)}
              </time>
              <span className={`w-14 shrink-0 ${failed ? "text-danger" : "text-fg-muted"}`}>
                {record.exitCode === null ? "killed" : `exit ${record.exitCode}`}
              </span>
              <span data-selectable className="min-w-0 flex-1 truncate text-fg" title={`${record.cwd}\ngit ${record.args.join(" ")}`}>
                git {record.args.join(" ")}
              </span>
              <span className="w-16 shrink-0 text-right tabular-nums text-fg-muted">{formatDuration(record.durationMs)}</span>
            </div>
            {failed && record.stderr !== "" && (
              <p data-selectable className="whitespace-pre-wrap break-words pl-[136px] text-danger">
                {record.stderr}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.max(0, Math.round(milliseconds))} ms`;
  }
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 2 : 1)} s`;
}
