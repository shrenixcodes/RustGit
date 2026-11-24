import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ActivityPanel } from "./ActivityPanel";
import { CommandPalette } from "./CommandPalette";
import { OperationShelf } from "./OperationShelf";
import { Seal } from "./Seal";
import { Sheet } from "./Sheet";
import { useShortcuts } from "./shortcuts";
import { RepositoriesView } from "../features/repositories/RepositoriesView";
import { UpdateBanner } from "../components/UpdateBanner";
import { toIpcError } from "../services/ipc";
import { CredentialPrompt } from "./CredentialPrompt";
import { networkActions, useAutoFetch, useOperationEvents } from "../services/network";
import { useRepositoryWatcher } from "../services/repositoryEvents";
import { queryKeys, useOpenRepository, useRepositories, useRepositoryStatus } from "../services/queries";
import type { RepositoryEntry } from "../services/types";
import { usePreferences } from "../stores/preferences";
import { useUi } from "../stores/ui";
import { lastActiveRepositoryPath, useWorkspace } from "../stores/workspace";
import { ThreadView } from "../thread/ThreadView";

/**
 * One canvas: the seal (repository identity) above the thread, the
 * operation shelf below. Without a repository the canvas lists
 * repositories instead. Settings and commands open over the canvas.
 */
export function AppShell() {
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const activityOpen: boolean = usePreferences((state) => state.activityOpen);
  const paletteOpen: boolean = useUi((state) => state.paletteOpen);

  useGlobalShortcuts();
  useRestoreLastRepository();
  useRepositoryWatcher(activeRepositoryId);
  const autoFetch: boolean = usePreferences((state) => state.autoFetch);
  useAutoFetch(activeRepositoryId, autoFetch);
  useOperationEvents();

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <Seal />
      <UpdateBanner />
      <main className="flex min-h-0 flex-1 flex-col">
        {activeRepositoryId === null ? <RepositoriesView /> : <ThreadView key={activeRepositoryId} repositoryId={activeRepositoryId} />}
      </main>
      {activityOpen && <ActivityPanel />}
      <OperationShelf />
      <Sheet />
      <CredentialPrompt />
      {paletteOpen && <CommandPalette />}
    </div>
  );
}

function useGlobalShortcuts(): void {
  const client: QueryClient = useQueryClient();
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const activityOpen: boolean = usePreferences((state) => state.activityOpen);
  const setActivityOpen = usePreferences((state) => state.setActivityOpen);
  const togglePersonality = usePreferences((state) => state.togglePersonality);
  const setZoom = usePreferences((state) => state.setZoom);
  const switcherOpen: boolean = useUi((state) => state.switcherOpen);
  const setSwitcherOpen = useUi((state) => state.setSwitcherOpen);
  const openSwitcher = useUi((state) => state.openSwitcher);
  const paletteOpen: boolean = useUi((state) => state.paletteOpen);
  const setPaletteOpen = useUi((state) => state.setPaletteOpen);
  const setSheet = useUi((state) => state.setSheet);
  const requestSearchFocus = useUi((state) => state.requestSearchFocus);
  const hasRepository: boolean = activeRepositoryId !== null;
  const status = useRepositoryStatus(activeRepositoryId);
  const pullMode = usePreferences((state) => state.pullMode);
  const branch = status.data?.branch;
  const onTrackedBranch: boolean = branch !== undefined && branch.head !== null && branch.upstream !== null;
  // Failures to start are recorded in the activity log by startOperation.
  const network = activeRepositoryId === null ? null : networkActions(activeRepositoryId);
  const ignore = (): void => {};

  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: queryKeys.repositories });
  };

  useShortcuts([
    // The palette is itself a dialog, and opens above any other.
    { shortcut: "Mod+K", run: () => setPaletteOpen(!paletteOpen), allowInInput: true, allowInDialog: true },
    { shortcut: "Mod+P", run: () => setSwitcherOpen(!switcherOpen), allowInInput: true },
    { shortcut: "Mod+N", run: () => openSwitcher("create"), allowInInput: true },
    { shortcut: "Mod+O", run: () => openSwitcher("list"), allowInInput: true },
    { shortcut: "Mod+,", run: () => setSheet("settings"), allowInInput: true },
    { shortcut: "Mod+Shift+O", run: () => setSheet("repositories"), allowInInput: true },
    { shortcut: "Mod+J", run: () => setActivityOpen(!activityOpen), allowInInput: true },
    { shortcut: "Mod+Shift+D", run: togglePersonality, allowInInput: true },
    { shortcut: "Mod+R", run: refresh, allowInInput: true },
    { shortcut: "F5", run: refresh, allowInInput: true },
    { shortcut: "Mod+-", run: () => setZoom("map"), enabled: hasRepository },
    { shortcut: "Mod+0", run: () => setZoom("thread"), enabled: hasRepository },
    { shortcut: "/", run: requestSearchFocus, enabled: hasRepository },
    { shortcut: "?", run: () => setSheet("shortcuts") },
    { shortcut: "Mod+Shift+F", run: () => network?.fetch(null).catch(ignore), enabled: hasRepository, allowInInput: true },
    { shortcut: "Mod+Shift+L", run: () => network?.pull(pullMode).catch(ignore), enabled: onTrackedBranch, allowInInput: true },
    {
      shortcut: "Mod+Shift+P",
      run: () => network?.push({ setUpstream: false, forceWithLease: false }).catch(ignore),
      enabled: onTrackedBranch,
      allowInInput: true,
    },
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
    if (attempted.current || repositories.data === undefined) return;
    attempted.current = true;
    const path: string | null = lastActiveRepositoryPath();
    if (path === null || useWorkspace.getState().activeRepositoryId !== null) return;
    const entry: RepositoryEntry | undefined = repositories.data.find((candidate) => candidate.path === path);
    // No longer registered (removed, or a different data directory): nothing to restore.
    if (entry === undefined) return;
    openRepository
      .mutateAsync(entry.id)
      .then((opened: RepositoryEntry) => activate(opened.id, opened.path))
      .catch((error: unknown) => setRestoreFailure({ repositoryId: entry.id, error: toIpcError(error) }));
  }, [repositories.data, openRepository, activate, setRestoreFailure]);
}
