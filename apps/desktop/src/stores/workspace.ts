import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Where the user is on the thread. There are no sections or pages: the
 * position is a node in focus and, optionally, the one node unfolded.
 *
 * Node ids: "now" is the loose end (the working tree); "c:<oid>" a commit
 * on the thread; "m:<oid>" a node on the map.
 */
export type NodeId = string;
export const LOOSE_END: NodeId = "now";

export function commitNode(oid: string): NodeId {
  return `c:${oid}`;
}
export function mapNode(oid: string): NodeId {
  return `m:${oid}`;
}
/** The commit id a node refers to, if any. */
export function oidOf(node: NodeId | null): string | null {
  return node !== null && (node.startsWith("c:") || node.startsWith("m:")) ? node.slice(2) : null;
}

/** The side of a file whose change is selected (kept for the review stream). */
export type ChangeSide = "staged" | "unstaged";

export interface ChangeSelection {
  path: string;
  side: ChangeSide;
}

interface WorkspaceState {
  activeRepositoryId: number | null;
  /**
   * Path of the active repository, persisted for restoring it at startup.
   * Ids are local to one database (RUSTGIT_DATA_DIR) while localStorage
   * belongs to the WebView profile, so the path is the stable identity.
   */
  activeRepositoryPath: string | null;
  focus: NodeId | null;
  unfolded: NodeId | null;
  /** File in focus inside the unfolded loose end. */
  selectedChange: ChangeSelection | null;
  openRepository: (repositoryId: number, path: string) => void;
  closeRepository: () => void;
  setFocus: (node: NodeId | null) => void;
  /** Unfolds a node (focusing it), or folds it when it is already unfolded. */
  toggleUnfold: (node: NodeId) => void;
  unfold: (node: NodeId | null) => void;
  selectChange: (selection: ChangeSelection | null) => void;
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set) => ({
      activeRepositoryId: null,
      activeRepositoryPath: null,
      focus: null,
      unfolded: null,
      selectedChange: null,
      openRepository: (repositoryId: number, path: string) =>
        set((state) =>
          repositoryId === state.activeRepositoryId
            ? { activeRepositoryPath: path }
            : { activeRepositoryId: repositoryId, activeRepositoryPath: path, focus: LOOSE_END, unfolded: null, selectedChange: null },
        ),
      closeRepository: () =>
        set({ activeRepositoryId: null, activeRepositoryPath: null, focus: null, unfolded: null, selectedChange: null }),
      setFocus: (focus: NodeId | null) => set({ focus }),
      toggleUnfold: (node: NodeId) =>
        set((state) => ({ focus: node, unfolded: state.unfolded === node ? null : node })),
      unfold: (unfolded: NodeId | null) => set((state) => ({ unfolded, focus: unfolded ?? state.focus })),
      selectChange: (selectedChange: ChangeSelection | null) => set({ selectedChange }),
    }),
    {
      name: "rustgit.workspace",
      // Version 3: the thread model (no sections). Earlier data is dropped.
      version: 3,
      migrate: () => ({ lastRepositoryPath: null }),
      storage: createJSONStorage(() => localStorage),
      // The active repository is restored by path through `open_repository`,
      // so a moved or deleted repository is detected.
      partialize: (state) => ({ lastRepositoryPath: state.activeRepositoryPath }),
      merge: (_persisted, current) => current,
    },
  ),
);

/** Path of the repository that was active when the app last closed, if any. */
export function lastActiveRepositoryPath(storage: Storage = localStorage): string | null {
  try {
    const raw: string | null = storage.getItem("rustgit.workspace");
    const value: unknown =
      raw === null ? null : (JSON.parse(raw) as { state?: { lastRepositoryPath?: unknown } }).state?.lastRepositoryPath;
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
