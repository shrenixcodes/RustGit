import { useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, FolderPlus, Search } from "lucide-react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { Mark } from "../../components/Mark";
import { PageHeader } from "../../components/PageHeader";
import { toIpcError, type IpcError } from "../../services/ipc";
import {
  useAddRepository,
  useInitRepository,
  useOpenRepository,
  useRemoveRepository,
  useRepositories,
  useSetRepositoryPinned,
} from "../../services/queries";
import type { RepositoryEntry } from "../../services/types";
import { useUi } from "../../stores/ui";
import { useWorkspace } from "../../stores/workspace";
import { CloneForm } from "./CloneForm";
import { RepositoryRow } from "./RepositoryRow";
import { filterRepositories } from "./filterRepositories";

interface FailedAction {
  title: string;
  error: IpcError;
  repositoryId: number | null;
}

export function RepositoriesView() {
  const repositories = useRepositories();
  const addRepository = useAddRepository();
  const initRepository = useInitRepository();
  const openRepository = useOpenRepository();
  const removeRepository = useRemoveRepository();
  const setPinned = useSetRepositoryPinned();
  const activate = useWorkspace((state) => state.openRepository);
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const closeRepository = useWorkspace((state) => state.closeRepository);

  const [query, setQuery] = useState<string>("");
  const [cloning, setCloning] = useState<boolean>(false);
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

  const handleCreate = () =>
    run("Could not create repository", null, async () => {
      const path: string | null = await pickFolder("Choose a folder for the new repository");
      if (path !== null) {
        const created: RepositoryEntry = await initRepository.mutateAsync(path);
        activate(created.id, created.path);
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

      <div className="flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 px-8 pb-6">
        <div className="flex items-end gap-3">
          <p className="flex-1 text-sm text-fg-muted">
            Repositories RustGit knows about. Removing one here never deletes files.
          </p>
          <Button onClick={() => setCloning(true)} disabled={cloning}>
            <Download aria-hidden className="size-3.5" /> Clone…
          </Button>
          <Button onClick={handleCreate}>
            <FolderPlus aria-hidden className="size-3.5" /> Create…
          </Button>
          <Button variant="primary" onClick={handleAdd}>
            <FolderOpen aria-hidden className="size-3.5" /> Add existing…
          </Button>
        </div>
        {cloning && <CloneForm onDone={() => setCloning(false)} />}
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

        <label className="flex h-9 items-center gap-2 border-b border-border px-1 focus-within:border-accent">
          <Search aria-hidden className="size-3.5 text-fg-muted" />
          <span className="sr-only">Search repositories</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or path"
            className="h-full flex-1 bg-transparent text-base outline-none placeholder:text-fg-muted"
          />
        </label>

        {repositories.isPending && <p className="text-fg-muted">Loading repositories…</p>}
        {repositories.isError && <ErrorNotice title="Could not load repositories" error={repositories.error} />}

        {repositories.isSuccess && repositories.data.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <Mark size={40} />
            <p className="mt-2 font-medium">No repositories yet</p>
            <p className="max-w-sm text-fg-muted">
              Clone a repository, add a folder that already contains one, or create a new one.
            </p>
          </div>
        )}

        {repositories.isSuccess && repositories.data.length > 0 && visible.length === 0 && (
          <p className="text-fg-muted">No repositories match “{query}”.</p>
        )}

        {visible.length > 0 && (
          <ul className="min-h-0 flex-1 divide-y divide-divider overflow-y-auto">
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
