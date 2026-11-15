import { create } from "zustand";
import type { SectionId } from "../app/navigation";

interface WorkspaceState {
  activeRepositoryId: number | null;
  section: SectionId;
  openRepository: (repositoryId: number) => void;
  closeRepository: () => void;
  showSection: (section: SectionId) => void;
}

export const useWorkspace = create<WorkspaceState>()((set) => ({
  activeRepositoryId: null,
  section: "repositories",
  openRepository: (repositoryId: number) => set({ activeRepositoryId: repositoryId, section: "overview" }),
  closeRepository: () => set({ activeRepositoryId: null, section: "repositories" }),
  showSection: (section: SectionId) => set({ section }),
}));
