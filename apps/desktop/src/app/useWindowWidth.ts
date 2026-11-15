import { useSyncExternalStore } from "react";

function subscribe(callback: () => void): () => void {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

/** Current viewport width in CSS pixels (already accounts for Windows display scaling). */
export function useWindowWidth(): number {
  return useSyncExternalStore(subscribe, () => window.innerWidth);
}

/** Below this width the navigation rail collapses to icons. */
export const RAIL_COLLAPSE_WIDTH = 1100;
/** Below this width the inspector becomes an overlay that is closed by default. */
export const INSPECTOR_DOCK_WIDTH = 1240;
