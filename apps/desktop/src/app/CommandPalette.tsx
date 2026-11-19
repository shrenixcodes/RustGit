import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { FileDiff, Folder, GitBranch, RefreshCw, Search, Settings, Sliders, SunMoon } from "lucide-react";
import { formatShortcut } from "./shortcuts";
import { queryKeys, useOpenRepository, useRefs, useRepositories, useSetTheme } from "../services/queries";
import type { RefEntry, RepositoryEntry } from "../services/types";
import { usePreferences } from "../stores/preferences";
import { useUi } from "../stores/ui";
import { LOOSE_END, mapNode, useWorkspace } from "../stores/workspace";

export interface PaletteCommand {
  id: string;
  title: string;
  group: string;
  shortcut?: string;
  run: () => void;
}

/**
 * Subsequence match score (higher is better); null when the query does not
 * match. Consecutive characters and word starts score higher.
 */
export function fuzzyScore(text: string, query: string): number | null {
  const haystack: string = text.toLowerCase();
  const needle: string = query.toLowerCase().replace(/\s+/g, "");
  if (needle === "") return 0;
  let score = 0;
  let position = -1;
  let streak = 0;
  for (const char of needle) {
    const found: number = haystack.indexOf(char, position + 1);
    if (found < 0) return null;
    streak = found === position + 1 ? streak + 1 : 0;
    const wordStart: boolean = found === 0 || /[\s/._-]/.test(haystack[found - 1] ?? "");
    score += 1 + streak * 2 + (wordStart ? 3 : 0);
    position = found;
  }
  return score - haystack.length * 0.01;
}

