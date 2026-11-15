import { useEffect, type ReactNode } from "react";
import { PanelRight, X } from "lucide-react";
import { IconButton } from "../components/Button";
import { Splitter } from "../components/Splitter";
import { usePreferences } from "../stores/preferences";
import { useUi } from "../stores/ui";
import { INSPECTOR_DOCK_WIDTH, useWindowWidth } from "./useWindowWidth";

/**
 * The inspector is docked (resizable, remembered) on wide windows and becomes
 * a closable overlay on narrow ones, so it never squeezes the main view.
 */
export function useInspector(): { visible: boolean; docked: boolean; toggle: () => void } {
  const docked: boolean = useWindowWidth() >= INSPECTOR_DOCK_WIDTH;
  const dockedOpen: boolean = usePreferences((state) => state.inspectorOpen);
  const toggleDocked = usePreferences((state) => state.toggleInspector);
  const overlayOpen: boolean = useUi((state) => state.narrowInspectorOpen);
  const setOverlayOpen = useUi((state) => state.setNarrowInspectorOpen);
  return {
    visible: docked ? dockedOpen : overlayOpen,
    docked,
    toggle: docked ? toggleDocked : () => setOverlayOpen(!overlayOpen),
  };
}

export function InspectorToggle() {
  const { visible, toggle } = useInspector();
  return (
    <IconButton label={visible ? "Hide inspector" : "Show inspector"} shortcut="Mod+I" pressed={visible} onClick={toggle}>
      <PanelRight aria-hidden className="size-4" />
    </IconButton>
  );
}

interface WorkspaceLayoutProps {
  children: ReactNode;
  /** Inspector content for the current selection; `null` when the workspace has none. */
  inspector: ReactNode | null;
}

export function WorkspaceLayout({ children, inspector }: WorkspaceLayoutProps) {
  const { visible, docked, toggle } = useInspector();
  const width: number = usePreferences((state) => state.sizes.inspector);
  const setOverlayOpen = useUi((state) => state.setNarrowInspectorOpen);

  // Leaving the narrow layout closes the overlay so it does not reappear unexpectedly.
  useEffect(() => {
    if (docked) {
      setOverlayOpen(false);
    }
  }, [docked, setOverlayOpen]);

  const showInspector: boolean = visible && inspector !== null;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      {showInspector && docked && (
        <>
          <Splitter panel="inspector" label="Resize inspector" grows="left" />
          <aside aria-label="Inspector" style={{ width }} className="flex shrink-0 flex-col overflow-hidden bg-surface">
            {inspector}
          </aside>
        </>
      )}
      {showInspector && !docked && (
        <aside
          aria-label="Inspector"
          className="absolute inset-y-0 right-0 z-30 flex w-80 max-w-[85%] flex-col border-l border-border bg-surface shadow-popover"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              toggle();
            }
          }}
        >
          <div className="absolute right-1.5 top-1.5 z-10">
            <IconButton label="Close inspector" onClick={toggle}>
              <X aria-hidden className="size-3.5" />
            </IconButton>
          </div>
          {inspector}
        </aside>
      )}
    </div>
  );
}
