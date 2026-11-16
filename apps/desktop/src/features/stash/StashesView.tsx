import { useState, type FormEvent } from "react";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { PageHeader } from "../../components/PageHeader";
import { useRepositoryStatus } from "../../services/queries";
import { useStashDetails, useStashes, useStashOperation, type StashOutcome } from "../../services/repositoryQueries";
import type { StashEntry, StashFile } from "../../services/types";
import { useWorkspace } from "../../stores/workspace";

/** Shelve and restore work: create a stash, inspect its files, apply, pop or drop it. */
export function StashesView() {
  const repositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Stash" visible />
      {repositoryId === null ? (
        <p className="px-8 text-fg-muted">Open a repository to use the stash.</p>
      ) : (
        <StashList repositoryId={repositoryId} />
      )}
    </div>
  );
}

export function stashLabel(entry: StashEntry): string {
  return `stash@{${entry.index}}`;
}

export function outcomeMessage(outcome: StashOutcome): string | null {
  if (outcome.kind !== "integration") return null;
  return outcome.result.outcome === "conflicts"
    ? `Applied with conflicts in ${outcome.result.conflicted.length} file(s). Resolve them at the loose end; the stash was kept.`
    : "Applied to the working tree.";
}

function StashList({ repositoryId }: { repositoryId: number }) {
  const stashes = useStashes(repositoryId);
  const status = useRepositoryStatus(repositoryId);
  const operation = useStashOperation(repositoryId);
  const [message, setMessage] = useState<string>("");
  const [includeUntracked, setIncludeUntracked] = useState<boolean>(false);
  const [open, setOpen] = useState<string | null>(null);
  const [dropping, setDropping] = useState<StashEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const hasChanges: boolean = (status.data?.files.length ?? 0) > 0;

  const create = (event: FormEvent): void => {
    event.preventDefault();
    setNotice(null);
    operation.mutate(
      { kind: "create", message: message.trim() === "" ? null : message.trim(), includeUntracked },
      { onSuccess: () => setMessage("") },
    );
  };

  const apply = (entry: StashEntry, pop: boolean): void => {
    setNotice(null);
    operation.mutate(
      { kind: "apply", oid: entry.oid, pop, label: stashLabel(entry) },
      { onSuccess: (outcome: StashOutcome) => setNotice(outcomeMessage(outcome)) },
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6">
      <div className="max-w-2xl space-y-5">
        <form onSubmit={create} aria-label="Stash changes" className="flex flex-wrap items-end gap-3">
          <label className="block min-w-64 flex-1">
            <span className="rg-label">message</span>
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="optional"
              className="mt-1 h-8 w-full border-b border-border bg-transparent text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="flex h-8 items-center gap-2 text-sm text-fg-secondary">
            <input type="checkbox" checked={includeUntracked} onChange={(event) => setIncludeUntracked(event.target.checked)} />
            Include untracked files
          </label>
          <Button type="submit" variant="primary" disabled={!hasChanges || operation.isPending}>
            Stash changes
          </Button>
        </form>
        {!hasChanges && status.isSuccess && <p className="text-sm text-fg-muted">The working tree is clean; there is nothing to stash.</p>}

        {notice !== null && (
          <p role="status" className="text-sm text-fg-secondary">
            {notice}
          </p>
        )}
        {operation.error !== null && <ErrorNotice title="Git did not change the stash" error={operation.error} />}
        {stashes.isError && <ErrorNotice title="Could not list stashes" error={stashes.error} />}
        {stashes.data?.length === 0 && <p className="text-fg-muted">No stashes.</p>}

        <ul className="divide-y divide-divider">
          {stashes.data?.map((entry: StashEntry) => (
            <li key={entry.oid} className="space-y-2 py-3">
              <div className="flex items-baseline gap-3">
                <button
                  type="button"
                  aria-expanded={open === entry.oid}
                  onClick={() => setOpen(open === entry.oid ? null : entry.oid)}
                  className="flex min-w-0 flex-1 items-baseline gap-3 text-left hover:underline"
                >
                  <span className="shrink-0 font-mono text-xs text-indigo-text">{stashLabel(entry)}</span>
                  <span className="min-w-0 truncate text-sm">{entry.message}</span>
                </button>
                <span className="shrink-0 font-mono text-xs text-fg-muted">{new Date(entry.createdAt * 1000).toLocaleString()}</span>
                <Button variant="ghost" disabled={operation.isPending} onClick={() => apply(entry, false)}>
                  Apply
                </Button>
                <Button variant="ghost" disabled={operation.isPending} onClick={() => apply(entry, true)}>
                  Pop
                </Button>
                <Button variant="ghost" disabled={operation.isPending} onClick={() => setDropping(entry)}>
                  Drop…
                </Button>
              </div>
              {open === entry.oid && <StashFiles repositoryId={repositoryId} oid={entry.oid} />}
            </li>
          ))}
        </ul>
      </div>

      {dropping !== null && (
        <ConfirmDialog
          title={`Drop ${stashLabel(dropping)}?`}
          confirmLabel="Drop stash"
          destructive
          busy={operation.isPending}
          onCancel={() => setDropping(null)}
          onConfirm={() =>
            operation.mutate({ kind: "drop", oid: dropping.oid, label: stashLabel(dropping) }, { onSettled: () => setDropping(null) })
          }
        >
          <p>
            Deletes “{dropping.message}”. Its changes are not applied anywhere; Git can only recover it from unreachable objects
            until they are garbage collected.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function StashFiles({ repositoryId, oid }: { repositoryId: number; oid: string }) {
  const details = useStashDetails(repositoryId, oid);
  if (details.isPending) return <p className="pl-4 text-xs text-fg-muted">Reading the stash…</p>;
  if (details.isError) return <ErrorNotice title="Could not read the stash" error={details.error} />;
  return (
    <ul aria-label="Files in the stash" className="space-y-0.5 pl-4 font-mono text-xs">
      {details.data.files.map((file: StashFile) => (
        <li key={file.path} className="flex gap-3">
          <span className="w-16 shrink-0 text-fg-muted">{file.untracked ? "untracked" : file.kind}</span>
          <span data-selectable className="min-w-0 truncate text-fg-secondary">
            {file.path}
          </span>
        </li>
      ))}
    </ul>
  );
}
