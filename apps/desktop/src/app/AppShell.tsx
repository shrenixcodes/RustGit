import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ActivityPanel } from "./ActivityPanel";
import { NavRail, useRailCollapsed } from "./NavRail";
import { OperationShelf } from "./OperationShelf";
import { useInspector } from "./WorkspaceLayout";
import { SECTIONS, isSectionEnabled, type SectionDefinition, type SectionId } from "./navigation";
import { useShortcuts, type ShortcutBinding } from "./shortcuts";
import { ChangesView } from "../features/changes/ChangesView";
import { OverviewView } from "../features/overview/OverviewView";
import { RepositoriesView } from "../features/repositories/RepositoriesView";
import { SettingsView } from "../features/settings/SettingsView";
import { toIpcError } from "../services/ipc";
import { queryKeys, useOpenRepository, useRepositories } from "../services/queries";
import type { RepositoryEntry } from "../services/types";
import { usePreferences } from "../stores/preferences";
import { useUi } from "../stores/ui";
import { lastActiveRepositoryPath, useWorkspace } from "../stores/workspace";

export function AppShell() {
  const section: SectionId = useWorkspace((state) => state.section);
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const activityOpen: boolean = usePreferences((state) => state.activityOpen);

  useGlobalShortcuts();
  useRestoreLastRepository();

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col">{renderSection(section, activeRepositoryId)}</div>
          {activityOpen && <ActivityPanel />}
        </main>
      </div>
      <OperationShelf />
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

function useGlobalShortcuts(): void {
  const client: QueryClient = useQueryClient();
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const showSection = useWorkspace((state) => state.showSection);
  const rail = useRailCollapsed();
  const inspector = useInspector();
  const activityOpen: boolean = usePreferences((state) => state.activityOpen);
  const setActivityOpen = usePreferences((state) => state.setActivityOpen);
  const switcherOpen: boolean = useUi((state) => state.switcherOpen);
  const setSwitcherOpen = useUi((state) => state.setSwitcherOpen);

  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: queryKeys.repositories });
  };

  const sectionBindings: ShortcutBinding[] = SECTIONS.filter(
    (definition: SectionDefinition) => definition.shortcut !== undefined,
  ).map((definition: SectionDefinition) => ({
    shortcut: definition.shortcut as string,
    enabled: isSectionEnabled(definition, activeRepositoryId !== null),
    run: () => showSection(definition.id),
  }));

  useShortcuts([
    ...sectionBindings,
    { shortcut: "Mod+B", run: rail.toggle, allowInInput: true },
    { shortcut: "Mod+I", run: inspector.toggle, allowInInput: true },
    { shortcut: "Mod+J", run: () => setActivityOpen(!activityOpen), allowInInput: true },
    { shortcut: "Mod+P", run: () => setSwitcherOpen(!switcherOpen), allowInInput: true },
    { shortcut: "Mod+R", run: refresh, allowInInput: true },
    { shortcut: "F5", run: refresh, allowInInput: true },
  ]);
}

/**
 * Reopens the repository that was active last time. It is matched by path in
 * the current registry and opened through the backend, so a repository that
 * was removed, moved or deleted is never shown as if it were available.
 */
function useRestoreLastRepository(): void {
  const repositories = useRepositories();
  const openRepository = useOpenRepository();
  const activate = useWorkspace((state) => state.openRepository);
  const setRestoreFailure = useUi((state) => state.setRestoreFailure);
  const attempted = useRef<boolean>(false);

  useEffect(() => {
    if (attempted.current || repositories.data === undefined) {
      return;
    }
    attempted.current = true;
    const path: string | null = lastActiveRepositoryPath();
    if (path === null || useWorkspace.getState().activeRepositoryId !== null) {
      return;
    }
    const entry: RepositoryEntry | undefined = repositories.data.find((candidate) => candidate.path === path);
    if (entry === undefined) {
      // No longer registered (removed, or a different data directory): nothing to restore.
      return;
    }
    openRepository
      .mutateAsync(entry.id)
      .then((opened: RepositoryEntry) => activate(opened.id, opened.path))
      .catch((error: unknown) => setRestoreFailure({ repositoryId: entry.id, error: toIpcError(error) }));
  }, [repositories.data, openRepository, activate, setRestoreFailure]);
}
