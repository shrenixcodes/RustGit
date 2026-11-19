import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Pin, Search, Settings2 } from "lucide-react";
import { ErrorNotice } from "../components/ErrorNotice";
import { Kbd } from "../components/Kbd";
import { filterRepositories } from "../features/repositories/filterRepositories";
import { toIpcError, type IpcError } from "../services/ipc";
import { useOpenRepository, useRepositories, useSetRepositoryPinned } from "../services/queries";
import type { RepositoryEntry } from "../services/types";
import { useUi } from "../stores/ui";
import { useWorkspace } from "../stores/workspace";

/** Repository switcher popover, anchored under the repository name in the ridge (Mod+P). */
export function SwitcherPopover({ onClose, root }: { onClose: () => void; root: RefObject<HTMLDivElement | null> }) {
  const repositories = useRepositories();
  const openRepository = useOpenRepository();
  const setPinned = useSetRepositoryPinned();
  const activate = useWorkspace((state) => state.openRepository);
  const setSheet = useUi((state) => state.setSheet);
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const [query, setQuery] = useState<string>("");
  const [highlight, setHighlight] = useState<number>(0);
  const [failure, setFailure] = useState<{ name: string; error: IpcError } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const listId: string = useId();

  const visible: RepositoryEntry[] = useMemo(
    () => filterRepositories(repositories.data ?? [], query),
    [repositories.data, query],
  );
  const highlighted: RepositoryEntry | undefined = visible[Math.min(highlight, visible.length - 1)];

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

  const manage = (): void => {
    setSheet("repositories");
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index: number) => Math.min(index + 1, Math.max(visible.length - 1, 0)));
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
      // Explicit pixels: the root font size is 13 px, so rem-based widths would be too narrow.
      className="absolute left-0 top-full z-40 mt-1.5 w-[380px] max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-border bg-elevated shadow-popover"
      style={{ backgroundColor: "var(--rg-elevated)" }}
    >
      <label className="flex h-10 items-center gap-2.5 border-b border-border bg-elevated px-3" style={{ backgroundColor: "var(--rg-elevated)" }}>
        <Search aria-hidden className="size-3.5 text-fg-muted" />
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
          placeholder="Filter repositories…"
          className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-fg-muted/70"
        />
        {query !== "" && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-fg-muted hover:text-fg text-xs px-1"
            title="Clear filter"
          >
            ×
          </button>
        )}
      </label>

      {failure !== null && (
        <div className="border-b border-border p-2.5">
          <ErrorNotice title={`Could not open ${failure.name}`} error={failure.error} />
        </div>
      )}

      <ul id={listId} role="listbox" aria-label="Repositories" className="max-h-72 overflow-y-auto py-1.5">
        {repositories.isPending && <li className="px-3 py-2 text-xs text-fg-muted">Loading repositories…</li>}
        {repositories.isSuccess && visible.length === 0 && (
          <li className="px-3 py-3 text-center text-xs text-fg-muted">
            {repositories.data.length === 0 ? "No repositories yet." : `No repositories match “${query}”.`}
          </li>
        )}
        {visible.map((entry: RepositoryEntry) => {
          const isHighlighted: boolean = entry.id === highlighted?.id;
          return (
            <li
              key={entry.id}
              id={`${listId}-${entry.id}`}
              role="option"
              aria-selected={isHighlighted}
              onPointerMove={() => setHighlight(visible.indexOf(entry))}
              onClick={() => void choose(entry)}
              className={`group mx-1.5 flex cursor-default items-center justify-between gap-2 rounded-md px-2.5 py-1.5 transition-colors ${
                isHighlighted ? "bg-selection text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium text-xs text-fg">{entry.name}</span>
                  {entry.id === activeRepositoryId && (
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
        })}
      </ul>

      <div className="flex items-center justify-between border-t border-divider bg-surface px-2 py-1.5" style={{ backgroundColor: "var(--rg-surface)" }}>
        <button
          type="button"
          onClick={manage}
          className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs text-fg-secondary hover:bg-hover hover:text-fg transition-colors"
        >
          <Settings2 aria-hidden className="size-3.5" /> Manage repositories…
        </button>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap pr-1 text-2xs text-fg-muted">
          <Kbd shortcut="Mod+P" />
        </span>
      </div>
    </div>
  );
}
