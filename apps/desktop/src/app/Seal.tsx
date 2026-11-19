import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Command, Copy, Ellipsis, FolderGit2, FolderPlus, GitBranch, Plus, RefreshCw, Search, Settings } from "lucide-react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { IconButton } from "../components/Button";
import { Mark } from "../components/Mark";
import { Menu, type MenuItem } from "../components/Menu";
import { SegmentedControl, type SegmentOption } from "../components/SegmentedControl";
import { SwitcherPopover } from "./RepositorySwitcher";
import { SyncControls } from "./SyncControls";
import { formatShortcut } from "./shortcuts";
import { useGithubStatus } from "../services/github";
import { queryKeys, useRepositories, useRepositoryStatus } from "../services/queries";
import type { BranchStatus, InProgress, RepositoryEntry } from "../services/types";
import { usePreferences, type Zoom } from "../stores/preferences";
import { useUi } from "../stores/ui";
import { useWorkspace } from "../stores/workspace";

const ZOOMS: readonly SegmentOption<Zoom>[] = [
  { value: "thread", label: "Thread" },
  { value: "map", label: "Map" },
];

const IN_PROGRESS_LABEL: Record<Exclude<InProgress, "none">, string> = {
  merging: "merge in progress",
  rebasing: "rebase in progress",
  cherry_picking: "cherry-pick in progress",
  reverting: "revert in progress",
};

/**
 * The seal: the repository's identity in the corner (its name opens the
 * switcher, then the branch path), and the few controls that act on the
 * whole thread: search, distance, refresh, settings and commands.
 */
