import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { IconButton } from "../components/Button";
import { RepositoriesView } from "../features/repositories/RepositoriesView";
import { SettingsView } from "../features/settings/SettingsView";
import { useUi, type Sheet as SheetKind } from "../stores/ui";

/** Settings and the repository list, laid over the thread (native modal dialog: focus trap and Escape). */
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
      aria-label={sheet === "settings" ? "Settings" : "Repositories"}
      onCancel={(event) => {
        event.preventDefault();
        setSheet(null);
      }}
      className="m-auto flex h-[min(720px,calc(100vh-64px))] w-[min(860px,calc(100vw-64px))] flex-col rounded-md border border-border bg-bg p-0 text-fg shadow-popover backdrop:bg-overlay"
    >
      <div className="absolute top-3 right-3 z-10">
        <IconButton label="Close" onClick={() => setSheet(null)}>
          <X aria-hidden className="size-4" />
        </IconButton>
      </div>
      {sheet === "settings" ? <SettingsView /> : <RepositoriesView />}
    </dialog>
  );
}
