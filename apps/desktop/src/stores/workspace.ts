import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { SECTIONS, type SectionId } from "../app/navigation";

/** The side of a file whose change is selected in the Changes workspace. */
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
  section: SectionId;
  /** Last section used per repository path, restored when switching back. */
  lastSectionByRepository: Record<string, SectionId>;
  selectedChange: ChangeSelection | null;
  /** Selected commit in History (full object id). */
  selectedCommit: string | null;
  openRepository: (repositoryId: number, path: string) => void;
  closeRepository: () => void;
  showSection: (section: SectionId) => void;
  selectChange: (selection: ChangeSelection | null) => void;
  selectCommit: (oid: string | null) => void;
}

const REPOSITORY_SECTIONS: ReadonlySet<SectionId> = new Set(
  SECTIONS.filter((section) => section.repositoryScoped && section.available).map((section) => section.id),
);

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set) => ({
      activeRepositoryId: null,
      activeRepositoryPath: null,
      section: "repositories",
      lastSectionByRepository: {},
      selectedChange: null,
      selectedCommit: null,
      openRepository: (repositoryId: number, path: string) =>
        set((state) => {
          const remembered: SectionId | undefined = state.lastSectionByRepository[path];
          const section: SectionId =
            remembered !== undefined && REPOSITORY_SECTIONS.has(remembered) ? remembered : "overview";
          return {
            activeRepositoryId: repositoryId,
            activeRepositoryPath: path,
            section,
            selectedChange: repositoryId === state.activeRepositoryId ? state.selectedChange : null,
            selectedCommit: repositoryId === state.activeRepositoryId ? state.selectedCommit : null,
          };
        }),
      closeRepository: () =>
        set({
          activeRepositoryId: null,
          activeRepositoryPath: null,
          section: "repositories",
          selectedChange: null,
          selectedCommit: null,
        }),
      showSection: (section: SectionId) =>
        set((state) => ({
          section,
          lastSectionByRepository:
            state.activeRepositoryPath !== null && REPOSITORY_SECTIONS.has(section)
              ? { ...state.lastSectionByRepository, [state.activeRepositoryPath]: section }
              : state.lastSectionByRepository,
        })),
      selectChange: (selectedChange: ChangeSelection | null) => set({ selectedChange }),
      selectCommit: (selectedCommit: string | null) => set({ selectedCommit }),
    }),
    {
      name: "rustgit.workspace",
      // Version 2 keys sections by path; version 1 keyed them by database id.
      version: 2,
      migrate: () => ({ lastSectionByRepository: {}, lastRepositoryPath: null }),
      storage: createJSONStorage(() => localStorage),
      // The active repository itself is not restored from storage: only its
      // path, which is matched against the registry and reopened through
      // `open_repository` so a moved or deleted repository is detected.
      partialize: (state) => ({
        lastSectionByRepository: state.lastSectionByRepository,
        lastRepositoryPath: state.activeRepositoryPath,
      }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as { lastSectionByRepository?: unknown };
        const map: Record<string, SectionId> = {};
        if (typeof stored.lastSectionByRepository === "object" && stored.lastSectionByRepository !== null) {
          for (const [key, value] of Object.entries(stored.lastSectionByRepository as Record<string, unknown>)) {
            if (typeof value === "string" && REPOSITORY_SECTIONS.has(value as SectionId)) {
              map[key] = value as SectionId;
            }
          }
        }
        return { ...current, lastSectionByRepository: map };
      },
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
