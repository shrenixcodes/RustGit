import {
  Archive,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  History,
  LayoutDashboard,
  ListTree,
  Network,
  Settings,
  SquarePen,
  type LucideIcon,
} from "lucide-react";

export type SectionId =
  | "repositories"
  | "overview"
  | "changes"
  | "history"
  | "branches"
  | "stashes"
  | "worktrees"
  | "remotes"
  | "pull-requests"
  | "settings";

export interface SectionDefinition {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  /** Requires an open repository. */
  repositoryScoped: boolean;
  /** False while the feature is not implemented; shown disabled, never faked. */
  available: boolean;
  /** Global shortcut, in `shortcuts.ts` notation. */
  shortcut?: string;
  /** Why the section is unavailable, shown in its tooltip. */
  unavailableReason?: string;
  /** Shown in the navigation rail (Repositories is reached through the switcher). */
  inRail: boolean;
}

export const SECTIONS: readonly SectionDefinition[] = [
  { id: "repositories", label: "Repositories", icon: FolderGit2, repositoryScoped: false, available: true, inRail: false, shortcut: "Mod+Shift+O" },
  { id: "overview", label: "Overview", icon: LayoutDashboard, repositoryScoped: true, available: true, inRail: true, shortcut: "Mod+1" },
  { id: "changes", label: "Changes", icon: SquarePen, repositoryScoped: true, available: true, inRail: true, shortcut: "Mod+2" },
  { id: "history", label: "History", icon: History, repositoryScoped: true, available: false, inRail: true, unavailableReason: "History needs the commit log and references from the backend (requests R-8, R-9)" },
  { id: "branches", label: "Branches", icon: GitBranch, repositoryScoped: true, available: false, inRail: true, unavailableReason: "Branches needs references and branch operations from the backend (R-9, R-11)" },
  { id: "stashes", label: "Stashes", icon: Archive, repositoryScoped: true, available: false, inRail: true, unavailableReason: "Not available yet" },
  { id: "worktrees", label: "Worktrees", icon: ListTree, repositoryScoped: true, available: false, inRail: true, unavailableReason: "Not available yet" },
  { id: "remotes", label: "Remotes", icon: Network, repositoryScoped: true, available: false, inRail: true, unavailableReason: "Not available yet" },
  { id: "pull-requests", label: "Pull Requests", icon: GitPullRequest, repositoryScoped: true, available: false, inRail: true, unavailableReason: "Not available yet" },
  { id: "settings", label: "Settings", icon: Settings, repositoryScoped: false, available: true, inRail: true, shortcut: "Mod+," },
];

export function isSectionEnabled(section: SectionDefinition, hasRepository: boolean): boolean {
  return section.available && (!section.repositoryScoped || hasRepository);
}

export function sectionById(id: SectionId): SectionDefinition {
  const section: SectionDefinition | undefined = SECTIONS.find((candidate) => candidate.id === id);
  if (section === undefined) {
    throw new Error(`unknown section ${id}`);
  }
  return section;
}
