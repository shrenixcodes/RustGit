import { useState, type FormEvent } from "react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { ipc, toIpcError, type IpcError } from "../../services/ipc";
import { useGithubStatus } from "../../services/github";
import { networkActions } from "../../services/network";
import { useRemoteOperation, useRemotes } from "../../services/repositoryQueries";

/** A GitHub repository name: letters, digits, dot, dash and underscore only. */
export function githubNameProblem(name: string): string | null {
  const trimmed: string = name.trim();
  if (trimmed === "") return null;
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return "Use letters, digits, dots, dashes and underscores only.";
  if (trimmed === "." || trimmed === "..") return "Use a real repository name.";
  return null;
}

/**
 * Creates a repository on GitHub, adds it as a remote and pushes the current
 * branch with upstream tracking. Each step is a normal RustGit operation, so
 * progress and failures show in the shelf and the activity log.
 */
export function PublishToGithub({ repositoryId, defaultName }: { repositoryId: number; defaultName: string }) {
  const status = useGithubStatus();
  const remotes = useRemotes(repositoryId);
  const addRemote = useRemoteOperation(repositoryId);
  const [name, setName] = useState<string>(defaultName);
  const [description, setDescription] = useState<string>("");
  const [isPrivate, setIsPrivate] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<IpcError | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (status.data?.account == null) return null;
  const problem: string | null = githubNameProblem(name);
  const ready: boolean = name.trim() !== "" && problem === null && !busy;
  const taken: Set<string> = new Set((remotes.data ?? []).map((remote) => remote.name));
  const remoteName: string = taken.has("origin") ? "github" : "origin";

  const publish = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const created = await ipc.githubCreateRepository(name.trim(), isPrivate, description.trim() || undefined);
      await addRemote.mutateAsync({ kind: "add", name: remoteName, url: created.cloneUrl });
      await networkActions(repositoryId).push({ remote: remoteName, branch: null, setUpstream: true, forceWithLease: false });
      setDone(created.fullName);
    } catch (cause: unknown) {
      setError(toIpcError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void publish(event)} aria-label="Publish to GitHub" className="space-y-3 border-l-2 border-accent py-1 pl-4">
      <p className="text-sm text-fg-secondary">
        Create <span className="font-mono">{status.data.account.login}/{name.trim() || "…"}</span> on GitHub, add it as{" "}
        <span className="font-mono">{remoteName}</span> and push this branch.
      </p>
      <label className="block">
        <span className="rg-label">repository name</span>
        <input
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={problem !== null}
          className="mt-1 h-8 w-full border-b border-border bg-transparent font-mono text-sm outline-none focus:border-accent"
        />
        {problem !== null && <span className="mt-1 block text-xs text-danger">{problem}</span>}
      </label>
      <label className="block">
        <span className="rg-label">description (optional)</span>
        <input
          value={description}
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Short description of the repository"
          className="mt-1 h-8 w-full border-b border-border bg-transparent font-sans text-sm outline-none focus:border-accent"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isPrivate} disabled={busy} onChange={(event) => setIsPrivate(event.target.checked)} />
        Private repository
      </label>
      {error !== null && <ErrorNotice title="Could not publish to GitHub" error={error} />}
      {done !== null && <p className="text-sm text-fg-secondary">Created {done}. The push is running; follow it in the shelf.</p>}
      <Button type="submit" variant="primary" disabled={!ready}>
        Publish to GitHub
      </Button>
    </form>
  );
}
