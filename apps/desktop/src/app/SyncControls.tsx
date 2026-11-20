import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, LoaderCircle, RefreshCcw } from "lucide-react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Menu, type MenuItem } from "../components/Menu";
import { networkActions, PULL_LABEL } from "../services/network";
import { useRemotes } from "../services/repositoryQueries";
import type { BranchStatus, OperationKind, PullMode, Remote } from "../services/types";
import { runningOperations, useOperations, type NetworkOperation } from "../stores/operations";
import { usePreferences } from "../stores/preferences";
import { useUi } from "../stores/ui";

const PULL_MODES: readonly PullMode[] = ["ff_only", "merge", "rebase"];

const CONTROL =
  "flex h-7 min-w-7 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 sm:px-2 font-sans text-xs font-medium text-fg-secondary transition-all hover:bg-hover hover:text-fg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";

/** "5 min ago" style age of the last successful fetch in this session. */
function useLastFetched(repositoryId: number): string {
  const operations = useOperations((state) => state.operations);
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  let latest: number | null = null;
  for (const operation of Object.values(operations)) {
    if (operation.repositoryId === repositoryId && operation.kind === "fetch" && operation.outcome === "succeeded") {
      if (operation.finishedAt !== null && (latest === null || operation.finishedAt > latest)) latest = operation.finishedAt;
    }
  }
  if (latest === null) return "not fetched in this session";
  const minutes: number = Math.floor(Math.max(0, now - latest) / 60_000);
  if (minutes < 1) return "fetched just now";
  if (minutes < 60) return `fetched ${minutes} min ago`;
  return `fetched ${Math.floor(minutes / 60)} h ago`;
}

/**
 * Fetch, pull and push for the current branch, next to its path in the
 * seal. Each starts a backend operation; progress, cancel and the result
 * appear in the shelf and the activity log. A failure to start is recorded
 * there too.
 */
