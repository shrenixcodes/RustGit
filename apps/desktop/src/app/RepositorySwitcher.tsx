import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { ArrowLeft, Download, FolderGit2, FolderOpen, FolderPlus, Pin, Search, Settings2, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "../components/Button";
import { ErrorNotice } from "../components/ErrorNotice";
import { Kbd } from "../components/Kbd";
import { CloneForm } from "../features/repositories/CloneForm";
import { filterRepositories } from "../features/repositories/filterRepositories";
import { NewRepositoryForm } from "../features/repositories/NewRepositoryForm";
import { toIpcError, type IpcError } from "../services/ipc";
import { useAddRepository, useOpenRepository, useRepositories, useSetRepositoryPinned } from "../services/queries";
import type { RepositoryEntry } from "../services/types";
import { useUi } from "../stores/ui";
import { useWorkspace } from "../stores/workspace";

type SwitcherView = "list" | "create" | "clone";

/** Repository switcher popover, anchored under the repository name in the ridge (Mod+P). */
export function SwitcherPopover({
  onClose,
  root,
  initialView = "list",
}: {
  onClose: () => void;
  root: RefObject<HTMLDivElement | null>;
  initialView?: SwitcherView;
}) {
  const repositories = useRepositories();
  const openRepository = useOpenRepository();
  const addRepository = useAddRepository();
  const setPinned = useSetRepositoryPinned();
  const activate = useWorkspace((state) => state.openRepository);
  const setSheet = useUi((state) => state.setSheet);
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);

  const [view, setView] = useState<SwitcherView>(initialView);
  const [query, setQuery] = useState<string>("");
  const [highlight, setHighlight] = useState<number>(0);
  const [failure, setFailure] = useState<{ name: string; error: IpcError } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const listId: string = useId();

  const visible: RepositoryEntry[] = useMemo(
    () => filterRepositories(repositories.data ?? [], query),
    [repositories.data, query],
  );

  const pinnedList = useMemo(() => visible.filter((entry) => entry.pinned), [visible]);
  const otherList = useMemo(() => visible.filter((entry) => !entry.pinned), [visible]);
  // Flat ordered list for keyboard navigation: pinned first, then others
  const flattened: RepositoryEntry[] = useMemo(() => [...pinnedList, ...otherList], [pinnedList, otherList]);
  const highlighted: RepositoryEntry | undefined = flattened[Math.min(highlight, Math.max(0, flattened.length - 1))];

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      // The trigger lives in the root, so clicking it toggles instead of close-then-reopen.
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose, root]);

  const choose = async (entry: RepositoryEntry): Promise<void> => {
    setFailure(null);
    try {
      const opened: RepositoryEntry = await openRepository.mutateAsync(entry.id);
      activate(opened.id, opened.path);
      onClose();
    } catch (error: unknown) {
      setFailure({ name: entry.name, error: toIpcError(error) });
    }
  };

  const handleAddLocal = async (): Promise<void> => {
    setFailure(null);
    try {
      const selected: string | string[] | null = await openDialog({
        directory: true,
        multiple: false,
        title: "Add an existing repository",
      });
      if (typeof selected === "string") {
        const added: RepositoryEntry = await addRepository.mutateAsync(selected);
        activate(added.id, added.path);
        onClose();
      }
    } catch (error: unknown) {
      setFailure({ name: "Repository", error: toIpcError(error) });
    }
  };

  const manage = (): void => {
    setSheet("repositories");
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (view !== "list") {
      if (event.key === "Escape") {
        event.preventDefault();
        setView("list");
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index: number) => Math.min(index + 1, Math.max(flattened.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index: number) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && highlighted !== undefined) {
      event.preventDefault();
      void choose(highlighted);
    }
  };

  return (
    <div
      ref={container}
      role="dialog"
      aria-label="Switch repository"
      onKeyDown={onKeyDown}
      className="absolute left-0 top-full z-40 mt-1.5 w-[440px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-border bg-elevated shadow-popover"
      style={{ backgroundColor: "var(--rg-elevated)" }}
    >
      {view === "list" && (
        <>
          {/* Top Quick Actions Bar */}
          <div
            className="flex items-center justify-between border-b border-border bg-surface px-3 py-2"
            style={{ backgroundColor: "var(--rg-surface)" }}
          >
            <div className="flex items-center gap-1.5 font-sans font-semibold text-xs text-fg">
              <FolderGit2 className="size-3.5 text-accent" />
              <span>Repositories</span>
              <span className="rounded-full bg-elevated px-1.5 py-0.2 font-mono text-2xs font-normal text-fg-muted">
                {repositories.data?.length ?? 0}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleAddLocal()}
                title="Add an existing local repository from disk"
                className="flex h-6 items-center gap-1 rounded-md border border-border/80 bg-elevated px-2 font-sans text-2xs font-medium text-fg-secondary hover:border-accent hover:text-fg transition-all active:scale-95"
              >
                <FolderOpen className="size-3 text-clay-text" />
                <span>Add Local</span>
              </button>
              <button
                type="button"
                onClick={() => setView("create")}
                title="Create a new Git repository"
                className="flex h-6 items-center gap-1 rounded-md border border-accent/40 bg-accent/15 px-2 font-sans text-2xs font-medium text-accent hover:bg-accent/25 transition-all active:scale-95"
              >
                <FolderPlus className="size-3 text-accent" />
                <span>+ New</span>
              </button>
              <button
                type="button"
                onClick={() => setView("clone")}
                title="Clone repository from GitHub or URL"
                className="flex h-6 items-center gap-1 rounded-md border border-border/80 bg-elevated px-2 font-sans text-2xs font-medium text-fg-secondary hover:border-accent hover:text-fg transition-all active:scale-95"
              >
                <Download className="size-3 text-fg-muted" />
                <span>Clone</span>
              </button>
            </div>
          </div>

          {/* Search / Filter Input */}
          <label
            className="flex h-9 items-center gap-2.5 border-b border-border bg-canvas/60 px-3 transition-colors focus-within:bg-canvas"
            style={{ backgroundColor: "var(--rg-canvas)" }}
          >
            <Search aria-hidden className="size-3.5 text-fg-muted shrink-0" />
            <span className="sr-only">Filter repositories</span>
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={highlighted === undefined ? undefined : `${listId}-${highlighted.id}`}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(0);
              }}
              placeholder="Filter repositories by name or path…"
              className="h-full flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted/70"
            />
            {query !== "" && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-fg-muted hover:text-fg text-xs p-0.5 rounded"
                title="Clear filter"
              >
                <X className="size-3" />
              </button>
            )}
          </label>

          {failure !== null && (
            <div className="border-b border-border p-2.5">
              <ErrorNotice title={`Could not open ${failure.name}`} error={failure.error} />
            </div>
          )}

          {/* Repository List */}
          <div id={listId} role="listbox" aria-label="Repositories" className="max-h-80 overflow-y-auto py-1">
            {repositories.isPending && <div className="px-3 py-3 text-xs text-fg-muted">Loading repositories…</div>}

            {repositories.isSuccess && visible.length === 0 && (
              <div className="px-4 py-6 text-center">
                {repositories.data.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-fg">No repositories yet</p>
                    <p className="text-2xs text-fg-muted">Add a local folder or create a new Git repository to get started.</p>
                    <div className="flex justify-center gap-2 pt-2">
                      <Button onClick={() => void handleAddLocal()}>
                        <FolderOpen className="size-3" /> Add Local
                      </Button>
                      <Button variant="primary" onClick={() => setView("create")}>
                        <FolderPlus className="size-3" /> Create New
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs text-fg-muted">No repositories match “{query}”.</p>
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="text-2xs text-accent underline hover:text-accent-strong"
                    >
                      Clear search filter
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Pinned Repositories Group */}
            {pinnedList.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 px-3 py-1 font-mono text-2xs font-semibold uppercase tracking-wider text-accent/90">
                  <Pin className="size-2.5" />
                  <span>Pinned Repositories ({pinnedList.length})</span>
                </div>
                <ul>
                  {pinnedList.map((entry) => renderRepositoryRow(entry))}
                </ul>
              </div>
            )}

            {/* All / Other Repositories Group */}
            {otherList.length > 0 && (
              <div>
                {pinnedList.length > 0 && (
                  <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 font-mono text-2xs font-semibold uppercase tracking-wider text-fg-muted">
                    <span>Other Repositories ({otherList.length})</span>
                  </div>
                )}
                <ul>
                  {otherList.map((entry) => renderRepositoryRow(entry))}
                </ul>
              </div>
            )}
          </div>

          {/* Bottom Footer */}
          <div
            className="flex items-center justify-between border-t border-divider bg-surface px-3 py-1.5"
            style={{ backgroundColor: "var(--rg-surface)" }}
          >
            <button
              type="button"
              onClick={manage}
              className="flex h-6 items-center gap-1.5 rounded px-1.5 text-2xs text-fg-secondary hover:bg-hover hover:text-fg transition-colors"
            >
              <Settings2 aria-hidden className="size-3" />
              <span>Manage all repositories…</span>
            </button>
            <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-2xs text-fg-muted">
              <span>Switch</span>
              <Kbd shortcut="Mod+P" />
            </span>
          </div>
        </>
      )}

      {view === "create" && (
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <button
              type="button"
              onClick={() => setView("list")}
              className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg transition-colors"
            >
              <ArrowLeft className="size-3.5" />
              <span>Back to repositories</span>
            </button>
            <span className="text-xs font-semibold text-fg">Create New Repository</span>
          </div>
          <NewRepositoryForm onDone={onClose} />
        </div>
      )}

      {view === "clone" && (
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <button
              type="button"
              onClick={() => setView("list")}
              className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg transition-colors"
            >
              <ArrowLeft className="size-3.5" />
              <span>Back to repositories</span>
            </button>
            <span className="text-xs font-semibold text-fg">Clone Repository</span>
          </div>
          <CloneForm onDone={onClose} />
        </div>
      )}
    </div>
  );

  function renderRepositoryRow(entry: RepositoryEntry) {
    const isHighlighted: boolean = entry.id === highlighted?.id;
    const isCurrent: boolean = entry.id === activeRepositoryId;

    return (
      <li
        key={entry.id}
        id={`${listId}-${entry.id}`}
        role="option"
        aria-selected={isHighlighted}
        onPointerMove={() => setHighlight(flattened.indexOf(entry))}
        onClick={() => void choose(entry)}
        className={`group mx-1.5 my-0.5 flex cursor-pointer items-center justify-between gap-2.5 rounded-lg px-2.5 py-1.5 transition-all ${
          isHighlighted ? "bg-selection text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg"
        } ${isCurrent ? "border-l-2 border-accent" : ""}`}
      >
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-canvas/80 text-fg-muted group-hover:text-fg">
          <FolderGit2 className="size-3.5" />
        </div>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold text-xs text-fg">{entry.name}</span>
            {isCurrent && (
              <span className="rounded-full bg-accent/15 border border-accent/25 px-1.5 py-0.2 font-mono text-2xs font-semibold text-accent">
                current
              </span>
            )}
          </span>
          <span className="block truncate font-mono text-2xs text-fg-muted/80">{entry.path}</span>
        </span>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setPinned.mutate({ id: entry.id, pinned: !entry.pinned });
          }}
          title={entry.pinned ? "Unpin repository" : "Pin repository to top"}
          aria-label={entry.pinned ? `Unpin ${entry.name}` : `Pin ${entry.name}`}
          className={`rounded p-1 transition-all hover:bg-hover active:scale-90 ${
            entry.pinned ? "text-accent" : "text-fg-muted opacity-0 group-hover:opacity-100 hover:text-fg"
          }`}
        >
          <Pin aria-hidden className="size-3" />
        </button>
      </li>
    );
  }
}
