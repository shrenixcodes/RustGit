import { useState, type FormEvent } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { PageHeader } from "../../components/PageHeader";
import { useAddRepository } from "../../services/queries";
import { useWorktreeOperation, useWorktrees } from "../../services/repositoryQueries";
import type { RepositoryEntry, Worktree } from "../../services/types";
import { useUi } from "../../stores/ui";
import { useWorkspace } from "../../stores/workspace";

/** Linked working trees: add one on a branch, open it as a repository, remove or prune them. */
export function WorktreesView() {
  const repositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Worktrees" visible />
      {repositoryId === null ? (
        <p className="px-8 text-fg-muted">Open a repository to manage its worktrees.</p>
      ) : (
        <WorktreeList repositoryId={repositoryId} />
      )}
    </div>
  );
}

type BranchMode = "existing" | "new" | "detached";

export function worktreeTitle(worktree: Worktree): string {
  if (worktree.bare) return "bare";
  if (worktree.detached || worktree.branch === null) return `detached at ${worktree.head?.slice(0, 7) ?? "?"}`;
  return worktree.branch.replace(/^refs\/heads\//, "");
}

function WorktreeList({ repositoryId }: { repositoryId: number }) {
  const worktrees = useWorktrees(repositoryId);
  const operation = useWorktreeOperation(repositoryId);
  const addRepository = useAddRepository();
  const setSheet = useUi((state) => state.setSheet);
  const [path, setPath] = useState<string>("");
  const [mode, setMode] = useState<BranchMode>("new");
  const [branch, setBranch] = useState<string>("");
  const [removing, setRemoving] = useState<Worktree | null>(null);
  const [force, setForce] = useState<boolean>(false);

  const browse = async (): Promise<void> => {
    const selected: string | string[] | null = await openDialog({ directory: true, multiple: false, title: "Worktree folder" });
    if (typeof selected === "string") setPath(selected);
  };

  const add = (event: FormEvent): void => {
    event.preventDefault();
    const name: string | null = branch.trim() === "" ? null : branch.trim();
    operation.mutate(
      {
        kind: "add",
        path: path.trim(),
        branch: mode === "existing" ? name : null,
        newBranch: mode === "new" ? name : null,
        commit: mode === "detached" ? name : null,
      },
      {
        onSuccess: () => {
          setPath("");
          setBranch("");
        },
      },
    );
  };

  const openAsRepository = (worktree: Worktree): void => {
    addRepository.mutateAsync(worktree.path).then(
      (entry: RepositoryEntry) => {
        useWorkspace.getState().openRepository(entry.id, entry.path);
        setSheet(null);
      },
      () => {},
    );
  };

  const canAdd: boolean = path.trim() !== "" && (mode !== "new" || branch.trim() !== "") && !operation.isPending;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6">
      <div className="max-w-2xl space-y-5">
        {worktrees.isError && <ErrorNotice title="Could not list worktrees" error={worktrees.error} />}
        <ul className="divide-y divide-divider">
          {worktrees.data?.map((worktree: Worktree) => (
            <li key={worktree.path} className="space-y-1 py-3">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-sm text-indigo-text">{worktreeTitle(worktree)}</span>
                {worktree.isMain && <span className="rg-label">main</span>}
                {worktree.locked !== null && <span className="rg-label text-warning">locked{worktree.locked !== "" ? `: ${worktree.locked}` : ""}</span>}
                {worktree.prunable !== null && <span className="rg-label text-warning">prunable</span>}
                <span className="flex-1" />
                {!worktree.isMain && !worktree.bare && worktree.prunable === null && (
                  <Button variant="ghost" disabled={addRepository.isPending} onClick={() => openAsRepository(worktree)}>
                    Open
                  </Button>
                )}
                {!worktree.isMain && (
                  <Button
                    variant="ghost"
                    disabled={operation.isPending}
                    onClick={() => {
                      setForce(false);
                      setRemoving(worktree);
                    }}
                  >
                    Remove…
                  </Button>
                )}
              </div>
              <p data-selectable className="truncate font-mono text-xs text-fg-secondary" title={worktree.path}>
                {worktree.path}
              </p>
              {worktree.prunable !== null && <p className="text-xs text-fg-muted">{worktree.prunable}</p>}
            </li>
          ))}
        </ul>
        {worktrees.data?.some((worktree: Worktree) => worktree.prunable !== null) && (
          <Button variant="ghost" disabled={operation.isPending} onClick={() => operation.mutate({ kind: "prune" })}>
            Prune missing worktrees
          </Button>
        )}

        <form onSubmit={add} aria-label="Add a worktree" className="space-y-3">
          <div className="flex items-end gap-3">
            <label className="block min-w-64 flex-1">
              <span className="rg-label">folder</span>
              <input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="a new or empty folder"
                className="mt-1 h-8 w-full border-b border-border bg-transparent font-mono text-sm outline-none focus:border-accent"
              />
            </label>
            <Button variant="ghost" onClick={() => void browse()}>
              Browse…
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block w-40">
              <span className="rg-label">check out</span>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as BranchMode)}
                className="mt-1 h-8 w-full border-b border-border bg-bg text-sm outline-none focus:border-accent"
              >
                <option value="new">a new branch</option>
                <option value="existing">an existing branch</option>
                <option value="detached">a commit (detached)</option>
              </select>
            </label>
            <label className="block min-w-48 flex-1">
              <span className="rg-label">{mode === "detached" ? "commit (empty for HEAD)" : mode === "new" ? "new branch name" : "branch"}</span>
              <input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                className="mt-1 h-8 w-full border-b border-border bg-transparent font-mono text-sm outline-none focus:border-accent"
              />
            </label>
            <Button type="submit" variant="primary" disabled={!canAdd}>
              Add worktree
            </Button>
          </div>
        </form>

        {operation.error !== null && <ErrorNotice title="Git did not change the worktrees" error={operation.error} />}
        {addRepository.error !== null && <ErrorNotice title="Could not open the worktree" error={addRepository.error} />}
      </div>

      {removing !== null && (
        <ConfirmDialog
          title={`Remove the worktree at ${removing.path}?`}
          confirmLabel={force ? "Force remove worktree" : "Remove worktree"}
          destructive
          busy={operation.isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => operation.mutate({ kind: "remove", path: removing.path, force }, { onSettled: () => setRemoving(null) })}
        >
          <p>Deletes the folder and its working files. The branch and its commits stay in the repository.</p>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
            Remove even with uncommitted changes (they are lost)
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}