export function SyncControls({ repositoryId, branch }: { repositoryId: number; branch: BranchStatus }) {
  const remotes = useRemotes(repositoryId);
  const operations = useOperations((state) => state.operations);
  const pullMode: PullMode = usePreferences((state) => state.pullMode);
  const setPullMode = usePreferences((state) => state.setPullMode);
  const setSheet = useUi((state) => state.setSheet);
  const [forcePush, setForcePush] = useState<boolean>(false);
  const lastFetched: string = useLastFetched(repositoryId);
  const actions = networkActions(repositoryId);
  const running: NetworkOperation[] = runningOperations(operations, repositoryId);
  const busy = (kind: OperationKind): boolean => running.some((operation) => operation.kind === kind);
  const list: Remote[] = remotes.data ?? [];
  const noRemotes: boolean = remotes.data !== undefined && list.length === 0;
  const onBranch: boolean = branch.head !== null;
  const hasUpstream: boolean = branch.upstream !== null;
  // Starting returns at once; failures are recorded in the activity log by startOperation.
  const ignore = (): void => {};

  if (noRemotes) {
    return (
      <button type="button" className={CONTROL} onClick={() => setSheet("remotes")} title="This repository has no remotes">
        add a remote…
      </button>
    );
  }

  // Running a mode once never changes the default; that has its own entries.
  const pullItems: MenuItem[] = [
    ...PULL_MODES.map((mode) => ({
      id: mode,
      label: PULL_LABEL[mode],
      hint: mode === pullMode ? "default" : undefined,
      disabled: !hasUpstream || busy("pull"),
      run: () => {
        actions.pull(mode).catch(ignore);
      },
    })),
    ...PULL_MODES.filter((mode) => mode !== pullMode).map((mode) => ({
      id: `default-${mode}`,
      label: `Make "${PULL_LABEL[mode]}" the default`,
      run: () => setPullMode(mode),
    })),
  ];

  const publishItems: MenuItem[] = list.map((remote) => ({
    id: remote.name,
    label: `Publish to ${remote.name}`,
    hint: remote.pushUrl ?? remote.fetchUrl ?? undefined,
    run: () => actions.push({ remote: remote.name, branch: branch.head, setUpstream: true, forceWithLease: false }).catch(ignore),
  }));

  const pushItems: MenuItem[] = [
    {
      id: "push",
      label: `Push ${branch.head ?? ""}`,
      hint: branch.upstream ?? undefined,
      disabled: !hasUpstream || busy("push"),
      run: () => actions.push({ setUpstream: false, forceWithLease: false }).catch(ignore),
    },
    {
      id: "force",
      label: "Force push with lease…",
      destructive: true,
      disabled: !hasUpstream || busy("push"),
      run: () => setForcePush(true),
    },
    ...publishItems.map((item) => ({ ...item, id: `publish-${item.id}`, label: `${item.label} and track it` })),
  ];

  return (
    <div role="group" aria-label="Sync" className="flex shrink-0 min-w-0 items-center rounded-lg border border-border/80 bg-elevated/70 p-0.5 shadow-2xs backdrop-blur-xs">
      <button
        type="button"
        className={CONTROL}
        disabled={busy("fetch") || remotes.data === undefined}
        onClick={() => actions.fetch(null).catch(ignore)}
        title={`Fetch all remotes and prune deleted remote branches (${lastFetched})`}
      >
        {busy("fetch") ? <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /> : <RefreshCcw aria-hidden className="size-3" />}
        <span className="hidden sm:inline">fetch</span>
      </button>
      <span className="hidden xl:inline px-2 font-sans text-xs text-fg-muted border-r border-divider/60" title="The ahead and behind counts only change after a fetch">
        {lastFetched}
      </span>

      <div className="flex items-center">
        <button
          type="button"
          className={CONTROL}
          disabled={!onBranch || !hasUpstream || busy("pull")}
          onClick={() => actions.pull(pullMode).catch(ignore)}
          title={hasUpstream ? `${PULL_LABEL[pullMode]} from ${branch.upstream}` : "The branch has no upstream to pull from"}
        >
          {busy("pull") ? <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /> : <ArrowDown aria-hidden className="size-3" />}
          <span className="hidden sm:inline">pull</span>
          {branch.behind > 0 && (
            <span className="rounded-full bg-clay/20 border border-clay/30 px-1.5 text-2xs font-bold text-clay-text">
              {branch.behind}
            </span>
          )}
        </button>
        <Menu
          label="Pull options"
          items={pullItems}
          disabled={!onBranch || !hasUpstream}
          className={`${CONTROL} px-1`}
          trigger={<ChevronDown aria-hidden className="size-3" />}
        />
      </div>

      <div className="flex items-center">
        {hasUpstream ? (
          <button
            type="button"
            className={CONTROL}
            disabled={!onBranch || busy("push")}
            onClick={() => actions.push({ setUpstream: false, forceWithLease: false }).catch(ignore)}
            title={`Push ${branch.head ?? ""} to ${branch.upstream ?? ""}`}
          >
            {busy("push") ? <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /> : <ArrowUp aria-hidden className="size-3" />}
            <span className="hidden sm:inline">push</span>
            {branch.ahead > 0 && (
              <span className="rounded-full bg-accent/20 border border-accent/30 px-1.5 text-2xs font-bold text-accent">
                {branch.ahead}
              </span>
            )}
          </button>
        ) : list.length === 1 && list[0] !== undefined ? (
          <button
            type="button"
            className={CONTROL}
            disabled={!onBranch || busy("push")}
            onClick={() => publishItems[0]?.run()}
            title={`Push ${branch.head ?? ""} to ${list[0].name} and track it`}
          >
            {busy("push") ? <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /> : <ArrowUp aria-hidden className="size-3" />}
            <span className="hidden sm:inline">publish</span>
          </button>
        ) : (
          <Menu
            label="Publish branch"
            items={publishItems}
            disabled={!onBranch || busy("push")}
            className={CONTROL}
            trigger={
              <>
                <ArrowUp aria-hidden className="size-3" />
                <span className="hidden sm:inline">publish</span>
              </>
            }
          />
        )}
        {hasUpstream && (
          <Menu
            label="Push options"
            items={pushItems}
            disabled={!onBranch}
            align="end"
            className={`${CONTROL} px-0.5`}
            trigger={<ChevronDown aria-hidden className="size-3" />}
          />
        )}
      </div>

      {forcePush && (
        <ConfirmDialog
          title={`Force push ${branch.head ?? ""}?`}
          confirmLabel="Force push with lease"
          destructive
          onCancel={() => setForcePush(false)}
          onConfirm={() => {
            setForcePush(false);
            actions.push({ setUpstream: false, forceWithLease: true }).catch(ignore);
          }}
        >
          <p>
            Replaces {branch.upstream} with your {branch.head}. Commits on the remote that you do not have are removed from the
            branch. Git refuses if the remote moved since your last fetch, or if that fetch brought in commits you have not
            merged or rebased onto, so work you have not seen is not lost silently.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