/** `Ctrl+K`: every place and action by name. Replaces navigation chrome. */
export function CommandPalette() {
  const client: QueryClient = useQueryClient();
  const setOpen = useUi((state) => state.setPaletteOpen);
  const setSheet = useUi((state) => state.setSheet);
  const setSwitcherOpen = useUi((state) => state.setSwitcherOpen);
  const openSwitcher = useUi((state) => state.openSwitcher);
  const requestSearchFocus = useUi((state) => state.requestSearchFocus);
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const repositories = useRepositories();
  const refs = useRefs(activeRepositoryId);
  const openRepository = useOpenRepository();
  const setTheme = useSetTheme();
  const [query, setQuery] = useState<string>("");
  const [highlight, setHighlight] = useState<number>(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const listId: string = useId();

  useEffect(() => {
    const element: HTMLDialogElement | null = dialog.current;
    if (element === null) return;
    if (typeof element.showModal === "function" && !element.open) element.showModal();
    else element.setAttribute("open", "");
    return () => {
      if (typeof element.close === "function" && element.open) element.close();
    };
  }, []);

  const close = (): void => setOpen(false);

  const commands: PaletteCommand[] = useMemo(() => {
    const workspace = useWorkspace.getState();
    const prefs = usePreferences.getState();
    const list: PaletteCommand[] = [];
    if (activeRepositoryId !== null) {
      list.push(
        { id: "now", group: "Thread", title: "Go to the loose end (uncommitted changes)", run: () => workspace.unfold(LOOSE_END) },
        { id: "thread", group: "Thread", title: "Show the thread", shortcut: "Mod+0", run: () => prefs.setZoom("thread") },
        { id: "map", group: "Thread", title: "Show the branch map", shortcut: "Mod+-", run: () => prefs.setZoom("map") },
        { id: "fold", group: "Thread", title: "Fold everything", run: () => workspace.unfold(null) },
        { id: "search", group: "Thread", title: "Search the thread", shortcut: "/", run: requestSearchFocus },
        {
          id: "refresh",
          group: "Thread",
          title: "Refresh",
          shortcut: "Mod+R",
          run: () => void client.invalidateQueries({ queryKey: queryKeys.repository(activeRepositoryId) }),
        },
      );
      for (const ref of (refs.data?.refs ?? []).filter((entry: RefEntry) => entry.kind !== "tag")) {
        list.push({
          id: `ref:${ref.fullName}`,
          group: "Branches",
          title: `Show ${ref.shortName} on the map`,
          run: () => {
            prefs.setZoom("map");
            workspace.unfold(mapNode(ref.oid));
          },
        });
      }
    }
    for (const repository of repositories.data ?? []) {
      if (repository.id === activeRepositoryId) continue;
      list.push({
        id: `repo:${repository.id}`,
        group: "Repositories",
        title: `Open ${repository.name}`,
        run: () => {
          // A failure is recorded with its reason in the activity log (shelf failure count).
          openRepository.mutateAsync(repository.id).then(
            (opened: RepositoryEntry) => useWorkspace.getState().openRepository(opened.id, opened.path),
            () => {},
          );
        },
      });
    }
    list.push(
      { id: "create-repo", group: "Repositories", title: "Create new repository…", shortcut: "Mod+N", run: () => openSwitcher("create") },
      { id: "clone-repo", group: "Repositories", title: "Clone repository…", run: () => openSwitcher("clone") },
      { id: "switch", group: "Repositories", title: "Switch repository…", shortcut: "Mod+P", run: () => openSwitcher("list") },
      { id: "repos", group: "Repositories", title: "Manage repositories…", shortcut: "Mod+Shift+O", run: () => setSheet("repositories") },
      ...(activeRepositoryId === null
        ? []
        : [
            { id: "compare", group: "Repository", title: "Compare branches…", run: () => setSheet("compare") },
            { id: "remotes", group: "Repository", title: "Remotes…", run: () => setSheet("remotes") },
            { id: "stashes", group: "Repository", title: "Stash…", run: () => setSheet("stashes") },
            { id: "worktrees", group: "Repository", title: "Worktrees…", run: () => setSheet("worktrees") },
          ]),
      { id: "settings", group: "Settings", title: "Settings", shortcut: "Mod+,", run: () => setSheet("settings") },
      { id: "shortcuts", group: "Settings", title: "Keyboard shortcuts", shortcut: "?", run: () => setSheet("shortcuts") },
      { id: "theme-dark", group: "Settings", title: "Theme: dark", run: () => setTheme.mutate("dark") },
      { id: "theme-light", group: "Settings", title: "Theme: light", run: () => setTheme.mutate("light") },
      { id: "theme-system", group: "Settings", title: "Theme: follow the system", run: () => setTheme.mutate("system") },
      { id: "deep", group: "Settings", title: "Toggle the deep workspace", shortcut: "Mod+Shift+D", run: prefs.togglePersonality },
      { id: "activity", group: "Settings", title: "Toggle the activity panel", shortcut: "Mod+J", run: () => prefs.setActivityOpen(!prefs.activityOpen) },
    );
    return list;
  }, [activeRepositoryId, refs.data, repositories.data, client, openRepository, requestSearchFocus, setSheet, setSwitcherOpen, openSwitcher, setTheme]);

  const visible: PaletteCommand[] = useMemo(() => {
    if (query.trim() === "") return commands;
    return commands
      .map((command) => ({ command, score: fuzzyScore(command.title, query) }))
      .filter((entry): entry is { command: PaletteCommand; score: number } => entry.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.command);
  }, [commands, query]);
  const current: PaletteCommand | undefined = visible[Math.min(highlight, visible.length - 1)];

  const runCommand = (command: PaletteCommand): void => {
    close();
    command.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowDown") setHighlight((index) => Math.min(index + 1, Math.max(visible.length - 1, 0)));
    else if (event.key === "ArrowUp") setHighlight((index) => Math.max(index - 1, 0));
    else if (event.key === "Enter" && current !== undefined) runCommand(current);
    else return;
    event.preventDefault();
  };

function iconForCommand(command: PaletteCommand) {
  if (command.group === "Branches") return <GitBranch aria-hidden className="size-3.5 shrink-0 text-accent" />;
  if (command.group === "Repositories") return <Folder aria-hidden className="size-3.5 shrink-0 text-clay-text" />;
  if (command.group === "Settings") {
    if (command.id.startsWith("theme:")) return <SunMoon aria-hidden className="size-3.5 shrink-0 text-warning" />;
    return <Settings aria-hidden className="size-3.5 shrink-0 text-fg-muted" />;
  }
  if (command.id === "refresh") return <RefreshCw aria-hidden className="size-3.5 shrink-0 text-fg-muted" />;
  if (command.id === "search") return <Search aria-hidden className="size-3.5 shrink-0 text-fg-muted" />;
  if (command.id === "now") return <FileDiff aria-hidden className="size-3.5 shrink-0 text-accent" />;
  return <Sliders aria-hidden className="size-3.5 shrink-0 text-fg-muted" />;
}

  return (
    <dialog
      ref={dialog}
      aria-label="Commands"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
      className="mx-auto mt-[12vh] w-[min(580px,calc(100vw-48px))] overflow-hidden rounded-xl border border-border bg-elevated p-0 text-fg shadow-popover backdrop:bg-overlay"
      style={{ backgroundColor: "var(--rg-elevated)" }}
    >
      <div onKeyDown={onKeyDown}>
        <label className="flex h-12 items-center gap-3 border-b border-border/70 px-4">
          <Search aria-hidden className="size-4 text-fg-muted" />
          <span className="sr-only">Command</span>
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={current === undefined ? undefined : `${listId}-${current.id}`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            placeholder="Go to, open or change anything…"
            className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-fg-muted/70"
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setHighlight(0);
              }}
              className="text-fg-muted hover:text-fg text-xs px-1"
              title="Clear search"
            >
              ×
            </button>
          )}
        </label>
        <ul id={listId} role="listbox" aria-label="Commands" className="max-h-[50vh] overflow-y-auto py-1.5">
          {visible.length === 0 && <li className="px-4 py-4 text-center text-xs text-fg-muted">No command matches “{query}”.</li>}
          {visible.map((command, index) => {
            const isCurrent: boolean = command.id === current?.id;
            const showGroup: boolean = query.trim() === "" && (index === 0 || visible[index - 1]?.group !== command.group);
            return (
              <li key={command.id} role="presentation">
                {showGroup && <p className="px-4 pt-2.5 pb-1 text-2xs font-semibold tracking-wider text-fg-muted uppercase">{command.group}</p>}
                <div
                  id={`${listId}-${command.id}`}
                  role="option"
                  aria-selected={isCurrent}
                  onPointerMove={() => setHighlight(index)}
                  onClick={() => runCommand(command)}
                  className={`mx-2 my-0.5 flex h-9 cursor-default items-center gap-3 rounded-lg px-3 text-xs transition-colors ${
                    isCurrent ? "bg-selection text-fg font-medium" : "text-fg-secondary hover:bg-hover hover:text-fg"
                  }`}
                >
                  {iconForCommand(command)}
                  <span className="min-w-0 flex-1 truncate">{command.title}</span>
                  {command.shortcut !== undefined && (
                    <span className="shrink-0 font-mono text-2xs text-fg-muted">
                      {formatShortcut(command.shortcut)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between border-t border-divider/60 bg-surface/30 px-4 py-2 text-2xs text-fg-muted">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border/70 bg-elevated px-1 font-mono">↵</kbd>
              <span>select</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border/70 bg-elevated px-1 font-mono">↑↓</kbd>
              <span>navigate</span>
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border/70 bg-elevated px-1 font-mono">esc</kbd>
            <span>dismiss</span>
          </span>
        </div>
      </div>
    </dialog>
  );
}
