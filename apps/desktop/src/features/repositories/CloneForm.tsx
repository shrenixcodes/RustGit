import { useState, type FormEvent } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { ipc, toIpcError, type IpcError } from "../../services/ipc";
import { cancelOperation, startOperation, whenFinished } from "../../services/network";
import { queryKeys } from "../../services/queries";
import type { OperationFinishedEvent, RepositoryEntry } from "../../services/types";
import { describeProgress, useOperations, type NetworkOperation } from "../../stores/operations";
import { useWorkspace } from "../../stores/workspace";
import { ProgressLine } from "../../app/ProgressLine";
import { GithubRepositoryPicker } from "./GithubRepositoryPicker";

/** The folder name Git would choose for a URL ("…/rustgit.git" → "rustgit"); only a placeholder. */
export function directoryNameFor(url: string): string {
  const trimmed: string = url.trim().replace(/[/\\]+$/, "");
  const last: string = trimmed.split(/[/\\:]/).pop() ?? "";
  return last.replace(/\.git$/i, "");
}

/**
 * Clone a repository: URL, parent folder, optional folder name. Progress
 * and cancel come from the backend operation; on success the new
 * repository (registered by the backend) opens.
 */
export function CloneForm({ onDone }: { onDone: () => void }) {
  const client: QueryClient = useQueryClient();
  const activate = useWorkspace((state) => state.openRepository);
  const [url, setUrl] = useState<string>("");
  const [parent, setParent] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [operationId, setOperationId] = useState<string | null>(null);
  const [error, setError] = useState<IpcError | null>(null);
  const operation: NetworkOperation | undefined = useOperations((state) =>
    operationId === null ? undefined : state.operations[operationId],
  );
  const running: boolean = operation?.outcome === "running";

  const pickParent = async (): Promise<void> => {
    const selected: string | string[] | null = await openDialog({ directory: true, multiple: false, title: "Clone into folder" });
    if (typeof selected === "string") setParent(selected);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    const directoryName: string | null = name.trim() === "" ? null : name.trim();
    let id: string;
    try {
      id = await startOperation({
        kind: "clone",
        label: `Clone ${url.trim()}`,
        repositoryId: null,
        start: () => ipc.startClone(url.trim(), parent, directoryName),
      });
    } catch (failure: unknown) {
      setError(toIpcError(failure));
      return;
    }
    setOperationId(id);
    const finished: OperationFinishedEvent = await whenFinished(id);
    if (finished.outcome === "succeeded" && finished.repositoryId !== null) {
      const list: RepositoryEntry[] = await client.fetchQuery({ queryKey: queryKeys.repositories, queryFn: ipc.listRepositories, staleTime: 0 });
      const entry: RepositoryEntry | undefined = list.find((candidate) => candidate.id === finished.repositoryId);
      if (entry !== undefined) {
        activate(entry.id, entry.path);
        onDone();
      }
    } else if (finished.outcome === "failed" && finished.error !== null) {
      setError(toIpcError(finished.error));
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Clone a repository" className="space-y-3.5 rounded-xl border border-border/80 bg-elevated/60 p-4 shadow-sm backdrop-blur-xs">
      <GithubRepositoryPicker
        onPick={(cloneUrl, repositoryName) => {
          setUrl(cloneUrl);
          setName(repositoryName);
        }}
      />
      <label className="block">
        <span className="rg-label">url</span>
        <input
          autoFocus
          required
          value={url}
          disabled={running}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://github.com/owner/repository.git"
          className="mt-1 flex h-9 w-full rounded-md border border-border/70 bg-canvas/60 px-3 font-mono text-xs outline-none transition-all placeholder:text-fg-muted/60 focus:border-accent focus:bg-canvas focus:ring-1 focus:ring-accent/30"
        />
      </label>
      <div className="flex items-end gap-3">
        <label className="block min-w-0 flex-1">
          <span className="rg-label">into folder</span>
          <input
            required
            value={parent}
            disabled={running}
            onChange={(event) => setParent(event.target.value)}
            placeholder="Choose a parent folder"
            className="mt-1 flex h-9 w-full rounded-md border border-border/70 bg-canvas/60 px-3 font-mono text-xs outline-none transition-all placeholder:text-fg-muted/60 focus:border-accent focus:bg-canvas focus:ring-1 focus:ring-accent/30"
          />
        </label>
        <Button disabled={running} onClick={() => void pickParent()}>
          Browse…
        </Button>
      </div>
      <label className="block">
        <span className="rg-label">folder name</span>
        <input
          value={name}
          disabled={running}
          onChange={(event) => setName(event.target.value)}
          placeholder={directoryNameFor(url) || "from the URL"}
          className="mt-1 flex h-9 w-full rounded-md border border-border/70 bg-canvas/60 px-3 font-mono text-xs outline-none transition-all placeholder:text-fg-muted/60 focus:border-accent focus:bg-canvas focus:ring-1 focus:ring-accent/30"
        />
      </label>

      {operation !== undefined && running && (
        <div role="status" className="space-y-1 font-mono text-xs text-fg-secondary">
          <p>{describeProgress(operation)}</p>
          <ProgressLine operation={operation} />
        </div>
      )}
      {operation?.outcome === "cancelled" && <p className="text-sm text-fg-muted">Clone cancelled. Git removed the partial folder.</p>}
      {error !== null && <ErrorNotice title="The clone did not complete" error={error} />}

      <div className="flex gap-2">
        {running && operationId !== null ? (
          <Button
            variant="danger"
            disabled={operation?.cancellable !== true}
            onClick={() => void cancelOperation(operationId)}
          >
            Cancel clone
          </Button>
        ) : (
          <Button type="submit" variant="primary" disabled={url.trim() === "" || parent.trim() === ""}>
            Clone
          </Button>
        )}
        {!running && (
          <Button variant="ghost" onClick={onDone}>
            Close
          </Button>
        )}
      </div>
    </form>
  );
}
