import { lazy, Suspense, useEffect, useRef } from "react";
import { FolderGit2, GitCompare, Globe, Keyboard, Layers, Settings, X, Archive } from "lucide-react";
import { IconButton } from "../components/Button";
import { RepositoriesView } from "../features/repositories/RepositoriesView";
import { useUi, type Sheet as SheetKind } from "../stores/ui";
import { useWorkspace } from "../stores/workspace";

const CompareView = lazy(() => import("../features/compare/CompareView").then((m) => ({ default: m.CompareView })));
const RemotesView = lazy(() => import("../features/remotes/RemotesView").then((m) => ({ default: m.RemotesView })));
const SettingsView = lazy(() => import("../features/settings/SettingsView").then((m) => ({ default: m.SettingsView })));
const ShortcutsView = lazy(() => import("../features/settings/ShortcutsView").then((m) => ({ default: m.ShortcutsView })));
const StashesView = lazy(() => import("../features/stash/StashesView").then((m) => ({ default: m.StashesView })));
const WorktreesView = lazy(() => import("../features/worktrees/WorktreesView").then((m) => ({ default: m.WorktreesView })));

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
  let content = null;
  switch (sheet) {
    case "settings":
      content = <SettingsView />;
      break;
    case "repositories":
      content = <RepositoriesView />;
      break;
    case "remotes":
      content = <RemotesView />;
      break;
    case "stashes":
      content = <StashesView />;
      break;
    case "worktrees":
      content = <WorktreesView />;
      break;
    case "shortcuts":
      content = <ShortcutsView />;
      break;
    case "compare":
      content = <CompareView />;
      break;
  }
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center p-8 font-mono text-xs text-fg-muted">Loading…</div>}>
      {content}
    </Suspense>
  );
}

/** Settings, repositories, remotes, stash, worktrees and the shortcut reference, laid over the thread (native modal dialog: focus trap and Escape). */
export function Sheet() {
  const sheet: SheetKind = useUi((state) => state.sheet);
  const setSheet = useUi((state) => state.setSheet);
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const dialog = useRef<HTMLDialogElement>(null);
  /** Where the current click started: only a click that starts and ends on the backdrop closes. */
  const pressedBackdrop = useRef<boolean>(false);
  const open: boolean = sheet !== null;

  // Open and close the native dialog only when the sheet appears or goes away:
  // switching tabs must not re-run the modal and backdrop enter animations.
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const element: HTMLDialogElement | null = dialog.current;
    if (element === null || !open) return;
    if (typeof element.showModal === "function" && !element.open) element.showModal();
    else element.setAttribute("open", "");
    return () => {
      if (typeof element.close === "function" && element.open) element.close();
      previousFocus?.focus();
    };
  }, [open]);

  if (sheet === null) return null;

  return (
    <dialog
      ref={dialog}
      aria-label={SHEET_LABEL[sheet]}
      onCancel={(event) => {
        event.preventDefault();
        setSheet(null);
      }}
      // The dialog's own box is covered by its content, so a target of the
      // dialog itself means the backdrop.
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) setSheet(null);
        pressedBackdrop.current = false;
      }}
      className="m-auto flex h-[min(780px,calc(100vh-48px))] w-[min(920px,calc(100vw-48px))] flex-col overflow-hidden rounded-2xl border border-border/80 bg-bg p-0 text-fg shadow-popover backdrop:bg-overlay backdrop:backdrop-blur-sm"
    >
      {/* Top Modal Navigation Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-divider/80 bg-elevated/50 px-5 py-3 backdrop-blur-md">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto select-none scrollbar-none">
          {TABS.map((tab) => {
            if (tab.requiresRepo && activeRepositoryId === null) return null;
            const active = sheet === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSheet(tab.id)}
                className={`flex h-7.5 shrink-0 items-center gap-1.5 rounded-lg px-3 font-sans text-xs font-semibold transition-all duration-150 focus-visible:-outline-offset-2 active:scale-95 ${
                  active
                    ? "bg-canvas text-fg shadow-xs border border-border/80"
                    : "text-fg-muted hover:bg-hover hover:text-fg"
                }`}
              >
                <Icon className={`size-3.5 ${active ? "text-accent" : "text-fg-muted"}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1 font-mono text-2xs text-fg-muted">
            <kbd className="rounded border border-border/70 bg-canvas/80 px-1 text-2xs">Esc</kbd>
          </span>
          <IconButton label="Close" onClick={() => setSheet(null)}>
            <X aria-hidden className="size-4" />
          </IconButton>
        </div>
      </div>

      <div key={sheet} className="rg-tab-anim min-h-0 flex-1 flex flex-col">
        <SheetContent sheet={sheet} />
      </div>
    </dialog>
  );
}
