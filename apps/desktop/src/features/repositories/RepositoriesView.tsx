import { useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Download, FolderGit2, FolderOpen, FolderPlus, Search } from "lucide-react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { Mark } from "../../components/Mark";
import { PageHeader } from "../../components/PageHeader";
import { useGithubStatus } from "../../services/github";
import { toIpcError, type IpcError } from "../../services/ipc";
import {
  useAddRepository,
  useGitInfo,
  useOpenRepository,
  useRemoveRepository,
  useRepositories,
  useSetRepositoryPinned,
} from "../../services/queries";
import type { RepositoryEntry } from "../../services/types";
import { useUi } from "../../stores/ui";
import { useWorkspace } from "../../stores/workspace";
import { CloneForm } from "./CloneForm";
import { NewRepositoryForm } from "./NewRepositoryForm";
import { RepositoryRow } from "./RepositoryRow";
import { filterRepositories } from "./filterRepositories";

interface FailedAction {
  title: string;
  error: IpcError;
  repositoryId: number | null;
}

export function RepositoriesView() {
  const repositories = useRepositories();
  const gitInfo = useGitInfo();
  const githubStatus = useGithubStatus();
  const addRepository = useAddRepository();
  const openRepository = useOpenRepository();
  const removeRepository = useRemoveRepository();
  const setPinned = useSetRepositoryPinned();
  const activate = useWorkspace((state) => state.openRepository);
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const closeRepository = useWorkspace((state) => state.closeRepository);

  const [query, setQuery] = useState<string>("");
  const [cloning, setCloning] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);
  const [actionFailure, setActionFailure] = useState<FailedAction | null>(null);
  const restoreFailure = useUi((state) => state.restoreFailure);
  const setRestoreFailure = useUi((state) => state.setRestoreFailure);
  // A failed reopen at startup is shown until the user acts.
  const failure: FailedAction | null =
    actionFailure ??
    (restoreFailure === null
      ? null
      : { title: "Could not reopen the last repository", ...restoreFailure });
  const setFailure = (next: FailedAction | null): void => {
    setRestoreFailure(null);
    setActionFailure(next);
  };

  const visible: RepositoryEntry[] = useMemo(
    () => filterRepositories(repositories.data ?? [], query),
    [repositories.data, query],
  );

  const pickFolder = async (title: string): Promise<string | null> => {
    const selected: string | string[] | null = await openDialog({ directory: true, multiple: false, title });
    return typeof selected === "string" ? selected : null;
  };

  const run = async (title: string, repositoryId: number | null, action: () => Promise<void>): Promise<void> => {
    setFailure(null);
    try {
      await action();
    } catch (error: unknown) {
      setFailure({ title, error: toIpcError(error), repositoryId });
    }
  };

  const handleAdd = () =>
    run("Could not add repository", null, async () => {
      const path: string | null = await pickFolder("Add an existing repository");
      if (path !== null) {
        const added: RepositoryEntry = await addRepository.mutateAsync(path);
        activate(added.id, added.path);
      }
    });

  const handleOpen = (entry: RepositoryEntry) =>
    run(`Could not open ${entry.name}`, entry.id, async () => {
      const opened: RepositoryEntry = await openRepository.mutateAsync(entry.id);
      activate(opened.id, opened.path);
    });

  const handleRemove = (entry: RepositoryEntry) =>
    run(`Could not remove ${entry.name}`, entry.id, async () => {
      await removeRepository.mutateAsync(entry.id);
      if (entry.id === activeRepositoryId) {
        closeRepository();
      }
    });

  const handleTogglePin = (entry: RepositoryEntry) =>
    run(`Could not update ${entry.name}`, entry.id, async () => {
      await setPinned.mutateAsync({ id: entry.id, pinned: !entry.pinned });
    });

  const failedEntry: RepositoryEntry | undefined =
    failure?.repositoryId == null
      ? undefined
      : repositories.data?.find((entry: RepositoryEntry) => entry.id === failure.repositoryId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Repositories" visible />

      <div className="flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4 px-6 sm:px-8 pb-6">
        {/* Action Header Card */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/80 bg-elevated/40 p-4 shadow-sm backdrop-blur-xs">
          <div>
            <div className="flex items-center gap-2">
              <FolderGit2 className="size-4 text-accent" />
              <h3 className="font-semibold text-sm text-fg">Repositories Registry</h3>
              <span className="rounded-full bg-elevated border border-border px-2 py-0.5 font-mono text-2xs text-fg-muted">
                {repositories.data?.length ?? 0} total
              </span>
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              Add local repositories, clone remote repositories, or initialize new Git projects.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => { setCloning(false); setCreating((prev) => !prev); }}
              className={creating ? "border-accent text-accent bg-accent/15" : ""}
            >
              <FolderPlus aria-hidden className="size-3.5 text-accent" /> Create…
            </Button>
            <Button
              onClick={() => { setCreating(false); setCloning((prev) => !prev); }}
              className={cloning ? "border-accent text-accent bg-accent/15" : ""}
            >
              <Download aria-hidden className="size-3.5" /> Clone…
            </Button>
            <Button variant="primary" onClick={handleAdd}>
              <FolderOpen aria-hidden className="size-3.5" /> Add existing…
            </Button>
          </div>
        </div>

        {gitInfo.isError && gitInfo.error.kind === "git_not_found" && (
          <ErrorNotice
            title="Git is not installed"
            error={gitInfo.error}
            actions={
              <p className="text-sm text-fg-muted">
                RustGit uses the Git already on your computer and does not bundle its own. Install Git for Windows (git-scm.com),
                then restart RustGit.
              </p>
            }
          />
        )}

        {creating && (
          <div className="rounded-xl border border-accent/40 bg-elevated/70 p-4 shadow-md backdrop-blur-xs">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-border/80">
              <div className="flex items-center gap-2">
                <FolderPlus className="size-4 text-accent" />
                <h4 className="font-semibold text-xs text-fg">Initialize New Repository</h4>
              </div>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="text-fg-muted hover:text-fg text-xs"
              >
                Cancel
              </button>
            </div>
            <NewRepositoryForm onDone={() => setCreating(false)} />
          </div>
        )}

        {cloning && (
          <div className="rounded-xl border border-accent/40 bg-elevated/70 p-4 shadow-md backdrop-blur-xs">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-border/80">
              <div className="flex items-center gap-2">
                <Download className="size-4 text-accent" />
                <h4 className="font-semibold text-xs text-fg">Clone Remote Repository</h4>
              </div>
              <button
                type="button"
                onClick={() => setCloning(false)}
                className="text-fg-muted hover:text-fg text-xs"
              >
                Cancel
              </button>
            </div>
            <CloneForm onDone={() => setCloning(false)} />
          </div>
        )}

        {failure !== null && (
          <ErrorNotice
            title={failure.title}
            error={failure.error}
            actions={
              failedEntry !== undefined &&
              (failure.error.kind === "not_a_repository" || failure.error.kind === "invalid_path") ? (
                <Button onClick={() => handleRemove(failedEntry)}>Remove from list</Button>
              ) : undefined
            }
          />
        )}

        <label className="flex h-10 items-center gap-2.5 rounded-lg border border-border/70 bg-canvas/60 px-3 transition-all focus-within:border-accent focus-within:bg-canvas focus-within:ring-1 focus-within:ring-accent/30">
          <Search aria-hidden className="size-3.5 text-fg-muted" />
          <span className="sr-only">Search repositories</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search repositories by name or path…"
            className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-fg-muted/70"
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-fg-muted hover:text-fg text-xs px-1"
              title="Clear search"
            >
              ×
            </button>
          )}
        </label>

        {repositories.isPending && <p className="text-fg-muted">Loading repositories…</p>}
        {repositories.isError && <ErrorNotice title="Could not load repositories" error={repositories.error} />}

        {repositories.isSuccess && repositories.data.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
            <div className="relative mb-3 flex size-12 items-center justify-center rounded-2xl bg-accent/10 border border-accent/20">
              <Mark size={28} />
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-fg">Welcome to RustGit</h2>
            <p className="mt-0.5 text-xs font-medium text-fg-secondary">No repositories yet</p>
            <p className="mt-1 max-w-sm text-xs text-fg-muted">
              Fast, lightweight Git without the overhead. Get started with any repository:
            </p>

            {githubStatus.data?.account && (
              <div className="mt-3.5 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-fg">
                <span className="size-2 rounded-full bg-accent animate-pulse" />
                <span>Connected to GitHub as <strong>@{githubStatus.data.account.login}</strong></span>
              </div>
            )}

            <div className="mt-6 grid w-full max-w-lg grid-cols-1 gap-3 sm:grid-cols-3 text-left">
              <button
                type="button"
                onClick={() => { setCreating(false); setCloning(true); }}
                className="group flex flex-col justify-between rounded-lg border border-border bg-elevated/40 p-3.5 transition-all duration-150 hover:border-accent hover:bg-hover hover:shadow-sm"
              >
                <div>
                  <div className="mb-2.5 flex size-7 items-center justify-center rounded-md bg-accent/10 text-accent group-hover:bg-accent/20">
                    <Download className="size-3.5" />
                  </div>
                  <div className="font-medium text-xs text-fg">Clone repository</div>
                  <div className="mt-0.5 text-2xs text-fg-muted">From GitHub or a URL</div>
                </div>
                <div className="mt-3 text-2xs font-semibold text-accent opacity-0 group-hover:opacity-100 transition-opacity">
                  Clone →
                </div>
              </button>

              <button
                type="button"
                onClick={handleAdd}
                className="group flex flex-col justify-between rounded-lg border border-border bg-elevated/40 p-3.5 transition-all duration-150 hover:border-accent hover:bg-hover hover:shadow-sm"
              >
                <div>
                  <div className="mb-2.5 flex size-7 items-center justify-center rounded-md bg-clay/10 text-clay-text group-hover:bg-clay/20">
                    <FolderOpen className="size-3.5" />
                  </div>
                  <div className="font-medium text-xs text-fg">Open local folder</div>
                  <div className="mt-0.5 text-2xs text-fg-muted">Choose repository from disk</div>
                </div>
                <div className="mt-3 text-2xs font-semibold text-clay-text opacity-0 group-hover:opacity-100 transition-opacity">
                  Browse →
                </div>
              </button>

              <button
                type="button"
                onClick={() => { setCloning(false); setCreating(true); }}
                className="group flex flex-col justify-between rounded-lg border border-border bg-elevated/40 p-3.5 transition-all duration-150 hover:border-accent hover:bg-hover hover:shadow-sm"
              >
                <div>
                  <div className="mb-2.5 flex size-7 items-center justify-center rounded-md bg-moss/20 text-accent-strong group-hover:bg-moss/30">
                    <FolderPlus className="size-3.5" />
                  </div>
                  <div className="font-medium text-xs text-fg">Create new</div>
                  <div className="mt-0.5 text-2xs text-fg-muted">Initialize Git project</div>
                </div>
                <div className="mt-3 text-2xs font-semibold text-accent-strong opacity-0 group-hover:opacity-100 transition-opacity">
                  Create →
                </div>
              </button>
            </div>
          </div>
        )}

        {repositories.isSuccess && repositories.data.length > 0 && visible.length === 0 && (
          <p className="text-fg-muted">No repositories match “{query}”.</p>
        )}

        {visible.length > 0 && (
          <ul className="min-h-0 flex-1 divide-y divide-divider/60 overflow-y-auto rounded-lg border border-border/70 bg-canvas/30">
            {visible.map((entry: RepositoryEntry) => (
              <RepositoryRow
                key={entry.id}
                entry={entry}
                active={entry.id === activeRepositoryId}
                onOpen={handleOpen}
                onRemove={handleRemove}
                onTogglePin={handleTogglePin}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
