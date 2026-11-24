import { create } from "zustand";
import type { IpcError } from "../services/ipc";

export interface CommitDraft {
  summary: string;
  description: string;
  amend: boolean;
}

export const EMPTY_DRAFT: CommitDraft = { summary: "", description: "", amend: false };

/** Overlays reached from the seal or the command palette. */
export type Sheet = "settings" | "repositories" | "remotes" | "stashes" | "worktrees" | "shortcuts" | "compare" | null;

export type SwitcherView = "list" | "create" | "clone";

/** Transient UI state that is not persisted. */
interface UiState {
  switcherOpen: boolean;
  switcherView: SwitcherView;
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
  /** How the loose end shows diffs; kept while it is folded and unfolded again. */
  reviewLayout: "unified" | "split";
  reviewIgnoreWhitespace: boolean;
  setReviewLayout: (layout: "unified" | "split") => void;
  setReviewIgnoreWhitespace: (ignore: boolean) => void;
  /** Revisions shown in the compare sheet. */
  compare: { base: string; head: string } | null;
  setCompare: (compare: { base: string; head: string } | null) => void;
  /** Opens the compare sheet on two revisions. */
  openCompare: (base: string, head: string) => void;
  setSwitcherOpen: (open: boolean) => void;
  setSwitcherView: (view: SwitcherView) => void;
  openSwitcher: (view?: SwitcherView) => void;
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
  switcherView: "list",
  paletteOpen: false,
  sheet: null,
  search: "",
  searchFocusRequest: 0,
  restoreFailure: null,
  commitDrafts: {},
  reviewLayout: "unified",
  reviewIgnoreWhitespace: false,
  setReviewLayout: (reviewLayout) => set({ reviewLayout }),
  setReviewIgnoreWhitespace: (reviewIgnoreWhitespace) => set({ reviewIgnoreWhitespace }),
  compare: null,
  setCompare: (compare) => set({ compare }),
  openCompare: (base: string, head: string) => set({ compare: { base, head }, sheet: "compare" }),
  setSwitcherOpen: (switcherOpen: boolean) => set({ switcherOpen, switcherView: "list" }),
  setSwitcherView: (switcherView: SwitcherView) => set({ switcherView }),
  openSwitcher: (view: SwitcherView = "list") => set({ switcherOpen: true, switcherView: view }),
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
