import { useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Download, FolderGit2, FolderOpen, FolderPlus, Search, type LucideIcon } from "lucide-react";
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
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Repositories" visible />

      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4 px-6 sm:px-8 pb-6">
        {/* Action Header Card — Shown only when repositories exist */}
        {(repositories.data?.length ?? 0) > 0 && (
          <>
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

        {repositories.isPending && <p className="text-fg-muted">Loading repositories…</p>}
        {repositories.isError && <ErrorNotice title="Could not load repositories" error={repositories.error} />}

        {repositories.isSuccess && repositories.data.length === 0 && !creating && !cloning && (
          <div className="my-auto flex flex-1 flex-col items-center justify-center overflow-hidden py-12 text-center">
            {/* Ambient halo: a soft, slow gradient so the welcome screen reads
             * as a stage rather than an empty box. Decorative only. */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[380px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/15 blur-3xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[240px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo/10 blur-2xl"
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
                <span className="relative flex size-2 items-center justify-center">
                  <span className="absolute inset-0 rounded-full bg-success animate-ping opacity-60" />
                  <span className="relative size-2 rounded-full bg-success" />
                </span>
                <span>Signed in as <strong className="font-semibold">@{githubStatus.data.account.login}</strong></span>
              </div>
            )}

            <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3 text-left">
              <WelcomeCard
                icon={Download}
                title="Clone repository"
                hint="From GitHub or any Git URL"
                accent="accent"
                onClick={() => { setCreating(false); setCloning(true); }}
              />
              <WelcomeCard
                icon={FolderOpen}
                title="Add existing repository"
                hint="Pick an existing folder on disk"
                accent="clay"
                onClick={handleAdd}
              />
              <WelcomeCard
                icon={FolderPlus}
                title="Create repository"
                hint="Initialize a fresh Git project"
                accent="moss"
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
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/80 bg-elevated/30 shadow-sm backdrop-blur-xs">
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

type WelcomeAccent = "accent" | "clay" | "moss";

const WELCOME_ACCENT: Record<WelcomeAccent, { chip: string; text: string; ring: string }> = {
  accent: { chip: "bg-accent/15 text-accent", text: "text-accent", ring: "group-hover:ring-accent/40" },
  clay: { chip: "bg-clay/15 text-clay-text", text: "text-clay-text", ring: "group-hover:ring-clay/40" },
  moss: { chip: "bg-success/15 text-success", text: "text-success", ring: "group-hover:ring-success/40" },
};

interface WelcomeCardProps {
  icon: LucideIcon;
  title: string;
  hint: string;
  accent: WelcomeAccent;
  onClick: () => void;
}

/**
 * A welcome-screen action card. The accent colour is the only variable: the
 * frame, motion and hierarchy are shared so the three CTAs read as one row.
 */
function WelcomeCard({ icon: Icon, title, hint, accent, onClick }: WelcomeCardProps) {
  const style = WELCOME_ACCENT[accent];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-elevated/60 p-4 text-left shadow-subtle ring-1 ring-transparent ring-inset transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-border-control hover:bg-elevated hover:shadow-raised ${style.ring} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg`}
    >
      <div>
        <div className={`mb-3 flex size-8 items-center justify-center rounded-lg ${style.chip} transition-transform duration-200 group-hover:scale-105`}>
          <Icon aria-hidden className="size-4" strokeWidth={1.75} />
        </div>
        <div className="font-semibold text-sm text-fg">{title}</div>
        <div className="mt-1 text-xs text-fg-muted leading-relaxed">{hint}</div>
      </div>
      <div className={`mt-4 flex items-center gap-1 text-xs font-semibold ${style.text} opacity-0 translate-x-[-4px] transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100`}>
        Get started <span aria-hidden>→</span>
      </div>
    </button>
  );
}
