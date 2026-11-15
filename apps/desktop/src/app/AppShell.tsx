import { Sidebar } from "./Sidebar";
import type { SectionId } from "./navigation";
import { useWorkspace } from "../stores/workspace";
import { RepositoriesView } from "../features/repositories/RepositoriesView";
import { OverviewView } from "../features/overview/OverviewView";
import { ChangesView } from "../features/changes/ChangesView";
import { SettingsView } from "../features/settings/SettingsView";

export function AppShell() {
  const section: SectionId = useWorkspace((state) => state.section);
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);

  return (
    <div className="flex h-full bg-bg text-fg">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">{renderSection(section, activeRepositoryId)}</main>
    </div>
  );
}

function renderSection(section: SectionId, repositoryId: number | null) {
  switch (section) {
    case "settings":
      return <SettingsView />;
    case "overview":
      return repositoryId === null ? <RepositoriesView /> : <OverviewView repositoryId={repositoryId} />;
    case "changes":
      return repositoryId === null ? <RepositoriesView /> : <ChangesView repositoryId={repositoryId} />;
    default:
      // Sections that are not implemented cannot be selected; fall back safely.
      return <RepositoriesView />;
  }
}
