import { useState, type FormEvent } from "react";
import { Archive, ChevronDown, ChevronRight, FileCode, Plus, Trash2, ArrowUpFromLine } from "lucide-react";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EmptyState } from "../../components/EmptyState";
import { ErrorNotice } from "../../components/ErrorNotice";
import { Input } from "../../components/Input";
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
  const [message, setMessage] = useState<string>("" );
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
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
      <div className="max-w-3xl space-y-6">
        {/* Create Stash Card */}
        <div className="rounded-xl border border-border/80 bg-elevated/40 p-5 shadow-2xs">
          <h3 className="mb-3 flex items-center gap-2 font-medium text-xs text-fg">
            <Archive className="size-3.5 text-accent" /> Stash working changes
          </h3>
          <form onSubmit={create} aria-label="Stash changes" className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1">
                <span className="mb-1 block font-mono text-2xs text-fg-muted">Message (optional)</span>
                <Input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="WIP: feature description"
                />
              </div>
              <Button type="submit" variant="primary" disabled={!hasChanges || operation.isPending}>
                <Plus className="size-3.5 mr-1" />
                Stash changes
              </Button>
            </div>
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-fg-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeUntracked}
                  onChange={(event) => setIncludeUntracked(event.target.checked)}
                  className="rounded border-border text-accent focus:ring-accent"
                />
                <span>Include untracked files in stash</span>
              </label>
              {!hasChanges && status.isSuccess && (
                <span className="font-mono text-2xs text-fg-muted">Working tree is clean; nothing to stash</span>
              )}
            </div>
          </form>
        </div>

        {notice !== null && (
          <div role="status" className="rounded-lg border border-accent/30 bg-accent/10 p-3 text-xs text-fg font-medium">
            {notice}
          </div>
        )}
        {operation.error !== null && <ErrorNotice title="Git did not change the stash" error={operation.error} />}
        {stashes.isError && <ErrorNotice title="Could not list stashes" error={stashes.error} />}

        {stashes.data?.length === 0 && (
          <EmptyState
            icon={Archive}
            title="No stashed changes"
            description="Use stash to temporarily shelve your uncommitted work when you need to switch branches or pull upstream changes."
          />
        )}

        {stashes.data !== undefined && stashes.data.length > 0 && (
          <div className="space-y-3">
            <h2 className="rg-label">Saved stashes ({stashes.data.length})</h2>
            <div className="grid gap-3">
              {stashes.data.map((entry: StashEntry) => {
                const isOpen = open === entry.oid;
                return (
                  <div
                    key={entry.oid}
                    className="group rounded-xl border border-border/80 bg-elevated/50 p-4 shadow-2xs transition-all hover:border-border-control hover:bg-elevated/70"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : entry.oid)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none"
                      >
                        {isOpen ? (
                          <ChevronDown className="size-4 shrink-0 text-accent transition-transform" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-fg-muted transition-transform group-hover:text-fg" />
                        )}
                        <span className="shrink-0 rounded bg-indigo/15 border border-indigo/25 px-2 py-0.5 font-mono text-xs font-semibold text-indigo-text">
                          {stashLabel(entry)}
                        </span>
                        <span className="min-w-0 truncate text-xs font-medium text-fg">{entry.message}</span>
                      </button>

                      <div className="flex items-center gap-2">
                        <span className="font-mono text-2xs text-fg-muted/80 tabular-nums">
                          {new Date(entry.createdAt * 1000).toLocaleString()}
                        </span>
                        <div className="flex items-center gap-1 border-l border-divider pl-2">
                          <Button
                            variant="ghost"
                            disabled={operation.isPending}
                            onClick={() => apply(entry, false)}
                            title="Apply changes to working tree and keep stash"
                            className="h-7 text-xs"
                          >
                            Apply
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={operation.isPending}
                            onClick={() => apply(entry, true)}
                            title="Apply changes and drop this stash"
                            className="h-7 text-xs text-accent"
                          >
                            <ArrowUpFromLine className="size-3 mr-1" />
                            Pop
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={operation.isPending}
                            onClick={() => setDropping(entry)}
                            title="Delete this stash permanently"
                            className="h-7 text-xs text-danger/80 hover:bg-danger/10 hover:text-danger"
                          >
                            <Trash2 className="size-3 mr-1" />
                            Drop…
                          </Button>
                        </div>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-3.5 border-t border-divider/80 pt-3">
                        <StashFiles repositoryId={repositoryId} oid={entry.oid} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
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
    <div className="space-y-1.5 pl-2 font-mono text-xs">
      <div className="text-2xs font-semibold text-fg-muted tracking-wider uppercase mb-2">
        {details.data.files.length} file{details.data.files.length === 1 ? "" : "s"} in stash:
      </div>
      <ul aria-label="Files in the stash" className="space-y-1 rounded-lg border border-border/60 bg-canvas/60 p-2.5">
        {details.data.files.map((file: StashFile) => (
          <li key={file.path} className="flex items-center gap-2.5 py-0.5">
            <FileCode className="size-3 text-fg-muted" />
            <span className={`w-16 shrink-0 text-2xs font-semibold ${file.untracked ? "text-moss" : "text-accent"}`}>
              {file.untracked ? "untracked" : file.kind}
            </span>
            <span data-selectable className="min-w-0 truncate text-fg-secondary">
              {file.path}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
