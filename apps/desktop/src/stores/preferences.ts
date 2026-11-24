import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * UI-only preferences (workspace personality, motion, thread distance).
 * Repository data and the theme live in the backend settings store; these
 * never leave the webview.
 */

/** Quiet: spacious, for daily work. Deep: darker and denser, for history and investigation. */
export type Personality = "quiet" | "deep";
export type MotionPreference = "system" | "reduce" | "full";
/** How far the thread is seen from: every commit, or only branch heads, forks and merges. */
export type Zoom = "thread" | "map";
/** How Pull integrates the upstream (the backend's PullMode). */
export type PullPreference = "ff_only" | "merge" | "rebase";

export interface PanelLimits {
  min: number;
  max: number;
  initial: number;
}

export const PANEL_LIMITS = {
  activity: { min: 120, max: 480, initial: 220 },
} as const satisfies Record<string, PanelLimits>;

export type PanelId = keyof typeof PANEL_LIMITS;

/** Row height of the thread for a personality (matches `--rg-row` in tokens.css). */
export function rowHeightFor(personality: Personality): number {
  return personality === "deep" ? 26 : 32;
}

export interface PreferencesState {
  personality: Personality;
  motion: MotionPreference;
  zoom: Zoom;
  pullMode: PullPreference;
  activityOpen: boolean;
  /** Fetch the open repository's remotes in the background every few minutes. */
  autoFetch: boolean;
  sizes: Record<PanelId, number>;
  setAutoFetch: (autoFetch: boolean) => void;
  setPersonality: (personality: Personality) => void;
  togglePersonality: () => void;
  setMotion: (motion: MotionPreference) => void;
  setZoom: (zoom: Zoom) => void;
  setPullMode: (mode: PullPreference) => void;
  setActivityOpen: (open: boolean) => void;
  setSize: (panel: PanelId, size: number) => void;
  resetSize: (panel: PanelId) => void;
}

export function clampSize(panel: PanelId, size: number): number {
  const limits: PanelLimits = PANEL_LIMITS[panel];
  return Math.round(Math.min(limits.max, Math.max(limits.min, size)));
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      personality: "quiet",
      // Follow the OS reduce-motion setting until the user picks otherwise.
      motion: "system",
      zoom: "thread",
      pullMode: "ff_only",
      activityOpen: false,
      autoFetch: true,
      sizes: { activity: PANEL_LIMITS.activity.initial },
      setAutoFetch: (autoFetch: boolean) => set({ autoFetch }),
      setPersonality: (personality: Personality) => set({ personality }),
      togglePersonality: () => set((state) => ({ personality: state.personality === "quiet" ? "deep" : "quiet" })),
      setMotion: (motion: MotionPreference) => set({ motion }),
      setZoom: (zoom: Zoom) => set({ zoom }),
      setPullMode: (pullMode: PullPreference) => set({ pullMode }),
      setActivityOpen: (activityOpen: boolean) => set({ activityOpen }),
      setSize: (panel: PanelId, size: number) =>
        set((state) => ({ sizes: { ...state.sizes, [panel]: clampSize(panel, size) } })),
      resetSize: (panel: PanelId) =>
        set((state) => ({ sizes: { ...state.sizes, [panel]: PANEL_LIMITS[panel].initial } })),
    }),
    {
      name: "rustgit.preferences",
      // v2 replaced density with the personality; v3 is the thread model.
      version: 3,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted: unknown) => {
        const old = (persisted ?? {}) as { density?: unknown; personality?: unknown };
        const personality: unknown = old.personality ?? (old.density === "compact" ? "deep" : "quiet");
        return { ...(persisted as object), personality };
      },
      partialize: (state) => ({
        personality: state.personality,
        motion: state.motion,
        zoom: state.zoom,
        pullMode: state.pullMode,
        activityOpen: state.activityOpen,
        autoFetch: state.autoFetch,
        sizes: state.sizes,
      }),
      // Stored values are validated so corrupted or outdated data cannot break the layout.
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<Record<keyof PreferencesState, unknown>> & {
          sizes?: Record<string, unknown>;
        };
        const activity: unknown = stored.sizes?.activity;
        return {
          ...current,
          personality: stored.personality === "deep" ? "deep" : "quiet",
          motion: stored.motion === "reduce" ? "reduce" : stored.motion === "full" ? "full" : "system",
          zoom: stored.zoom === "map" ? "map" : "thread",
          pullMode: stored.pullMode === "merge" || stored.pullMode === "rebase" ? stored.pullMode : "ff_only",
          activityOpen: stored.activityOpen === true,
          // On unless turned off (older stored preferences have no value).
          autoFetch: stored.autoFetch !== false,
          sizes: {
            activity:
              typeof activity === "number" && Number.isFinite(activity)
                ? clampSize("activity", activity)
                : PANEL_LIMITS.activity.initial,
          },
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
