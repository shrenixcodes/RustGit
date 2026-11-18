import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Command, Copy, Ellipsis, GitBranch, RefreshCw, Search, Settings } from "lucide-react";
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
    <header aria-label="Repository" className="flex h-12 shrink-0 items-center gap-4 border-b border-divider pr-3 pl-4">
      <div ref={root} className="relative flex min-w-0 items-center gap-2.5">
        <Mark size={20} />
        <button
          ref={trigger}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={switcherOpen}
          aria-label={repository === undefined ? "Choose a repository" : `Repository ${repository.name}. Switch repository`}
          title={`Switch repository (${formatShortcut("Mod+P")})`}
          onClick={() => setSwitcherOpen(!switcherOpen)}
          className="group flex min-w-0 items-center gap-1 rounded-sm py-1 text-left"
        >
          <span className={`truncate text-base font-semibold ${repository === undefined ? "text-fg-muted" : "text-fg"}`}>
            {repository?.name ?? "RustGit"}
          </span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-fg-muted group-hover:text-fg" />
        </button>
        {switcherOpen && <SwitcherPopover onClose={close} root={root} />}
      </div>

      {repository !== undefined && status.data !== undefined && (
        <div className="flex min-w-0 items-center gap-3">
          <BranchPath branch={status.data.branch} />
          <SyncControls repositoryId={repository.id} branch={status.data.branch} />
          {status.data.inProgress !== "none" && (
            <span className="shrink-0 font-mono text-xs text-warning">{IN_PROGRESS_LABEL[status.data.inProgress]}</span>
          )}
        </div>
      )}

      <span className="flex-1" />

      {repository !== undefined && (
        <>
          <label className="flex w-64 items-center gap-2 border-b border-border focus-within:border-accent">
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
              placeholder="message or commit id   /"
              className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-muted"
            />
          </label>
          <SegmentedControl label="Distance" options={ZOOMS} value={zoom} onChange={setZoom} />
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
            className="flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg"
            items={[
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
          className="flex h-6 items-center gap-1.5 rounded-full border border-border bg-elevated/60 px-2 font-mono text-2xs text-fg-secondary hover:border-accent hover:text-fg transition-colors"
        >
          <span className="size-1.5 rounded-full bg-accent" />
          <span>@{githubStatus.data.account.login}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setSheet("settings")}
          title="Connect GitHub account"
          className="flex h-6 items-center gap-1 rounded-full border border-border/80 px-2 font-mono text-2xs text-fg-muted hover:border-border-control hover:text-fg transition-colors"
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
        className="flex h-6 items-center gap-1 rounded-sm border border-border px-1.5 font-mono text-2xs text-fg-muted hover:border-border-control hover:text-fg"
      >
        <Command aria-hidden className="size-3" />
        {formatShortcut("Mod+K")}
      </button>
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
      <span className="group inline-flex items-center gap-1 rounded border border-border/60 bg-elevated/40 px-1.5 py-0.5">
        <GitBranch aria-hidden className={`size-3 shrink-0 ${detached ? "text-clay-text" : "text-accent"}`} />
        <span className={`truncate font-medium ${detached ? "text-clay-text" : "text-fg"}`}>
          {branch.head ?? `detached at ${branch.oid?.slice(0, 7) ?? "?"}`}
        </span>
        {branch.head !== null && (
          <button
            type="button"
            onClick={() => copyBranch(branch.head!)}
            title={copied ? "Copied branch name" : "Copy branch name"}
            aria-label={copied ? "Copied branch name" : "Copy branch name"}
            className="ml-0.5 rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:bg-hover hover:text-fg group-hover:opacity-100"
          >
            {copied ? <Check aria-hidden className="size-2.5 text-success" /> : <Copy aria-hidden className="size-2.5" />}
          </button>
        )}
      </span>
      {branch.upstream === null ? (
        <span className="shrink-0 text-fg-muted">no upstream</span>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5 text-fg-muted" title={`Compared with ${branch.upstream} as of the last fetch`}>
          <span aria-hidden className="h-px w-3 bg-border-control" />
          <span className="sr-only">upstream {branch.upstream},</span>
          <span className={branch.ahead > 0 ? "rounded bg-accent/15 px-1 py-0.2 font-semibold text-accent" : ""}>
            {branch.ahead}↑<span className="sr-only"> ahead,</span>
          </span>
          <span className={branch.behind > 0 ? "rounded bg-clay/15 px-1 py-0.2 font-semibold text-clay-text" : ""}>
            {branch.behind}↓<span className="sr-only"> behind</span>
          </span>
        </span>
      )}
    </span>
  );
}
