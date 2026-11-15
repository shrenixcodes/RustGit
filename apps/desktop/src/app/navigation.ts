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
}

export const SECTIONS: readonly SectionDefinition[] = [
  { id: "repositories", label: "Repositories", icon: FolderGit2, repositoryScoped: false, available: true },
  { id: "overview", label: "Overview", icon: LayoutDashboard, repositoryScoped: true, available: true },
  { id: "changes", label: "Changes", icon: SquarePen, repositoryScoped: true, available: true },
  { id: "history", label: "History", icon: History, repositoryScoped: true, available: false },
  { id: "branches", label: "Branches", icon: GitBranch, repositoryScoped: true, available: false },
  { id: "stashes", label: "Stashes", icon: Archive, repositoryScoped: true, available: false },
  { id: "worktrees", label: "Worktrees", icon: ListTree, repositoryScoped: true, available: false },
  { id: "remotes", label: "Remotes", icon: Network, repositoryScoped: true, available: false },
  { id: "pull-requests", label: "Pull Requests", icon: GitPullRequest, repositoryScoped: true, available: false },
  { id: "settings", label: "Settings", icon: Settings, repositoryScoped: false, available: true },
];

export function isSectionEnabled(section: SectionDefinition, hasRepository: boolean): boolean {
  return section.available && (!section.repositoryScoped || hasRepository);
}
