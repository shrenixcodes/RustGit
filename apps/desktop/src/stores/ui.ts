import { create } from "zustand";
import type { IpcError } from "../services/ipc";

/** Transient UI state that is not persisted. */
interface UiState {
  switcherOpen: boolean;
  /** Inspector shown as an overlay while the window is too narrow to dock it. */
  narrowInspectorOpen: boolean;
  /** Failure to reopen the last repository at startup. */
  restoreFailure: { repositoryId: number; error: IpcError } | null;
  /** DOM node in the ridge where the current workspace renders its actions. */
  ridgeActions: HTMLElement | null;
  setSwitcherOpen: (open: boolean) => void;
  setNarrowInspectorOpen: (open: boolean) => void;
  setRestoreFailure: (failure: UiState["restoreFailure"]) => void;
  setRidgeActions: (node: HTMLElement | null) => void;
}

export const useUi = create<UiState>()((set) => ({
  switcherOpen: false,
  narrowInspectorOpen: false,
  restoreFailure: null,
  ridgeActions: null,
  setSwitcherOpen: (switcherOpen: boolean) => set({ switcherOpen }),
  setNarrowInspectorOpen: (narrowInspectorOpen: boolean) => set({ narrowInspectorOpen }),
  setRestoreFailure: (restoreFailure) => set({ restoreFailure }),
  setRidgeActions: (ridgeActions: HTMLElement | null) => set({ ridgeActions }),
}));
