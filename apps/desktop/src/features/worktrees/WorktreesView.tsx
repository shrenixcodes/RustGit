import { useState, type FormEvent } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, GitBranch, Plus, Scissors, Trash2 } from "lucide-react";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { Input } from "../../components/Input";
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

type BranchMode = "new" | "existing" | "detached";

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
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
      <div className="max-w-3xl space-y-6">
        <div className="rounded-xl border border-border/70 bg-canvas/40 p-4 text-xs text-fg-muted leading-relaxed">
          Git worktrees allow you to check out multiple branches at once in separate directories from the same repository.
        </div>

        {worktrees.isError && <ErrorNotice title="Could not list worktrees" error={worktrees.error} />}

        {worktrees.data !== undefined && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="rg-label">Active worktrees ({worktrees.data.length})</h2>
              {worktrees.data.some((worktree: Worktree) => worktree.prunable !== null) && (
                <Button
                  variant="ghost"
                  disabled={operation.isPending}
                  onClick={() => operation.mutate({ kind: "prune" })}
                  className="h-7 text-xs text-warning"
                >
                  <Scissors className="size-3 mr-1" />
                  Prune missing worktrees
                </Button>
              )}
            </div>

            <div className="grid gap-3">
              {worktrees.data.map((worktree: Worktree) => (
                <div
                  key={worktree.path}
                  className="group rounded-xl border border-border/80 bg-elevated/50 p-4 shadow-2xs transition-all hover:border-border-control hover:bg-elevated/70"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-7 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                        <GitBranch className="size-3.5" />
                      </div>
                      <span className="font-mono text-sm font-semibold text-fg">
                        {worktreeTitle(worktree)}
                      </span>
                      {worktree.isMain && (
                        <span className="rounded-full bg-accent/15 border border-accent/25 px-2 py-0.5 font-mono text-2xs font-semibold text-accent">
                          main worktree
                        </span>
                      )}
                      {worktree.locked !== null && (
                        <span className="rounded-full bg-warning/15 border border-warning/25 px-2 py-0.5 font-mono text-2xs font-semibold text-warning">
                          locked{worktree.locked !== "" ? `: ${worktree.locked}` : ""}
                        </span>
                      )}
                      {worktree.prunable !== null && (
                        <span className="rounded-full bg-danger/15 border border-danger/25 px-2 py-0.5 font-mono text-2xs font-semibold text-danger">
                          prunable
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {!worktree.isMain && !worktree.bare && worktree.prunable === null && (
                        <Button
                          variant="ghost"
                          disabled={addRepository.isPending}
                          onClick={() => openAsRepository(worktree)}
                          className="h-7 text-xs"
                        >
                          <FolderOpen className="size-3 mr-1" />
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
                          className="h-7 text-xs text-danger/80 hover:bg-danger/10 hover:text-danger"
                        >
                          <Trash2 className="size-3 mr-1" />
                          Remove…
                        </Button>
                      )}
                    </div>
                  </div>

                  <p data-selectable className="mt-2 block truncate font-mono text-xs text-fg-muted" title={worktree.path}>
                    {worktree.path}
                  </p>
                  {worktree.prunable !== null && (
                    <p className="mt-1 text-xs text-warning/90">{worktree.prunable}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add Worktree Card */}
        <div className="rounded-xl border border-border/80 bg-elevated/40 p-5 shadow-2xs">
          <h3 className="mb-3 flex items-center gap-2 font-medium text-xs text-fg">
            <Plus className="size-3.5 text-accent" /> Add new linked worktree
          </h3>
          <form onSubmit={add} aria-label="Add a worktree" className="space-y-3">
            <div>
              <span className="mb-1 block font-mono text-2xs text-fg-muted">Target folder</span>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Input
                    value={path}
                    onChange={(event) => setPath(event.target.value)}
                    placeholder="Path to new or empty folder"
                  />
                </div>
                <Button variant="secondary" onClick={() => void browse()}>
                  Browse…
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr_auto] items-end gap-3 pt-1">
              <div>
                <span className="mb-1 block font-mono text-2xs text-fg-muted">Check out</span>
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as BranchMode)}
                  className="h-8 w-full rounded-lg border border-border/80 bg-canvas/70 px-2.5 font-sans text-xs text-fg outline-none focus:border-accent"
                >
                  <option value="new">a new branch</option>
                  <option value="existing">an existing branch</option>
                  <option value="detached">a commit (detached)</option>
                </select>
              </div>
              <div>
                <span className="mb-1 block font-mono text-2xs text-fg-muted">
                  {mode === "detached" ? "Commit (empty for HEAD)" : mode === "new" ? "New branch name" : "Branch name"}
                </span>
                <Input
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                  placeholder={mode === "detached" ? "HEAD or commit SHA" : "feature/my-branch"}
                />
              </div>
              <Button type="submit" variant="primary" disabled={!canAdd}>
                Add worktree
              </Button>
            </div>
          </form>
        </div>

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
          <label className="mt-3 flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} className="rounded border-border text-danger" />
            <span>Remove even with uncommitted changes (they are lost)</span>
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}