export function Seal() {
  const client: QueryClient = useQueryClient();
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const repositories = useRepositories();
  const status = useRepositoryStatus(activeRepositoryId);
  const githubStatus = useGithubStatus();
  const switcherOpen: boolean = useUi((state) => state.switcherOpen);
  const switcherView = useUi((state) => state.switcherView);
  const openSwitcher = useUi((state) => state.openSwitcher);
  const setSwitcherOpen = useUi((state) => state.setSwitcherOpen);
  const setPaletteOpen = useUi((state) => state.setPaletteOpen);
  const setSheet = useUi((state) => state.setSheet);
  const search: string = useUi((state) => state.search);
  const setSearch = useUi((state) => state.setSearch);
  const searchFocusRequest: number = useUi((state) => state.searchFocusRequest);
  const zoom: Zoom = usePreferences((state) => state.zoom);
  const setZoom = usePreferences((state) => state.setZoom);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const repository: RepositoryEntry | undefined = repositories.data?.find((entry) => entry.id === activeRepositoryId);

  useEffect(() => {
    if (searchFocusRequest > 0) searchInput.current?.focus();
  }, [searchFocusRequest]);

  const close = (): void => {
    setSwitcherOpen(false);
    trigger.current?.focus();
  };

  return (
    <header
      aria-label="Repository"
      className="relative flex h-13 shrink-0 items-center justify-between gap-2 sm:gap-3 border-b border-border/70 px-3 sm:px-4 select-none backdrop-blur-md transition-colors"
      style={{
        backgroundImage:
          "linear-gradient(180deg, color-mix(in oklab, var(--rg-elevated) 70%, transparent) 0%, var(--rg-bg) 100%)",
      }}
    >
      {/* Zone 1: Repository Identity & Branch */}
      <div ref={root} className="flex min-w-0 items-center gap-2 sm:gap-2.5">
        <div className="flex items-center gap-1.5 shrink-0">
          <Mark size={22} />
        </div>

        {repository === undefined ? (
          <button
            ref={trigger}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={switcherOpen}
            aria-label="Choose a repository"
            title={`Open or switch repository (${formatShortcut("Mod+P")})`}
            onClick={() => {
              if (switcherOpen) setSwitcherOpen(false);
              else openSwitcher("list");
            }}
            className="group flex min-w-0 items-center gap-2 rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-left text-accent shadow-2xs transition-all hover:bg-accent/25 hover:border-accent active:scale-[0.98]"
          >
            <FolderPlus className="size-4 shrink-0 text-accent" />
            <span className="truncate text-xs font-semibold tracking-tight">Open or Create Repository</span>
            <ChevronDown aria-hidden className="size-3.5 shrink-0 text-accent/80 transition-transform duration-150 group-hover:text-accent group-aria-expanded:rotate-180" />
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              ref={trigger}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={switcherOpen && switcherView === "list"}
              aria-label={`Repository ${repository.name}. Switch repository`}
              title={`Switch repository (${formatShortcut("Mod+P")})`}
              onClick={() => {
                if (switcherOpen && switcherView === "list") setSwitcherOpen(false);
                else openSwitcher("list");
              }}
              className="group flex min-w-0 max-w-[160px] sm:max-w-[240px] items-center gap-2 rounded-lg border border-border/80 bg-elevated/70 px-2.5 py-1 text-left shadow-2xs transition-all hover:border-accent hover:bg-elevated hover:text-fg active:scale-[0.98]"
            >
              <FolderGit2 className="size-3.5 shrink-0 text-accent" />
              <span className="truncate text-xs font-semibold tracking-tight text-fg">
                {repository.name}
              </span>
              <ChevronDown aria-hidden className="size-3 shrink-0 text-fg-muted transition-transform duration-150 group-hover:text-fg group-aria-expanded:rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (switcherOpen && switcherView === "create") setSwitcherOpen(false);
                else openSwitcher("create");
              }}
              title={`Create new repository (${formatShortcut("Mod+N")})`}
              aria-label="Create new repository"
              className="flex h-7 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/15 px-2.5 text-xs font-semibold text-accent hover:bg-accent/25 active:scale-95 transition-all shadow-2xs"
            >
              <Plus className="size-3.5" />
              <span className="font-sans text-xs">New</span>
            </button>
          </div>
        )}
        {switcherOpen && <SwitcherPopover onClose={close} root={root} />}

        {repository !== undefined && status.data !== undefined && (
          <div className="hidden md:flex min-w-0 items-center gap-2.5 pl-1">
            <span aria-hidden className="h-4 w-px bg-border/60 shrink-0" />
            <BranchPath branch={status.data.branch} />
            {status.data.inProgress !== "none" && (
              <span className="shrink-0 rounded-md border border-warning/40 bg-warning/15 px-2 py-0.5 font-mono text-2xs font-semibold text-warning animate-pulse">
                {IN_PROGRESS_LABEL[status.data.inProgress]}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Zone 2: View Navigation & Instant Filter */}
      {repository !== undefined && (
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="hidden sm:inline-flex shrink-0">
            <SegmentedControl label="Distance" options={ZOOMS} value={zoom} onChange={setZoom} />
          </div>
          <label className="flex w-28 sm:w-44 md:w-56 focus-within:w-64 min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-canvas/70 px-2.5 py-1 shadow-2xs transition-all focus-within:border-accent focus-within:bg-canvas focus-within:ring-1 focus-within:ring-accent/30">
            <Search aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
            <span className="sr-only">Search the thread</span>
            <input
              ref={searchInput}
              type="search"
              aria-label="Search the thread"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearch("");
                  event.currentTarget.blur();
                }
              }}
              placeholder="Search commits or IDs"
              className="h-5 min-w-0 flex-1 bg-transparent font-sans text-xs text-fg outline-none placeholder:text-fg-muted/70"
            />
            {search === "" ? (
              <kbd className="hidden sm:inline-flex h-4 items-center rounded border border-border/70 bg-elevated px-1 font-mono text-2xs text-fg-muted">
                /
              </kbd>
            ) : (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-fg-muted hover:text-fg text-xs"
                title="Clear search"
              >
                ×
              </button>
            )}
          </label>
        </div>
      )}

      {/* Zone 3: Sync & Actions */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {repository !== undefined && status.data !== undefined && (
          <SyncControls repositoryId={repository.id} branch={status.data.branch} />
        )}

        {repository !== undefined && (
          <>
            <IconButton
              label="Refresh"
              shortcut="Mod+R"
              onClick={() => void client.invalidateQueries({ queryKey: queryKeys.repository(repository.id) })}
            >
              <RefreshCw aria-hidden className="size-3.5" />
            </IconButton>
            <Menu
              label="Repository tools"
              align="end"
              className="flex size-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg active:scale-95"
              items={[
                { id: "new_repo", label: "Create new repository…", run: () => openSwitcher("create") },
                { id: "clone_repo", label: "Clone repository…", run: () => openSwitcher("clone") },
                { id: "manage_repos", label: "Manage all repositories…", run: () => setSheet("repositories") },
                { id: "compare", label: "Compare branches…", run: () => setSheet("compare") },
                { id: "remotes", label: "Remotes…", run: () => setSheet("remotes") },
                { id: "stashes", label: "Stash…", run: () => setSheet("stashes") },
                { id: "worktrees", label: "Worktrees…", run: () => setSheet("worktrees") },
              ] satisfies MenuItem[]}
              trigger={<Ellipsis aria-hidden className="size-3.5" />}
            />
          </>
        )}

        {githubStatus.data?.account ? (
          <button
            type="button"
            onClick={() => setSheet("settings")}
            title={`GitHub: @${githubStatus.data.account.login} (Manage account)`}
            className="hidden lg:flex h-7 items-center gap-1.5 rounded-full border border-border/80 bg-elevated/70 px-2.5 font-mono text-xs text-fg-secondary transition-all hover:border-accent hover:bg-elevated hover:text-fg active:scale-95"
          >
            <span className="size-2 rounded-full bg-success ring-2 ring-success/20" />
            <span>@{githubStatus.data.account.login}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setSheet("settings")}
            title="Connect GitHub account"
            className="hidden lg:flex h-7 items-center gap-1.5 rounded-full border border-border/80 bg-canvas/40 px-2.5 font-sans text-xs text-fg-muted transition-all hover:border-border-control hover:bg-elevated/50 hover:text-fg active:scale-95"
          >
            <span>Connect GitHub</span>
          </button>
        )}

        <IconButton label="Settings" shortcut="Mod+," onClick={() => setSheet("settings")}>
          <Settings aria-hidden className="size-3.5" />
        </IconButton>

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          title={`Commands (${formatShortcut("Mod+K")})`}
          className="hidden md:flex h-7 items-center gap-1.5 rounded-md border border-border/80 bg-canvas/60 px-2 font-mono text-xs text-fg-muted transition-all hover:border-border-control hover:bg-elevated hover:text-fg active:scale-95"
        >
          <Command aria-hidden className="size-3" />
          <span className="font-sans text-2xs">{formatShortcut("Mod+K")}</span>
        </button>
      </div>
    </header>
  );
}

