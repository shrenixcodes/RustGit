import { useState, type FormEvent } from "react";
import { Copy, Check, Globe, Plus, RefreshCw, Trash2, Edit2, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EmptyState } from "../../components/EmptyState";
import { ErrorNotice } from "../../components/ErrorNotice";
import { Input } from "../../components/Input";
import { PageHeader } from "../../components/PageHeader";
import { networkActions } from "../../services/network";
import { useRepositories } from "../../services/queries";
import { PublishToGithub } from "./PublishToGithub";
import { useRemoteOperation, useRemotes, type RemoteRequest } from "../../services/repositoryQueries";
import type { Remote } from "../../services/types";
import { runningOperations, useOperations } from "../../stores/operations";
import { useWorkspace } from "../../stores/workspace";

/** The repository's remotes: add, change URLs, remove, fetch one. URLs come back from the backend with credentials redacted. */
export function RemotesView() {
  const repositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Remotes" visible />
      {repositoryId === null ? (
        <p className="px-8 text-fg-muted">Open a repository to manage its remotes.</p>
      ) : (
        <RemotesList repositoryId={repositoryId} />
      )}
    </div>
  );
}

function RemotesList({ repositoryId }: { repositoryId: number }) {
  const remotes = useRemotes(repositoryId);
  const operation = useRemoteOperation(repositoryId);
  const operations = useOperations((state) => state.operations);
  const fetching: boolean = runningOperations(operations, repositoryId).some((op) => op.kind === "fetch");
  const [editing, setEditing] = useState<{ name: string; push: boolean; url: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  const [url, setUrl] = useState<string>("");
  const actions = networkActions(repositoryId);
  const repositoryPath: string | undefined = useRepositories().data?.find((entry) => entry.id === repositoryId)?.path;
  const defaultName: string = (repositoryPath ?? "").replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";

  const run = (request: RemoteRequest, after?: () => void): void =>
    operation.mutate(request, {
      onSuccess: () => after?.(),
      onSettled: () => setRemoving(null),
    });

  // A blank name uses the suggestion shown as the placeholder.
  const suggestedName: string = remotes.data?.length === 0 ? "origin" : "upstream";

  const add = (event: FormEvent): void => {
    event.preventDefault();
    run({ kind: "add", name: name.trim() || suggestedName, url: url.trim() }, () => {
      setName("");
      setUrl("");
    });
  };

  const saveUrl = (event: FormEvent): void => {
    event.preventDefault();
    if (editing === null) return;
    run({ kind: "set_url", name: editing.name, url: editing.url.trim(), push: editing.push }, () => setEditing(null));
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
      <div className="space-y-6">
        <div className="rounded-xl border border-border/70 bg-canvas/40 p-4 text-xs text-fg-muted leading-relaxed">
          Git's credential helper authenticates network operations. When no stored credentials exist, RustGit asks for the password or key passphrase and passes it directly to Git without storing secrets.
        </div>

        {remotes.isError && <ErrorNotice title="Could not list remotes" error={remotes.error} />}

        {remotes.data?.length === 0 && (
          <EmptyState
            icon={Globe}
            title="No remotes configured"
            description="Add a remote repository URL to synchronize, pull latest changes, and push your commits."
          />
        )}

        {remotes.data !== undefined && remotes.data.length > 0 && (
          <div className="space-y-3">
            <h2 className="rg-label">Configured remotes ({remotes.data.length})</h2>
            <div className="grid gap-3">
              {remotes.data.map((remote: Remote) => (
                <div
                  key={remote.name}
                  className="group relative flex flex-col gap-3 rounded-xl border border-border/80 bg-elevated/50 p-4 shadow-2xs transition-all hover:border-border-control hover:bg-elevated/70"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-7 items-center justify-center rounded-lg border border-indigo/20 bg-indigo/10 text-indigo-text">
                        <Globe aria-hidden className="size-3.5" />
                      </div>
                      <span className="font-mono text-sm font-semibold text-fg">{remote.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        disabled={fetching}
                        onClick={() => actions.fetch(remote.name).catch(() => {})}
                        className="h-7 text-xs"
                      >
                        <RefreshCw aria-hidden className={`size-3 mr-1 ${fetching ? "motion-safe:animate-spin" : ""}`} />
                        Fetch
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={operation.isPending}
                        onClick={() => setRemoving(remote.name)}
                        className="h-7 text-xs text-danger/80 hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 aria-hidden className="size-3 mr-1" />
                        Remove…
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5 rounded-lg border border-border/60 bg-canvas/50 p-3 font-mono text-xs">
                    <UrlLine
                      remote={remote.name}
                      label="fetch"
                      icon={<ArrowDownLeft className="size-3 text-accent" />}
                      url={remote.fetchUrl}
                      onEdit={() => setEditing({ name: remote.name, push: false, url: remote.fetchUrl ?? "" })}
                    />
                    <UrlLine
                      remote={remote.name}
                      label="push"
                      icon={<ArrowUpRight className="size-3 text-clay-text" />}
                      url={remote.pushUrl}
                      same={remote.pushUrl === remote.fetchUrl}
                      onEdit={() => setEditing({ name: remote.name, push: true, url: remote.pushUrl ?? remote.fetchUrl ?? "" })}
                    />
                  </div>

                  {editing?.name === remote.name && (
                    <form onSubmit={saveUrl} className="flex items-center gap-2 pt-1">
                      <div className="flex-1">
                        <Input
                          autoFocus
                          value={editing.url}
                          onChange={(event) => setEditing({ ...editing, url: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.stopPropagation();
                              setEditing(null);
                            }
                          }}
                          placeholder={`New ${editing.push ? "push" : "fetch"} URL`}
                        />
                      </div>
                      <Button type="submit" variant="primary" disabled={editing.url.trim() === "" || operation.isPending}>
                        Save {editing.push ? "push" : "fetch"} URL
                      </Button>
                      <Button variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {remotes.data?.length === 0 && <PublishToGithub repositoryId={repositoryId} defaultName={defaultName} />}

        {/* Add Remote Card */}
        <div className="rounded-xl border border-border/80 bg-elevated/40 p-5 shadow-2xs">
          <h3 className="mb-3 flex items-center gap-2 font-medium text-xs text-fg">
            <Plus className="size-3.5 text-accent" /> Add new remote
          </h3>
          <form onSubmit={add} aria-label="Add a remote" className="flex flex-wrap items-end gap-3">
            <div className="w-36">
              <span className="mb-1 block font-mono text-2xs text-fg-muted">Remote name</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={suggestedName}
              />
            </div>
            <div className="min-w-64 flex-1">
              <span className="mb-1 block font-mono text-2xs text-fg-muted">Remote URL</span>
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/owner/repository.git"
              />
            </div>
            <Button type="submit" variant="primary" disabled={url.trim() === "" || operation.isPending}>
              Add remote
            </Button>
          </form>
        </div>

        {operation.error !== null && <ErrorNotice title="Git did not change the remote" error={operation.error} />}
      </div>

      {removing !== null && (
        <ConfirmDialog
          title={`Remove remote ${removing}?`}
          confirmLabel="Remove remote"
          destructive
          busy={operation.isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => run({ kind: "remove", name: removing })}
        >
          <p>
            Removes {removing} from this repository's configuration and deletes its remote-tracking branches here. Nothing is
            deleted on the remote, and local branches stay; they stop tracking {removing}.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function UrlLine({
  remote,
  label,
  icon,
  url,
  same = false,
  onEdit,
}: {
  remote: string;
  label: string;
  icon?: React.ReactNode;
  url: string | null;
  same?: boolean;
  onEdit: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyUrl = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex w-14 shrink-0 items-center gap-1.5 font-medium text-fg-muted">
        {icon}
        <span>{label}</span>
      </span>
      <span data-selectable className="min-w-0 flex-1 truncate font-mono text-fg-secondary" title={url ?? undefined}>
        {url === null ? <span className="italic text-fg-muted">not set</span> : same ? <span className="text-fg-muted">same as fetch</span> : url}
      </span>
      {url && !same && (
        <button
          type="button"
          onClick={() => copyUrl(url)}
          title={copied ? "Copied URL" : "Copy URL"}
          className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
        >
          {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
        </button>
      )}
      <button
        type="button"
        aria-label={`Change ${label} URL of ${remote}`}
        onClick={onEdit}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-fg-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <Edit2 className="size-2.5" />
        <span>change…</span>
      </button>
    </div>
  );
}
