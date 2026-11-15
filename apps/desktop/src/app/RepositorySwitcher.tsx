import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Pin, Search, Settings2 } from "lucide-react";
import { ErrorNotice } from "../components/ErrorNotice";
import { Kbd } from "../components/Kbd";
import { filterRepositories } from "../features/repositories/filterRepositories";
import { toIpcError, type IpcError } from "../services/ipc";
import { useOpenRepository, useRepositories } from "../services/queries";
import type { RepositoryEntry } from "../services/types";
import { useWorkspace } from "../stores/workspace";

/** Repository switcher popover, anchored under the repository name in the ridge (Mod+P). */
export function SwitcherPopover({ onClose, root }: { onClose: () => void; root: RefObject<HTMLDivElement | null> }) {
  const repositories = useRepositories();
  const openRepository = useOpenRepository();
  const activate = useWorkspace((state) => state.openRepository);
  const showSection = useWorkspace((state) => state.showSection);
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
    showSection("repositories");
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
      className="absolute left-0 top-full z-40 mt-1 w-[360px] max-w-[calc(100vw-16px)] overflow-hidden rounded-md border border-border bg-elevated shadow-popover"
    >
      <label className="flex h-9 items-center gap-2 border-b border-border px-2.5">
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
          placeholder="Filter repositories"
          className="h-full flex-1 bg-transparent outline-none placeholder:text-fg-muted"
        />
      </label>

      {failure !== null && (
        <div className="border-b border-border p-2">
          <ErrorNotice title={`Could not open ${failure.name}`} error={failure.error} />
        </div>
      )}

      <ul id={listId} role="listbox" aria-label="Repositories" className="max-h-72 overflow-y-auto py-1">
        {repositories.isPending && <li className="px-3 py-2 text-fg-muted">Loading…</li>}
        {repositories.isSuccess && visible.length === 0 && (
          <li className="px-3 py-2 text-fg-muted">
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
              className={`flex cursor-default items-center gap-2 px-2.5 py-1.5 ${isHighlighted ? "bg-selection" : ""}`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{entry.name}</span>
                  {entry.pinned && <Pin aria-label="Pinned" className="size-3 shrink-0 text-accent" />}
                  {entry.id === activeRepositoryId && <span className="rg-label text-accent">current</span>}
                </span>
                <span className="block truncate font-mono text-xs text-fg-muted">{entry.path}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between border-t border-border px-1.5 py-1">
        <button
          type="button"
          onClick={manage}
          className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-sm px-2 text-sm text-fg-secondary hover:bg-hover hover:text-fg"
        >
          <Settings2 aria-hidden className="size-3.5" /> Manage repositories…
        </button>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap pr-1.5 text-2xs text-fg-muted">
          <Kbd shortcut="Mod+P" />
        </span>
      </div>
    </div>
  );
}
