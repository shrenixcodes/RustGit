import { create } from "zustand";
import type { IpcError } from "../services/ipc";

export interface CommitDraft {
  summary: string;
  description: string;
  amend: boolean;
}

export const EMPTY_DRAFT: CommitDraft = { summary: "", description: "", amend: false };

/** Transient UI state that is not persisted. */
interface UiState {
  switcherOpen: boolean;
  /** Inspector shown as an overlay while the window is too narrow to dock it. */
  narrowInspectorOpen: boolean;
  /** Failure to reopen the last repository at startup. */
  restoreFailure: { repositoryId: number; error: IpcError } | null;
  /** DOM node in the ridge where the current workspace renders its actions. */
  ridgeActions: HTMLElement | null;
  /** Unsent commit messages per repository, kept while the app runs. */
  commitDrafts: Record<number, CommitDraft>;
  setCommitDraft: (repositoryId: number, draft: CommitDraft) => void;
  /** Merges into the current draft (never a stale copy from a render). */
  updateCommitDraft: (repositoryId: number, patch: Partial<CommitDraft>) => void;
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
  commitDrafts: {},
  setCommitDraft: (repositoryId: number, draft: CommitDraft) =>
    set((state) => ({ commitDrafts: { ...state.commitDrafts, [repositoryId]: draft } })),
  updateCommitDraft: (repositoryId: number, patch: Partial<CommitDraft>) =>
    set((state) => ({
      commitDrafts: { ...state.commitDrafts, [repositoryId]: { ...(state.commitDrafts[repositoryId] ?? EMPTY_DRAFT), ...patch } },
    })),
  setSwitcherOpen: (switcherOpen: boolean) => set({ switcherOpen }),
  setNarrowInspectorOpen: (narrowInspectorOpen: boolean) => set({ narrowInspectorOpen }),
  setRestoreFailure: (restoreFailure) => set({ restoreFailure }),
  setRidgeActions: (ridgeActions: HTMLElement | null) => set({ ridgeActions }),
}));
