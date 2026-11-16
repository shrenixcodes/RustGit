import { create } from "zustand";
import type { IpcError } from "../services/ipc";

export interface CommitDraft {
  summary: string;
  description: string;
  amend: boolean;
}

export const EMPTY_DRAFT: CommitDraft = { summary: "", description: "", amend: false };

/** Overlays reached from the seal or the command palette. */
export type Sheet = "settings" | "repositories" | "remotes" | "stashes" | "worktrees" | "shortcuts" | null;

/** Transient UI state that is not persisted. */
interface UiState {
  switcherOpen: boolean;
  paletteOpen: boolean;
  sheet: Sheet;
  /** Thread search text (message, author or commit id). */
  search: string;
  /** Bumped to move keyboard focus to the search field. */
  searchFocusRequest: number;
  /** Failure to reopen the last repository at startup. */
  restoreFailure: { repositoryId: number; error: IpcError } | null;
  /** Unsent commit messages per repository, kept while the app runs. */
  commitDrafts: Record<number, CommitDraft>;
  setSwitcherOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setSheet: (sheet: Sheet) => void;
  setSearch: (search: string) => void;
  requestSearchFocus: () => void;
  setRestoreFailure: (failure: UiState["restoreFailure"]) => void;
  setCommitDraft: (repositoryId: number, draft: CommitDraft) => void;
  /** Merges into the current draft (never a stale copy from a render). */
  updateCommitDraft: (repositoryId: number, patch: Partial<CommitDraft>) => void;
}

export const useUi = create<UiState>()((set) => ({
  switcherOpen: false,
  paletteOpen: false,
  sheet: null,
  search: "",
  searchFocusRequest: 0,
  restoreFailure: null,
  commitDrafts: {},
  setSwitcherOpen: (switcherOpen: boolean) => set({ switcherOpen }),
  setPaletteOpen: (paletteOpen: boolean) => set({ paletteOpen }),
  setSheet: (sheet: Sheet) => set({ sheet }),
  setSearch: (search: string) => set({ search }),
  requestSearchFocus: () => set((state) => ({ searchFocusRequest: state.searchFocusRequest + 1 })),
  setRestoreFailure: (restoreFailure) => set({ restoreFailure }),
  setCommitDraft: (repositoryId: number, draft: CommitDraft) =>
    set((state) => ({ commitDrafts: { ...state.commitDrafts, [repositoryId]: draft } })),
  updateCommitDraft: (repositoryId: number, patch: Partial<CommitDraft>) =>
    set((state) => ({
      commitDrafts: { ...state.commitDrafts, [repositoryId]: { ...(state.commitDrafts[repositoryId] ?? EMPTY_DRAFT), ...patch } },
    })),
}));