/** The branch written as a short path in the graph's own language: a point, a line to its upstream, the distance. */
export function BranchPath({ branch }: { branch: BranchStatus }) {
  const detached: boolean = branch.head === null;
  const [copied, setCopied] = useState<boolean>(false);

  const copyBranch = (name: string): void => {
    void navigator.clipboard?.writeText(name).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <span className="flex min-w-0 items-center gap-2 font-mono text-xs">
      <span className="group inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-elevated/50 px-2 py-0.5 shadow-2xs backdrop-blur-xs">
        <GitBranch aria-hidden className={`size-3.5 shrink-0 ${detached ? "text-clay-text" : "text-accent"}`} />
        <span className={`max-w-[100px] sm:max-w-[180px] md:max-w-[220px] truncate font-medium ${detached ? "text-clay-text" : "text-fg"}`}>
          {branch.head ?? `detached at ${branch.oid?.slice(0, 7) ?? "?"}`}
        </span>
        {branch.head !== null && (
          <button
            type="button"
            onClick={() => copyBranch(branch.head!)}
            title={copied ? "Copied branch name" : "Copy branch name"}
            aria-label={copied ? "Copied branch name" : "Copy branch name"}
            className="ml-0.5 rounded p-0.5 text-fg-muted opacity-0 transition-all hover:bg-hover hover:text-fg group-hover:opacity-100"
          >
            {copied ? <Check aria-hidden className="size-2.5 text-success" /> : <Copy aria-hidden className="size-2.5" />}
          </button>
        )}
      </span>
      {branch.upstream === null ? (
        <span className="shrink-0 text-fg-muted/70 text-2xs">no upstream</span>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5 text-fg-muted" title={`Compared with ${branch.upstream} as of the last fetch`}>
          <span aria-hidden className="h-px w-3 bg-border-control/60" />
          <span className="sr-only">upstream {branch.upstream},</span>
          {branch.ahead > 0 && (
            <span className="rounded-full bg-accent/15 border border-accent/25 px-1.5 py-0.2 font-semibold text-accent text-2xs">
              {branch.ahead}↑<span className="sr-only"> ahead,</span>
            </span>
          )}
          {branch.behind > 0 && (
            <span className="rounded-full bg-clay/15 border border-clay/25 px-1.5 py-0.2 font-semibold text-clay-text text-2xs">
              {branch.behind}↓<span className="sr-only"> behind</span>
            </span>
          )}
        </span>
      )}
    </span>
  );
}
