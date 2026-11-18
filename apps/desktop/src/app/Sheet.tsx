import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { IconButton } from "../components/Button";
import { RepositoriesView } from "../features/repositories/RepositoriesView";
import { CompareView } from "../features/compare/CompareView";
import { RemotesView } from "../features/remotes/RemotesView";
import { SettingsView } from "../features/settings/SettingsView";
import { ShortcutsView } from "../features/settings/ShortcutsView";
import { StashesView } from "../features/stash/StashesView";
import { WorktreesView } from "../features/worktrees/WorktreesView";
import { useUi, type Sheet as SheetKind } from "../stores/ui";

const SHEET_LABEL: Record<Exclude<SheetKind, null>, string> = {
  settings: "Settings",
  repositories: "Repositories",
  remotes: "Remotes",
  stashes: "Stash",
  worktrees: "Worktrees",
  shortcuts: "Keyboard shortcuts",
  compare: "Compare",
};

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
      className="m-auto flex h-[min(720px,calc(100vh-64px))] w-[min(880px,calc(100vw-64px))] flex-col rounded-xl border border-border/80 bg-bg p-0 text-fg shadow-popover backdrop:bg-overlay backdrop:backdrop-blur-sm"
    >
      <div className="absolute top-3.5 right-3.5 z-10 flex items-center gap-2">
        <span className="hidden sm:inline-flex items-center gap-1 font-mono text-2xs text-fg-muted/70">
          <kbd className="rounded border border-border/70 bg-elevated px-1 text-2xs">Esc</kbd>
        </span>
        <IconButton label="Close" onClick={() => setSheet(null)}>
          <X aria-hidden className="size-4" />
        </IconButton>
      </div>
      <SheetContent sheet={sheet} />
    </dialog>
  );
}
