import { useState, type FormEvent } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { toIpcError, type IpcError } from "../../services/ipc";
import { useInitRepository } from "../../services/queries";
import type { RepositoryEntry } from "../../services/types";
import { useWorkspace } from "../../stores/workspace";

/** Why a folder name cannot be used, or null when it is fine. */
export function folderNameProblem(name: string): string | null {
  const trimmed: string = name.trim();
  if (trimmed === "") return null;
  if (trimmed === "." || trimmed === "..") return "Use a real folder name.";
  if (/[\\/:*?"<>|\0]/.test(trimmed)) return 'The name cannot contain any of \\ / : * ? " < > |';
  if (/[. ]$/.test(trimmed)) return "The name cannot end with a dot or a space.";
  return null;
}

/** The path of the new repository: the parent folder plus the name, using the parent's separator. */
export function newRepositoryPath(parent: string, name: string): string {
  const separator: string = parent.includes("\\") ? "\\" : "/";
  return `${parent.replace(/[/\\]+$/, "")}${separator}${name.trim()}`;
}

/**
 * Create a repository: a name and the folder to put it in. The folder is
 * created when it does not exist and `git init` runs in it; failures stay
 * visible in the form.
 */
export function NewRepositoryForm({ onDone }: { onDone: () => void }) {
  const initRepository = useInitRepository();
  const activate = useWorkspace((state) => state.openRepository);
  const [name, setName] = useState<string>("");
  const [parent, setParent] = useState<string>("");
  const [error, setError] = useState<IpcError | null>(null);
  const problem: string | null = folderNameProblem(name);
  const ready: boolean = name.trim() !== "" && parent.trim() !== "" && problem === null;

  const pickParent = async (): Promise<void> => {
    const selected: string | string[] | null = await openDialog({ directory: true, multiple: false, title: "Folder for the new repository" });
    if (typeof selected === "string") setParent(selected);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!ready) return;
    setError(null);
    try {
      const created: RepositoryEntry = await initRepository.mutateAsync(newRepositoryPath(parent.trim(), name));
      activate(created.id, created.path);
      onDone();
    } catch (failure: unknown) {
      setError(toIpcError(failure));
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Create a repository" className="space-y-3 border-l-2 border-accent py-1 pl-4">
      <label className="block">
        <span className="rg-label">name</span>
        <input
          autoFocus
          required
          value={name}
          disabled={initRepository.isPending}
          onChange={(event) => setName(event.target.value)}
          placeholder="my-project"
          aria-invalid={problem !== null}
          className="mt-1 h-8 w-full border-b border-border bg-transparent font-mono text-sm outline-none focus:border-accent"
        />
        {problem !== null && <span className="mt-1 block text-xs text-danger">{problem}</span>}
      </label>
      <div className="flex items-end gap-3">
        <label className="block min-w-0 flex-1">
          <span className="rg-label">in folder</span>
          <input
            required
            value={parent}
            disabled={initRepository.isPending}
            onChange={(event) => setParent(event.target.value)}
            placeholder="Choose a parent folder"
            className="mt-1 h-8 w-full border-b border-border bg-transparent font-mono text-sm outline-none focus:border-accent"
          />
        </label>
        <Button disabled={initRepository.isPending} onClick={() => void pickParent()}>
          Browse…
        </Button>
      </div>
      {ready && (
        <p className="break-all font-mono text-xs text-fg-secondary">
          Creates {newRepositoryPath(parent.trim(), name)} with an initial branch named main.
        </p>
      )}
      {error !== null && <ErrorNotice title="Could not create the repository" error={error} />}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!ready || initRepository.isPending}>
          Create repository
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Close
        </Button>
      </div>
    </form>
  );
}
