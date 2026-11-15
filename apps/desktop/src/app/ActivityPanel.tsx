import { useEffect } from "react";
import { CircleCheck, CircleX, LoaderCircle, X } from "lucide-react";
import { Button, IconButton } from "../components/Button";
import { Splitter } from "../components/Splitter";
import { useRepositories } from "../services/queries";
import type { RepositoryEntry } from "../services/types";
import { useActivity, type OperationRecord } from "../stores/activity";
import { usePreferences } from "../stores/preferences";

/** Chronological list of operations the UI invoked and their actual outcomes. */
export function ActivityPanel() {
  const operations: OperationRecord[] = useActivity((state) => state.operations);
  const markSeen = useActivity((state) => state.markSeen);
  const clear = useActivity((state) => state.clear);
  const height: number = usePreferences((state) => state.sizes.activity);
  const setActivityOpen = usePreferences((state) => state.setActivityOpen);
  const repositories = useRepositories();
  const unseenFailures: number = useActivity((state) => state.unseenFailures);

  // Failures are "seen" while the panel is open.
  useEffect(() => {
    if (unseenFailures > 0) {
      markSeen();
    }
  }, [unseenFailures, markSeen]);

  const repositoryName = (id: number | null): string | null =>
    id === null ? null : (repositories.data?.find((entry: RepositoryEntry) => entry.id === id)?.name ?? null);

  return (
    <>
      <Splitter panel="activity" label="Resize activity panel" grows="up" />
      <section aria-label="Activity" style={{ height }} className="flex shrink-0 flex-col bg-surface">
        <header className="flex h-8 shrink-0 items-center gap-3 border-b border-divider px-3">
          <h2 className="rg-label">Activity</h2>
          <p className="truncate text-xs text-fg-muted">
            Operations started in RustGit this session. Git command details are not available yet.
          </p>
          <span className="flex-1" />
          <Button variant="ghost" onClick={clear} disabled={operations.every((record) => record.outcome === "running")}>
            Clear
          </Button>
          <IconButton label="Close activity panel" shortcut="Mod+J" onClick={() => setActivityOpen(false)}>
            <X aria-hidden className="size-3.5" />
          </IconButton>
        </header>
        {operations.length === 0 ? (
          <p className="rg-grid flex flex-1 items-center justify-center text-fg-muted">No operations yet.</p>
        ) : (
          <ol className="min-h-0 flex-1 overflow-y-auto font-mono text-xs">
            {operations.map((record: OperationRecord) => (
              <ActivityRow key={record.id} record={record} repositoryName={repositoryName(record.repositoryId)} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

const TIME_FORMAT: Intl.DateTimeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function ActivityRow({ record, repositoryName }: { record: OperationRecord; repositoryName: string | null }) {
  const duration: string | null =
    record.finishedAt === null ? null : formatDuration(record.finishedAt - record.startedAt);
  return (
    <li className="border-b border-divider px-3 py-1 last:border-b-0">
      <div className="rg-row flex items-center gap-3">
        <time dateTime={new Date(record.startedAt).toISOString()} className="shrink-0 tabular-nums text-fg-muted">
          {TIME_FORMAT.format(record.startedAt)}
        </time>
        <Outcome record={record} />
        <span className="min-w-0 flex-1 truncate font-sans text-sm text-fg">{record.label}</span>
        {repositoryName !== null && <span className="truncate text-fg-muted">{repositoryName}</span>}
        <span className="w-16 shrink-0 text-right tabular-nums text-fg-muted">{duration ?? "…"}</span>
      </div>
      {record.error !== null && (
        <p data-selectable className="whitespace-pre-wrap break-words pb-1 pl-[76px] text-danger">
          <span className="text-fg-muted">{record.error.kind}: </span>
          {record.error.message}
        </p>
      )}
    </li>
  );
}

function Outcome({ record }: { record: OperationRecord }) {
  switch (record.outcome) {
    case "running":
      return (
        <span className="flex w-20 shrink-0 items-center gap-1 text-accent">
          <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /> running
        </span>
      );
    case "succeeded":
      return (
        <span className="flex w-20 shrink-0 items-center gap-1 text-success">
          <CircleCheck aria-hidden className="size-3" /> done
        </span>
      );
    case "failed":
      return (
        <span className="flex w-20 shrink-0 items-center gap-1 text-danger">
          <CircleX aria-hidden className="size-3" /> failed
        </span>
      );
  }
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.max(0, Math.round(milliseconds))} ms`;
  }
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 2 : 1)} s`;
}
