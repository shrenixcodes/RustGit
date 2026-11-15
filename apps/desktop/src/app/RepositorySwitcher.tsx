import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { ChevronsUpDown, FolderGit2, GitBranch, Pin, Search, Settings2 } from "lucide-react";
import { ErrorNotice } from "../components/ErrorNotice";
import { Kbd } from "../components/Kbd";
import { filterRepositories } from "../features/repositories/filterRepositories";
import { toIpcError, type IpcError } from "../services/ipc";
import { useOpenRepository, useRepositories, useRepositoryStatus } from "../services/queries";
import type { RepositoryEntry, StatusSnapshot } from "../services/types";
import { useUi } from "../stores/ui";
import { useWorkspace } from "../stores/workspace";
import { countChanges } from "../features/changes/changeLabels";

/** Repository switcher at the top of the rail; also opened with Mod+P. */
export function RepositorySwitcher({ collapsed }: { collapsed: boolean }) {
  const open: boolean = useUi((state) => state.switcherOpen);
  const setOpen = useUi((state) => state.setSwitcherOpen);
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const repositories = useRepositories();
  const status = useRepositoryStatus(activeRepositoryId);
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const active: RepositoryEntry | undefined = repositories.data?.find((entry) => entry.id === activeRepositoryId);

  const close = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div ref={root} className="relative border-b border-border p-1.5">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={active === undefined ? "Choose a repository" : `Repository ${active.name}. Switch repository`}
        title={collapsed ? (active?.name ?? "Choose a repository") : undefined}
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center gap-2 rounded-sm text-left hover:bg-hover ${
          collapsed ? "h-9 justify-center" : "px-2 py-1.5"
        } ${open ? "bg-hover" : ""}`}
      >
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-border bg-canvas font-mono text-2xs font-semibold text-accent"
        >
          {active === undefined ? <FolderGit2 className="size-3.5" /> : initials(active.name)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{active?.name ?? "No repository"}</span>
              <ActiveStatusLine hasRepository={active !== undefined} status={status.data} pending={status.isPending} />
            </span>
            <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
          </>
        )}
      </button>
      {open && <SwitcherPopover onClose={close} collapsed={collapsed} root={root} />}
    </div>
  );
}

function ActiveStatusLine({
  hasRepository,
  status,
  pending,
}: {
  hasRepository: boolean;
  status: StatusSnapshot | undefined;
  pending: boolean;
}) {
  if (!hasRepository) {
    return <span className="block truncate text-xs text-fg-muted">Open or add one</span>;
  }
  if (status === undefined) {
    return <span className="block text-xs text-fg-muted">{pending ? "Reading…" : "Status unavailable"}</span>;
  }
  const counts = countChanges(status.files);
  const changed: number = status.files.length;
  return (
    <span className="flex min-w-0 items-center gap-1 font-mono text-xs text-fg-muted">
      <GitBranch aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{status.branch.head ?? "detached HEAD"}</span>
      {counts.conflicted > 0 ? (
        <span className="shrink-0 text-danger">· {counts.conflicted} conflicted</span>
      ) : changed > 0 ? (
        <span className="shrink-0 text-amber">· {changed} changed</span>
      ) : (
        <span className="shrink-0 text-success">· clean</span>
      )}
    </span>
  );
}

function SwitcherPopover({
  onClose,
  collapsed,
  root,
}: {
  onClose: () => void;
  collapsed: boolean;
  root: RefObject<HTMLDivElement | null>;
}) {
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
      className={`absolute top-full z-40 mt-1 w-80 overflow-hidden rounded-md border border-border bg-elevated shadow-popover ${
        collapsed ? "left-1.5" : "inset-x-1.5 w-auto min-w-72"
      }`}
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
          className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-sm text-fg-secondary hover:bg-hover hover:text-fg"
        >
          <Settings2 aria-hidden className="size-3.5" /> Manage repositories…
        </button>
        <span className="flex items-center gap-1 pr-1.5 text-2xs text-fg-muted">
          <Kbd shortcut="Mod+P" /> to open
        </span>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts: string[] = name.split(/[\s._-]+/).filter((part: string) => part.length > 0);
  const letters: string = parts.length >= 2 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase();
}
