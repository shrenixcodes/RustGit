import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { SwitcherPopover } from "./RepositorySwitcher";
import { formatShortcut } from "./shortcuts";
import { countChanges } from "../features/changes/changeLabels";
import { useRepositories, useRepositoryStatus } from "../services/queries";
import type { BranchStatus, InProgress, RepositoryEntry, StatusSnapshot } from "../services/types";
import { useUi } from "../stores/ui";
import { useWorkspace } from "../stores/workspace";

const IN_PROGRESS_LABEL: Record<Exclude<InProgress, "none">, string> = {
  merging: "merge in progress",
  rebasing: "rebase in progress",
  cherry_picking: "cherry-pick in progress",
  reverting: "revert in progress",
};

/**
 * The ridge: one line of repository context above every workspace (the
 * repository's name opens the switcher, then the branch path and the
 * working-tree state), with the current workspace's actions on the right.
 */
export function Ridge() {
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const showSection = useWorkspace((state) => state.showSection);
  const repositories = useRepositories();
  const status = useRepositoryStatus(activeRepositoryId);
  const open: boolean = useUi((state) => state.switcherOpen);
  const setOpen = useUi((state) => state.setSwitcherOpen);
  const setRidgeActions = useUi((state) => state.setRidgeActions);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const repository: RepositoryEntry | undefined = repositories.data?.find((entry) => entry.id === activeRepositoryId);

  const close = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <header
      aria-label="Repository"
      style={{ height: "var(--rg-header)" }}
      className="flex shrink-0 items-center gap-5 border-b border-divider bg-bg pl-5 pr-3"
    >
      <div ref={root} className="relative flex min-w-0 items-center">
        <button
          ref={trigger}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={repository === undefined ? "Choose a repository" : `Repository ${repository.name}. Switch repository`}
          title={`Switch repository (${formatShortcut("Mod+P")})`}
          onClick={() => setOpen(!open)}
          className="group flex min-w-0 items-center gap-1.5 rounded-sm py-1 pr-1 text-left"
        >
          <span className={`truncate text-lg font-semibold ${repository === undefined ? "text-fg-muted" : "text-fg"}`}>
            {repository?.name ?? "No repository"}
          </span>
          <ChevronDown
            aria-hidden
            className={`size-3.5 shrink-0 text-fg-muted transition-transform duration-100 group-hover:text-fg ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && <SwitcherPopover onClose={close} root={root} />}
      </div>

      {repository !== undefined && (
        <RepositoryState status={status.data} failed={status.isError} onShowChanges={() => showSection("changes")} />
      )}

      <span className="flex-1" />
      {/* Workspaces render their actions here through <RidgeActions>. */}
      <div ref={setRidgeActions} className="flex shrink-0 items-center gap-1" />
    </header>
  );
}

/** Renders the current workspace's actions at the right of the ridge. */
export function RidgeActions({ children }: { children: ReactNode }) {
  const target: HTMLElement | null = useUi((state) => state.ridgeActions);
  return target === null ? null : createPortal(children, target);
}

function RepositoryState({
  status,
  failed,
  onShowChanges,
}: {
  status: StatusSnapshot | undefined;
  failed: boolean;
  onShowChanges: () => void;
}) {
  if (status === undefined) {
    return <span className="text-sm text-fg-muted">{failed ? "status unavailable" : "reading…"}</span>;
  }
  const counts = countChanges(status.files);
  return (
    <div className="flex min-w-0 items-center gap-4 text-sm">
      <BranchPath branch={status.branch} />
      {status.inProgress !== "none" && (
        <span className="shrink-0 font-mono text-xs text-warning">{IN_PROGRESS_LABEL[status.inProgress]}</span>
      )}
      <button
        type="button"
        onClick={onShowChanges}
        className="shrink-0 rounded-sm font-mono text-xs text-fg-secondary hover:text-fg"
      >
        {counts.conflicted > 0 ? (
          <span className="text-danger">{counts.conflicted} conflicted</span>
        ) : status.files.length === 0 ? (
          <span className="text-fg-muted">clean</span>
        ) : (
          <span>{status.files.length} changed</span>
        )}
      </button>
    </div>
  );
}

/**
 * The branch written as a short path, in the graph's own language:
 * a point for the branch, a line to its upstream, and the distance.
 */
export function BranchPath({ branch }: { branch: BranchStatus }) {
  const detached: boolean = branch.head === null;
  return (
    <span className="flex min-w-0 items-center gap-2 font-mono text-xs">
      <svg aria-hidden width="8" height="8" viewBox="0 0 8 8" className="shrink-0">
        <circle cx="4" cy="4" r="3" fill={detached ? "var(--rg-clay)" : "var(--rg-accent)"} />
      </svg>
      <span className={`truncate ${detached ? "text-clay-text" : "text-fg"}`}>
        {branch.head ?? `detached at ${branch.oid?.slice(0, 7) ?? "?"}`}
      </span>
      {branch.upstream === null ? (
        <span className="shrink-0 text-fg-muted">no upstream</span>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5 text-fg-muted" title={`Compared with ${branch.upstream} as of the last fetch`}>
          <span aria-hidden className="h-px w-3 bg-border-control" />
          <span className="sr-only">upstream {branch.upstream},</span>
          <span className={branch.ahead > 0 ? "text-accent" : ""}>
            {branch.ahead}↑<span className="sr-only"> ahead,</span>
          </span>
          <span className={branch.behind > 0 ? "text-clay-text" : ""}>
            {branch.behind}↓<span className="sr-only"> behind</span>
          </span>
        </span>
      )}
    </span>
  );
}
