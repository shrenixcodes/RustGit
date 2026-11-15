import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * UI-only preferences (layout, density, motion). Repository data and the
 * theme live in the backend settings store; these never leave the webview.
 */

export type Density = "compact" | "comfortable";
export type MotionPreference = "system" | "reduce";

export interface PanelLimits {
  min: number;
  max: number;
  initial: number;
}

export const PANEL_LIMITS = {
  rail: { min: 184, max: 320, initial: 216 },
  inspector: { min: 240, max: 480, initial: 300 },
  fileList: { min: 220, max: 560, initial: 320 },
  activity: { min: 120, max: 480, initial: 220 },
} as const satisfies Record<string, PanelLimits>;

export type PanelId = keyof typeof PANEL_LIMITS;

export interface PreferencesState {
  density: Density;
  motion: MotionPreference;
  railCollapsed: boolean;
  inspectorOpen: boolean;
  activityOpen: boolean;
  sizes: Record<PanelId, number>;
  setDensity: (density: Density) => void;
  setMotion: (motion: MotionPreference) => void;
  toggleRail: () => void;
  toggleInspector: () => void;
  setActivityOpen: (open: boolean) => void;
  setSize: (panel: PanelId, size: number) => void;
  resetSize: (panel: PanelId) => void;
}

export function clampSize(panel: PanelId, size: number): number {
  const limits: PanelLimits = PANEL_LIMITS[panel];
  return Math.round(Math.min(limits.max, Math.max(limits.min, size)));
}

function initialSizes(): Record<PanelId, number> {
  return {
    rail: PANEL_LIMITS.rail.initial,
    inspector: PANEL_LIMITS.inspector.initial,
    fileList: PANEL_LIMITS.fileList.initial,
    activity: PANEL_LIMITS.activity.initial,
  };
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      density: "compact",
      motion: "system",
      railCollapsed: false,
      inspectorOpen: true,
      activityOpen: false,
      sizes: initialSizes(),
      setDensity: (density: Density) => set({ density }),
      setMotion: (motion: MotionPreference) => set({ motion }),
      toggleRail: () => set((state) => ({ railCollapsed: !state.railCollapsed })),
      toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
      setActivityOpen: (activityOpen: boolean) => set({ activityOpen }),
      setSize: (panel: PanelId, size: number) =>
        set((state) => ({ sizes: { ...state.sizes, [panel]: clampSize(panel, size) } })),
      resetSize: (panel: PanelId) =>
        set((state) => ({ sizes: { ...state.sizes, [panel]: PANEL_LIMITS[panel].initial } })),
    }),
    {
      name: "rustgit.preferences",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        density: state.density,
        motion: state.motion,
        railCollapsed: state.railCollapsed,
        inspectorOpen: state.inspectorOpen,
        activityOpen: state.activityOpen,
        sizes: state.sizes,
      }),
      // Stored sizes are re-clamped so a corrupted or outdated value cannot break the layout.
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<PreferencesState>;
        const sizes: Record<PanelId, number> = { ...current.sizes };
        for (const panel of Object.keys(PANEL_LIMITS) as PanelId[]) {
          const value: unknown = stored.sizes?.[panel];
          if (typeof value === "number" && Number.isFinite(value)) {
            sizes[panel] = clampSize(panel, value);
          }
        }
        return {
          ...current,
          density: stored.density === "comfortable" ? "comfortable" : "compact",
          motion: stored.motion === "reduce" ? "reduce" : "system",
          railCollapsed: stored.railCollapsed === true,
          inspectorOpen: stored.inspectorOpen !== false,
          activityOpen: stored.activityOpen === true,
          sizes,
        };
      },
    },
  ),
);

/** Mirrors density and motion onto the document root for CSS. */
export function applyPreferences(state: Pick<PreferencesState, "density" | "motion">, root: HTMLElement): void {
  root.dataset.density = state.density;
  root.dataset.motion = state.motion;
}
