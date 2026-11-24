import { useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, FolderPlus, Search, type LucideIcon } from "lucide-react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { Mark } from "../../components/Mark";
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
import { formatShortcut } from "../../app/shortcuts";

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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex min-h-0 w-full max-w-[960px] flex-1 flex-col gap-4 px-6 sm:px-8 pt-6 sm:pt-10 pb-8">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div>
            <div className="flex items-baseline gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-fg">Repositories</h1>
              {(repositories.data?.length ?? 0) > 0 && (
                <span className="font-mono text-xs tabular-nums text-fg-muted">{repositories.data?.length}</span>
              )}
            </div>
            {(repositories.data?.length ?? 0) > 0 && (
              <p className="mt-0.5 text-xs text-fg-muted">
                Choose a tracked workspace to open its thread, or add another below.
              </p>
            )}
          </div>
          {(repositories.data?.length ?? 0) > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                aria-pressed={creating}
                onClick={() => { setCloning(false); setCreating((prev) => !prev); }}
                className={creating ? "border-accent text-accent bg-accent/15" : ""}
              >
                <FolderPlus aria-hidden className="size-3.5" /> Create…
              </Button>
              <Button
                aria-pressed={cloning}
                onClick={() => { setCreating(false); setCloning((prev) => !prev); }}
                className={cloning ? "border-accent text-accent bg-accent/15" : ""}
              >
                <Download aria-hidden className="size-3.5" /> Clone…
              </Button>
              <Button variant="primary" onClick={handleAdd}>
                <FolderOpen aria-hidden className="size-3.5" /> Add existing…
              </Button>
            </div>
          )}
        </header>

        {(repositories.data?.length ?? 0) > 0 && (
          <>
            <label className="flex h-10 items-center gap-2.5 rounded-lg border border-border/70 bg-canvas/60 px-3 transition-all focus-within:border-accent focus-within:bg-canvas focus-within:ring-1 focus-within:ring-accent/30">
              <Search aria-hidden className="size-3.5 text-fg-muted" />
              <span className="sr-only">Search repositories</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search repositories by name or path…"
                className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-fg-muted"
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
          </>
        )}

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
          <div className="rounded-xl border border-accent/40 bg-elevated p-4 shadow-md">
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
          <div className="rounded-xl border border-accent/40 bg-elevated p-4 shadow-md">
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

        {repositories.isPending && <p className="text-fg-muted">Loading repositories…</p>}
        {repositories.isError && <ErrorNotice title="Could not load repositories" error={repositories.error} />}

        {repositories.isSuccess && repositories.data.length === 0 && !creating && !cloning && (
          <div className="my-auto flex flex-1 flex-col items-center justify-center overflow-hidden py-12 text-center">
            {/* Ambient halo: a soft radial gradient without runtime Gaussian blur shaders. */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[380px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25"
              style={{ background: "radial-gradient(closest-side, var(--rg-accent), transparent)" }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[240px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20"
              style={{ background: "radial-gradient(closest-side, var(--rg-indigo), transparent)" }}
            />

            <div className="relative mb-5 flex size-16 items-center justify-center rounded-2xl border border-accent/30 bg-elevated/70 shadow-raised">
              <Mark size={36} />
              <span aria-hidden className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-accent/20" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-fg">Welcome to RustGit</h2>
            <p className="mt-1 text-xs font-medium text-fg-secondary">No repositories yet</p>
            <p className="mt-2 max-w-md text-sm text-fg-secondary leading-relaxed">
              Fast, lightweight Git without the overhead. Start with a repository below.
            </p>

            {githubStatus.data?.account && (
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs text-fg">
                <span aria-hidden className="size-2 rounded-full bg-success" />
                <span>Signed in as <strong className="font-semibold">@{githubStatus.data.account.login}</strong></span>
              </div>
            )}

            <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3 text-left">
              <WelcomeCard
                icon={Download}
                title="Clone repository"
                hint="From GitHub or any Git URL"
                onClick={() => { setCreating(false); setCloning(true); }}
              />
              <WelcomeCard
                icon={FolderOpen}
                title="Add existing repository"
                hint="Pick an existing folder on disk"
                onClick={handleAdd}
              />
              <WelcomeCard
                icon={FolderPlus}
                title="Create repository"
                hint="Initialize a fresh Git project"
                onClick={() => { setCloning(false); setCreating(true); }}
              />
            </div>

            <p className="mt-8 text-2xs text-fg-muted">
              Tip: press <kbd className="rounded border border-border/70 bg-elevated/70 px-1 py-0.5 font-mono text-2xs text-fg-secondary">{formatShortcut("Mod+K")}</kbd> anywhere to open the command palette.
            </p>
          </div>
        )}

        {repositories.isSuccess && repositories.data.length > 0 && visible.length === 0 && (
          <p className="text-fg-muted">No repositories match “{query}”.</p>
        )}

        {visible.length > 0 && (
          <div className="min-h-0 overflow-y-auto rounded-xl border border-border/80 bg-elevated/30 shadow-sm">
            <ul className="divide-y divide-divider/60">
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
          </div>
        )}
      </div>
    </div>
  );
}

interface WelcomeCardProps {
  icon: LucideIcon;
  title: string;
  hint: string;
  onClick: () => void;
}

/**
 * A welcome-screen action card. The three cards are equal choices, so they
 * share one treatment; the title names the action and the whole card is the
 * target.
 */
function WelcomeCard({ icon: Icon, title, hint, onClick }: WelcomeCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border/80 bg-elevated/60 p-4 text-left shadow-subtle transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-border-control hover:bg-elevated hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <div>
        <div className="mb-3 flex size-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Icon aria-hidden className="size-4" strokeWidth={1.75} />
        </div>
        <div className="font-semibold text-sm text-fg">{title}</div>
        <div className="mt-1 text-xs text-fg-muted leading-relaxed">{hint}</div>
      </div>
    </button>
  );
}
