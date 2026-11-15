import { create } from "zustand";
import type { IpcError } from "../services/ipc";

/** Transient UI state that is not persisted. */
interface UiState {
  switcherOpen: boolean;
  /** Rail expanded while the window is too narrow for the docked rail. */
  narrowRailExpanded: boolean;
  /** Inspector shown as an overlay while the window is too narrow to dock it. */
  narrowInspectorOpen: boolean;
  /** Failure to reopen the last repository at startup. */
  restoreFailure: { repositoryId: number; error: IpcError } | null;
  setSwitcherOpen: (open: boolean) => void;
  toggleNarrowRail: () => void;
  setNarrowInspectorOpen: (open: boolean) => void;
  setRestoreFailure: (failure: UiState["restoreFailure"]) => void;
}

export const useUi = create<UiState>()((set) => ({
  switcherOpen: false,
  narrowRailExpanded: false,
  narrowInspectorOpen: false,
  restoreFailure: null,
  setSwitcherOpen: (switcherOpen: boolean) => set({ switcherOpen }),
  toggleNarrowRail: () => set((state) => ({ narrowRailExpanded: !state.narrowRailExpanded })),
  setNarrowInspectorOpen: (narrowInspectorOpen: boolean) => set({ narrowInspectorOpen }),
  setRestoreFailure: (restoreFailure) => set({ restoreFailure }),
}));
