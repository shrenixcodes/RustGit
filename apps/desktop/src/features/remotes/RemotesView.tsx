import { useState, type FormEvent } from "react";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { PageHeader } from "../../components/PageHeader";
import { networkActions } from "../../services/network";
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

  const run = (request: RemoteRequest, after?: () => void): void =>
    operation.mutate(request, {
      onSuccess: () => after?.(),
      onSettled: () => setRemoving(null),
    });

  const add = (event: FormEvent): void => {
    event.preventDefault();
    run({ kind: "add", name: name.trim(), url: url.trim() }, () => {
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
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6">
      <div className="max-w-2xl space-y-5">
        <p className="text-sm text-fg-muted">
          Git's credential helper authenticates network operations. When it has nothing, RustGit asks for the password or key passphrase and passes it straight to Git without storing it.
        </p>
        {remotes.isError && <ErrorNotice title="Could not list remotes" error={remotes.error} />}
        {remotes.data?.length === 0 && <p className="text-fg-muted">No remotes yet. Add one to fetch from it and push to it.</p>}

        <ul className="divide-y divide-divider">
          {remotes.data?.map((remote: Remote) => (
            <li key={remote.name} className="space-y-2 py-3">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-sm text-indigo-text">{remote.name}</span>
                <span className="flex-1" />
                <Button variant="ghost" disabled={fetching} onClick={() => actions.fetch(remote.name).catch(() => {})}>
                  Fetch
                </Button>
                <Button variant="ghost" disabled={operation.isPending} onClick={() => setRemoving(remote.name)}>
                  Remove…
                </Button>
              </div>
              <UrlLine
                remote={remote.name}
                label="fetch"
                url={remote.fetchUrl}
                onEdit={() => setEditing({ name: remote.name, push: false, url: remote.fetchUrl ?? "" })}
              />
              <UrlLine
                remote={remote.name}
                label="push"
                url={remote.pushUrl}
                same={remote.pushUrl === remote.fetchUrl}
                onEdit={() => setEditing({ name: remote.name, push: true, url: remote.pushUrl ?? remote.fetchUrl ?? "" })}
              />
              {editing?.name === remote.name && (
                <form onSubmit={saveUrl} className="flex items-center gap-2">
                  <label className="flex flex-1 items-center gap-2 border-b border-border focus-within:border-accent">
                    <span className="sr-only">{`New ${editing.push ? "push" : "fetch"} URL for ${remote.name}`}</span>
                    <input
                      autoFocus
                      value={editing.url}
                      onChange={(event) => setEditing({ ...editing, url: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          setEditing(null);
                        }
                      }}
                      className="h-7 flex-1 bg-transparent font-mono text-xs outline-none"
                    />
                  </label>
                  <Button type="submit" variant="primary" disabled={editing.url.trim() === "" || operation.isPending}>
                    Save {editing.push ? "push" : "fetch"} URL
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>

        <form onSubmit={add} aria-label="Add a remote" className="flex flex-wrap items-end gap-3">
          <label className="block w-32">
            <span className="rg-label">name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={remotes.data?.length === 0 ? "origin" : "upstream"}
              className="mt-1 h-8 w-full border-b border-border bg-transparent font-mono text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="block min-w-64 flex-1">
            <span className="rg-label">url</span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://github.com/owner/repository.git"
              className="mt-1 h-8 w-full border-b border-border bg-transparent font-mono text-sm outline-none focus:border-accent"
            />
          </label>
          <Button type="submit" variant="primary" disabled={name.trim() === "" || url.trim() === "" || operation.isPending}>
            Add remote
          </Button>
        </form>

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

function UrlLine({ remote, label, url, same = false, onEdit }: { remote: string; label: string; url: string | null; same?: boolean; onEdit: () => void }) {
  return (
    <p className="flex items-baseline gap-3 font-mono text-xs">
      <span className="w-10 shrink-0 text-fg-muted">{label}</span>
      <span data-selectable className="min-w-0 flex-1 truncate text-fg-secondary" title={url ?? undefined}>
        {url === null ? "not set" : same ? "same as fetch" : url}
      </span>
      <button type="button" aria-label={`Change ${label} URL of ${remote}`} onClick={onEdit} className="shrink-0 text-fg-muted hover:text-fg hover:underline">
        change…
      </button>
    </p>
  );
}
