import { useEffect, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Copy, LoaderCircle, Terminal, Trash2, X } from "lucide-react";
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
      <section aria-label="Activity" style={{ height }} className="rg-drawer-anim flex shrink-0 flex-col bg-surface border-t border-divider">
        <header className="flex h-10 shrink-0 items-center gap-4 px-5 border-b border-divider/60 bg-canvas/30">
          <div className="flex items-center gap-2">
            <Terminal className="size-3.5 text-accent" />
            <h2 className="rg-label font-semibold text-fg">Activity log</h2>
          </div>
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
    return (
      <div className="rg-canvas flex flex-1 items-center justify-center text-xs text-fg-muted">
        No operations recorded in this session.
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol className="min-h-0 flex-1 divide-y divide-divider/40 overflow-y-auto px-5 font-mono text-xs">
        {operations.map((record: OperationRecord) => {
          const repoName = name(record.repositoryId);
          return (
            <li key={record.id} className="py-2 hover:bg-hover/40 px-2 rounded-lg transition-colors">
              <div className="flex items-center gap-3">
                <time dateTime={new Date(record.startedAt).toISOString()} className="w-16 shrink-0 tabular-nums text-2xs text-fg-muted/80">
                  {TIME_FORMAT.format(record.startedAt)}
                </time>

                <div className="flex w-20 shrink-0 items-center gap-1.5">
                  {record.outcome === "failed" ? (
                    <span className="flex items-center gap-1 rounded bg-danger/15 border border-danger/25 px-1.5 py-0.2 font-mono text-2xs font-semibold text-danger">
                      <AlertCircle className="size-2.5" /> failed
                    </span>
                  ) : record.outcome === "running" ? (
                    <span className="flex items-center gap-1 rounded bg-accent/15 border border-accent/25 px-1.5 py-0.2 font-mono text-2xs font-semibold text-accent">
                      <LoaderCircle className="size-2.5 animate-spin" /> running
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded bg-success/15 border border-success/25 px-1.5 py-0.2 font-mono text-2xs font-semibold text-success">
                      <CheckCircle2 className="size-2.5" /> done
                    </span>
                  )}
                </div>

                <span className="min-w-0 flex-1 truncate font-sans text-xs font-medium text-fg">{record.label}</span>

                {repoName !== null && (
                  <span className="rounded bg-canvas/80 border border-border/60 px-1.5 py-0.5 font-mono text-2xs text-fg-muted truncate max-w-[120px]">
                    {repoName}
                  </span>
                )}

                <span className="w-16 shrink-0 text-right tabular-nums text-2xs font-mono text-fg-muted">
                  {record.finishedAt === null ? "…" : formatDuration(record.finishedAt - record.startedAt)}
                </span>
              </div>

              {record.error !== null && (
                <div className="mt-1.5 ml-20 rounded border border-danger/30 bg-danger/5 p-2 font-mono text-2xs text-danger leading-relaxed">
                  <span className="font-semibold text-danger/90">{record.error.kind}: </span>
                  <span data-selectable className="whitespace-pre-wrap break-words">{record.error.message}</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex justify-end border-t border-divider/60 bg-canvas/30 px-4 py-1.5">
        <Button
          variant="ghost"
          onClick={clear}
          disabled={operations.every((record) => record.outcome === "running")}
          className="h-6 text-xs text-fg-muted hover:text-fg"
        >
          <Trash2 className="size-3 mr-1" />
          Clear log
        </Button>
      </div>
    </div>
  );
}

function CommandsView() {
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const history = useCommandHistory(activeRepositoryId, true);
  const [copiedSeq, setCopiedSeq] = useState<number | null>(null);

  const copyCommand = (seq: number, commandStr: string) => {
    void navigator.clipboard?.writeText(commandStr).then(() => {
      setCopiedSeq(seq);
      setTimeout(() => setCopiedSeq(null), 1500);
    });
  };

  if (history.isPending) {
    return <p className="px-5 py-4 text-xs text-fg-muted">Reading command history…</p>;
  }
  if (history.isError) {
    return (
      <div className="p-4">
        <ErrorNotice title="Could not read command history" error={history.error} />
      </div>
    );
  }
  const records: CommandRecord[] = [...history.data].reverse();
  if (records.length === 0) {
    return (
      <div className="rg-canvas flex flex-1 items-center justify-center text-xs text-fg-muted">
        No Git commands recorded for this repository.
      </div>
    );
  }
  return (
    <ol aria-label="Git commands" className="min-h-0 flex-1 divide-y divide-divider/40 overflow-y-auto px-5 font-mono text-xs">
      {records.map((record: CommandRecord) => {
        const failed: boolean = record.exitCode !== 0;
        const cmdStr = `git ${record.args.join(" ")}`;
        const isCopied = copiedSeq === record.sequence;
        return (
          <li key={record.sequence} className="py-2 hover:bg-hover/40 px-2 rounded-lg transition-colors group">
            <div className="flex items-center gap-3">
              <time dateTime={new Date(record.startedAt).toISOString()} className="w-16 shrink-0 tabular-nums text-2xs text-fg-muted/80">
                {TIME_FORMAT.format(record.startedAt)}
              </time>

              <span
                className={`w-16 shrink-0 rounded px-1.5 py-0.2 font-mono text-2xs font-semibold text-center ${
                  failed ? "bg-danger/15 border border-danger/25 text-danger" : "bg-canvas/80 border border-border/60 text-fg-muted"
                }`}
              >
                {record.exitCode === null ? "killed" : `exit ${record.exitCode}`}
              </span>

              <span data-selectable className="min-w-0 flex-1 truncate font-mono text-xs text-fg" title={`${record.cwd}\n${cmdStr}`}>
                <span className="text-accent font-semibold">git</span> {record.args.join(" ")}
              </span>

              <button
                type="button"
                onClick={() => copyCommand(record.sequence, cmdStr)}
                title={isCopied ? "Copied command" : "Copy command"}
                className="opacity-0 group-hover:opacity-100 rounded p-1 text-fg-muted hover:bg-hover hover:text-fg transition-opacity"
              >
                {isCopied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
              </button>

              <span className="w-16 shrink-0 text-right tabular-nums text-2xs font-mono text-fg-muted">
                {formatDuration(record.durationMs)}
              </span>
            </div>

            {failed && record.stderr !== "" && (
              <p data-selectable className="mt-1.5 ml-20 rounded border border-danger/30 bg-danger/5 p-2 font-mono text-2xs text-danger whitespace-pre-wrap break-words">
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
