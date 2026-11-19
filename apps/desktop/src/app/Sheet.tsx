import { useEffect, useRef } from "react";
import { FolderGit2, GitCompare, Globe, Keyboard, Layers, Settings, X, Archive } from "lucide-react";
import { IconButton } from "../components/Button";
import { RepositoriesView } from "../features/repositories/RepositoriesView";
import { CompareView } from "../features/compare/CompareView";
import { RemotesView } from "../features/remotes/RemotesView";
import { SettingsView } from "../features/settings/SettingsView";
import { ShortcutsView } from "../features/settings/ShortcutsView";
import { StashesView } from "../features/stash/StashesView";
import { WorktreesView } from "../features/worktrees/WorktreesView";
import { useUi, type Sheet as SheetKind } from "../stores/ui";
import { useWorkspace } from "../stores/workspace";

const SHEET_LABEL: Record<Exclude<SheetKind, null>, string> = {
  settings: "Settings",
  repositories: "Repositories",
  remotes: "Remotes",
  stashes: "Stash",
  worktrees: "Worktrees",
  shortcuts: "Keyboard shortcuts",
  compare: "Compare",
};

interface SheetTab {
  id: Exclude<SheetKind, null>;
  label: string;
  icon: typeof Settings;
  requiresRepo?: boolean;
}

const TABS: readonly SheetTab[] = [
  { id: "settings", label: "Settings", icon: Settings },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "repositories", label: "Repositories", icon: FolderGit2 },
  { id: "remotes", label: "Remotes", icon: Globe, requiresRepo: true },
  { id: "stashes", label: "Stash", icon: Archive, requiresRepo: true },
  { id: "worktrees", label: "Worktrees", icon: Layers, requiresRepo: true },
  { id: "compare", label: "Compare", icon: GitCompare, requiresRepo: true },
];

function SheetContent({ sheet }: { sheet: Exclude<SheetKind, null> }) {
  switch (sheet) {
    case "settings":
      return <SettingsView />;
    case "repositories":
      return <RepositoriesView />;
    case "remotes":
      return <RemotesView />;
    case "stashes":
      return <StashesView />;
    case "worktrees":
      return <WorktreesView />;
    case "shortcuts":
      return <ShortcutsView />;
    case "compare":
      return <CompareView />;
  }
}

/** Settings, repositories, remotes, stash, worktrees and the shortcut reference, laid over the thread (native modal dialog: focus trap and Escape). */
export function Sheet() {
  const sheet: SheetKind = useUi((state) => state.sheet);
  const setSheet = useUi((state) => state.setSheet);
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element: HTMLDialogElement | null = dialog.current;
    if (element === null || sheet === null) return;
    if (typeof element.showModal === "function" && !element.open) element.showModal();
    else element.setAttribute("open", "");
    return () => {
      if (typeof element.close === "function" && element.open) element.close();
    };
  }, [sheet]);

  if (sheet === null) return null;

  return (
    <dialog
      ref={dialog}
      aria-label={SHEET_LABEL[sheet]}
      onCancel={(event) => {
        event.preventDefault();
        setSheet(null);
      }}
      className="m-auto flex h-[min(720px,calc(100vh-64px))] w-[min(920px,calc(100vw-64px))] flex-col rounded-2xl border border-border/80 bg-bg p-0 text-fg shadow-popover backdrop:bg-overlay backdrop:backdrop-blur-sm"
    >
      {/* Top Modal Navigation Header */}
      <div className="relative flex shrink-0 items-center justify-between border-b border-divider/80 bg-canvas/40 px-5 py-2.5">
        <div className="flex items-center gap-1 overflow-x-auto pr-16 select-none scrollbar-none">
          {TABS.map((tab) => {
            if (tab.requiresRepo && activeRepositoryId === null) return null;
            const active = sheet === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSheet(tab.id)}
                className={`flex h-7 items-center gap-1.5 rounded-lg px-2.5 font-sans text-xs font-medium transition-all duration-150 active:scale-95 ${
                  active
                    ? "bg-elevated text-fg shadow-2xs border border-border/80"
                    : "text-fg-muted hover:bg-hover hover:text-fg"
                }`}
              >
                <Icon className={`size-3.5 ${active ? "text-accent" : "text-fg-muted"}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="absolute top-2.5 right-4 z-10 flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1 font-mono text-2xs text-fg-muted/70">
            <kbd className="rounded border border-border/70 bg-elevated px-1 text-2xs">Esc</kbd>
          </span>
          <IconButton label="Close" onClick={() => setSheet(null)}>
            <X aria-hidden className="size-4" />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 flex flex-col">
        <SheetContent sheet={sheet} />
      </div>
    </dialog>
  );
}
