import { useState } from "react";
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
  "flex h-6 items-center gap-1 rounded-sm px-1.5 font-mono text-xs text-fg-secondary hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-45";

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

  const pullItems: MenuItem[] = PULL_MODES.map((mode) => ({
    id: mode,
    label: PULL_LABEL[mode],
    hint: mode === pullMode ? "default" : undefined,
    disabled: !hasUpstream || busy("pull"),
    run: () => {
      setPullMode(mode);
      actions.pull(mode).catch(ignore);
    },
  }));

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
    <div role="group" aria-label="Sync" className="flex shrink-0 items-center">
      <button
        type="button"
        className={CONTROL}
        disabled={busy("fetch") || remotes.data === undefined}
        onClick={() => actions.fetch(null).catch(ignore)}
        title="Fetch all remotes and prune deleted remote branches"
      >
        {busy("fetch") ? <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /> : <RefreshCcw aria-hidden className="size-3" />}
        fetch
      </button>

      <div className="flex items-center">
        <button
          type="button"
          className={CONTROL}
          disabled={!onBranch || !hasUpstream || busy("pull")}
          onClick={() => actions.pull(pullMode).catch(ignore)}
          title={hasUpstream ? `${PULL_LABEL[pullMode]} from ${branch.upstream}` : "The branch has no upstream to pull from"}
        >
          {busy("pull") ? <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /> : <ArrowDown aria-hidden className="size-3" />}
          pull
          {branch.behind > 0 && <span className="text-clay-text">{branch.behind}</span>}
        </button>
        <Menu
          label="Pull options"
          items={pullItems}
          disabled={!onBranch || !hasUpstream}
          className={`${CONTROL} px-0.5`}
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
            push
            {branch.ahead > 0 && <span className="text-accent">{branch.ahead}</span>}
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
            publish
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
                publish
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
            branch. The lease makes Git refuse if the remote moved since your last fetch, so nobody else's new work is lost
            silently.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
