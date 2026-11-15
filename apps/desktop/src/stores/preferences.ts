import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * UI-only preferences (workspace personality, motion, layout). Repository
 * data and the theme live in the backend settings store; these never leave
 * the webview.
 */

/** Quiet: spacious, for daily work. Deep: darker and denser, for history and investigation. */
export type Personality = "quiet" | "deep";
export type MotionPreference = "system" | "reduce";
/** History zoom step: -1 dense, 0 normal, 1 spacious. */
export type ZoomStep = -1 | 0 | 1;

export interface PanelLimits {
  min: number;
  max: number;
  initial: number;
}

export const PANEL_LIMITS = {
  inspector: { min: 240, max: 480, initial: 300 },
  fileList: { min: 240, max: 520, initial: 300 },
  strand: { min: 160, max: 320, initial: 196 },
  activity: { min: 120, max: 480, initial: 220 },
} as const satisfies Record<string, PanelLimits>;

export type PanelId = keyof typeof PANEL_LIMITS;

/** Row height of lists for a personality (matches `--rg-row` in tokens.css). */
export function rowHeightFor(personality: Personality): number {
  return personality === "deep" ? 24 : 30;
}

export interface PreferencesState {
  personality: Personality;
  motion: MotionPreference;
  inspectorOpen: boolean;
  activityOpen: boolean;
  strandOpen: boolean;
  historyZoom: ZoomStep;
  sizes: Record<PanelId, number>;
  setPersonality: (personality: Personality) => void;
  togglePersonality: () => void;
  setMotion: (motion: MotionPreference) => void;
  toggleInspector: () => void;
  setActivityOpen: (open: boolean) => void;
  toggleStrand: () => void;
  zoomHistory: (step: -1 | 1 | 0) => void;
  setSize: (panel: PanelId, size: number) => void;
  resetSize: (panel: PanelId) => void;
}

export function clampSize(panel: PanelId, size: number): number {
  const limits: PanelLimits = PANEL_LIMITS[panel];
  return Math.round(Math.min(limits.max, Math.max(limits.min, size)));
}

function initialSizes(): Record<PanelId, number> {
  return {
    inspector: PANEL_LIMITS.inspector.initial,
    fileList: PANEL_LIMITS.fileList.initial,
    strand: PANEL_LIMITS.strand.initial,
    activity: PANEL_LIMITS.activity.initial,
  };
}

function clampZoom(value: number): ZoomStep {
  return value <= -1 ? -1 : value >= 1 ? 1 : 0;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      personality: "quiet",
      motion: "system",
      inspectorOpen: true,
      activityOpen: false,
      strandOpen: true,
      historyZoom: 0,
      sizes: initialSizes(),
      setPersonality: (personality: Personality) => set({ personality }),
      togglePersonality: () => set((state) => ({ personality: state.personality === "quiet" ? "deep" : "quiet" })),
      setMotion: (motion: MotionPreference) => set({ motion }),
      toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
      setActivityOpen: (activityOpen: boolean) => set({ activityOpen }),
      toggleStrand: () => set((state) => ({ strandOpen: !state.strandOpen })),
      // step 0 resets; otherwise moves one step within -1..1.
      zoomHistory: (step: -1 | 1 | 0) =>
        set((state) => ({ historyZoom: step === 0 ? 0 : clampZoom(state.historyZoom + step) })),
      setSize: (panel: PanelId, size: number) =>
        set((state) => ({ sizes: { ...state.sizes, [panel]: clampSize(panel, size) } })),
      resetSize: (panel: PanelId) =>
        set((state) => ({ sizes: { ...state.sizes, [panel]: PANEL_LIMITS[panel].initial } })),
    }),
    {
      name: "rustgit.preferences",
      // Version 2 replaced density with the workspace personality.
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted: unknown) => {
        const old = (persisted ?? {}) as { density?: unknown };
        return { ...(persisted as object), personality: old.density === "compact" ? "deep" : "quiet" };
      },
      partialize: (state) => ({
        personality: state.personality,
        motion: state.motion,
        inspectorOpen: state.inspectorOpen,
        activityOpen: state.activityOpen,
        strandOpen: state.strandOpen,
        historyZoom: state.historyZoom,
        sizes: state.sizes,
      }),
      // Stored values are validated so corrupted or outdated data cannot break the layout.
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<Record<keyof PreferencesState, unknown>> & {
          sizes?: Record<string, unknown>;
        };
        const sizes: Record<PanelId, number> = { ...current.sizes };
        for (const panel of Object.keys(PANEL_LIMITS) as PanelId[]) {
          const value: unknown = stored.sizes?.[panel];
          if (typeof value === "number" && Number.isFinite(value)) {
            sizes[panel] = clampSize(panel, value);
          }
        }
        return {
          ...current,
          personality: stored.personality === "deep" ? "deep" : "quiet",
          motion: stored.motion === "reduce" ? "reduce" : "system",
          inspectorOpen: stored.inspectorOpen !== false,
          activityOpen: stored.activityOpen === true,
          strandOpen: stored.strandOpen !== false,
          historyZoom: typeof stored.historyZoom === "number" ? clampZoom(stored.historyZoom) : 0,
          sizes,
        };
      },
    },
  ),
);

/** Mirrors personality and motion onto the document root for CSS. */
export function applyPreferences(state: Pick<PreferencesState, "personality" | "motion">, root: HTMLElement): void {
  root.dataset.workspace = state.personality;
  root.dataset.motion = state.motion;
}
