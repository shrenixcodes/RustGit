import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorNotice } from "../components/ErrorNotice";
import type { IpcError } from "../services/ipc";
import { networkActions } from "../services/network";
import { useBranchOperation, useRefs, type BranchOutcome, type BranchRequest } from "../services/queries";
import { useRemotes } from "../services/repositoryQueries";
import type { RefEntry, Remote } from "../services/types";
import { describeRef, upstreamState } from "../features/history/RefBadges";
import { formatRelative } from "../features/history/time";
import { OutcomeNotice } from "./OutcomeNotice";
import { useUi } from "../stores/ui";

interface MapFoldProps {
  repositoryId: number;
  oid: string;
  refs: readonly RefEntry[];
  currentBranch: string | null;
  /** The working tree has changes (switching keeps them when Git can). */
  dirty: boolean;
  height: number;
  /** Left padding that clears the graph lanes running through the fold. */
  inset: number;
}

/** "origin/feature/x" → remote "origin", branch "feature/x" (remote names may contain "/"; the longest match wins). */
export function splitRemoteRef(shortName: string, remotes: readonly Remote[]): { remote: string; branch: string } | null {
  const match: Remote | undefined = [...remotes]
    .sort((a, b) => b.name.length - a.name.length)
    .find((remote) => shortName.startsWith(`${remote.name}/`));
  if (match === undefined) return null;
  const branch: string = shortName.slice(match.name.length + 1);
  return branch === "" || branch === "HEAD" ? null : { remote: match.name, branch };
}

interface Pending {
  request: BranchRequest | { kind: "delete_remote"; remote: string; branch: string };
  title: string;
  body: string;
  label: string;
  destructive: boolean;
}

/**
 * A node on the map, unfolded: the branches that point at it, how each
 * relates to its upstream and to the current branch, and the operations
 * that apply to it. Every operation runs in the backend; risky ones confirm.
 */
export function MapFold({ repositoryId, oid, refs, currentBranch, dirty, height, inset }: MapFoldProps) {
  const operation = useBranchOperation(repositoryId);
  const [pending, setPending] = useState<Pending | null>(null);
  const [outcome, setOutcome] = useState<BranchOutcome | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState<string>("");
  const [creating, setCreating] = useState<boolean>(false);
  const [lastRequest, setLastRequest] = useState<BranchRequest | null>(null);
  const [tracking, setTracking] = useState<string | null>(null);
  const [trackTarget, setTrackTarget] = useState<string>("");
  const remotesQuery = useRemotes(repositoryId);
  const remoteList: Remote[] = remotesQuery.data ?? [];
  const allRefs = useRefs(repositoryId);
  const remoteRefNames: string[] = (allRefs.data?.refs ?? [])
    .filter((entry) => entry.kind === "remote" && !entry.shortName.endsWith("/HEAD"))
    .map((entry) => entry.shortName);
  const network = networkActions(repositoryId);
  const openCompare = useUi((state) => state.openCompare);
  const ignore = (): void => {};
  const confirmPending = (request: Pending["request"]): void => {
    if (request.kind === "delete_remote") {
      setPending(null);
      network.deleteRemoteBranch(request.remote, request.branch).catch(ignore);
    } else run(request);
  };

  const run = (request: BranchRequest): void => {
    setOutcome(null);
    setLastRequest(request);
    operation.mutate(request, {
      onSuccess: (result) => {
        setOutcome(result);
        setRenaming(null);
        setCreating(false);
        setNewName("");
      },
      onSettled: () => setPending(null),
    });
  };

  const submitName = (event: FormEvent): void => {
    event.preventDefault();
    const name: string = newName.trim();
    if (name === "") return;
    if (renaming !== null) run({ kind: "rename", from: renaming, to: name });
    else run({ kind: "create", name, startPoint: oid, checkout: false });
  };

  const locals: RefEntry[] = refs.filter((ref) => ref.kind === "local");
  const remotes: RefEntry[] = refs.filter((ref) => ref.kind === "remote");
  const tags: RefEntry[] = refs.filter((ref) => ref.kind === "tag");

  return (
    <div style={{ height, paddingLeft: inset }} className="overflow-y-auto pr-5 pb-3">
      <div className="space-y-3 pt-2">
        {locals.map((ref) => {
          const current: boolean = ref.shortName === currentBranch;
          return (
            <BranchLine key={ref.fullName} entry={ref} current={current}>
              {!current && (
                <Button
                  variant="ghost"
                  disabled={operation.isPending}
                  onClick={() =>
                    dirty
                      ? setPending({
                          request: { kind: "checkout", name: ref.shortName },
                          title: `Switch to ${ref.shortName}?`,
                          body: "You have uncommitted changes. Git carries them over when they do not conflict with the other branch; if they would be overwritten, nothing changes and the files are listed.",
                          label: "Switch",
                          destructive: false,
                        })
                      : run({ kind: "checkout", name: ref.shortName })
                  }
                >
                  Switch
                </Button>
              )}
              {!current && currentBranch !== null && (
                <>
                  <Button
                    variant="ghost"
                    disabled={operation.isPending}
                    onClick={() =>
                      setPending({
                        request: { kind: "merge", source: ref.shortName },
                        title: `Merge ${ref.shortName} into ${currentBranch}?`,
                        body: `Brings the commits of ${ref.shortName} into ${currentBranch}. A merge commit is created unless ${currentBranch} can fast-forward. Conflicts stop the merge for you to resolve or abort.`,
                        label: "Merge",
                        destructive: false,
                      })
                    }
                  >
                    Merge into {currentBranch}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={operation.isPending}
                    onClick={() =>
                      setPending({
                        request: { kind: "rebase", onto: ref.shortName },
                        title: `Rebase ${currentBranch} onto ${ref.shortName}?`,
                        body: `Replays the commits of ${currentBranch} that are not on ${ref.shortName} on top of it. Those commits get new ids; if ${currentBranch} was already pushed, pushing afterwards needs force-with-lease.`,
                        label: "Rebase",
                        destructive: true,
                      })
                    }
                  >
                    Rebase {currentBranch} onto it
                  </Button>
                  <Button variant="ghost" onClick={() => openCompare(currentBranch, ref.shortName)}>
                    Compare with {currentBranch}
                  </Button>
                </>
              )}
              {ref.upstream !== null && !ref.upstreamGone && (
                <Button
                  variant="ghost"
                  onClick={() => network.push({ branch: ref.shortName, setUpstream: false, forceWithLease: false }).catch(ignore)}
                >
                  Push to {ref.upstream}
                </Button>
              )}
              {ref.upstream === null &&
                remoteList.slice(0, 3).map((remote: Remote) => (
                  <Button
                    key={remote.name}
                    variant="ghost"
                    onClick={() => network.push({ remote: remote.name, branch: ref.shortName, setUpstream: true, forceWithLease: false }).catch(ignore)}
                  >
                    Publish to {remote.name}
                  </Button>
                ))}
              <Button
                variant="ghost"
                disabled={operation.isPending}
                onClick={() => {
                  setTracking(ref.shortName);
                  setTrackTarget(ref.upstream ?? remoteRefNames.find((name) => name.endsWith(`/${ref.shortName}`)) ?? remoteRefNames[0] ?? "");
                }}
              >
                {ref.upstream === null ? "Track…" : "Change tracking…"}
              </Button>
              <Button variant="ghost" disabled={operation.isPending} onClick={() => { setRenaming(ref.shortName); setCreating(false); setNewName(ref.shortName); }}>
                Rename…
              </Button>
              {!current && (
                <Button
                  variant="ghost"
                  className="ml-auto text-danger! hover:bg-danger/10"
                  disabled={operation.isPending}
                  onClick={() =>
                    setPending({
                      request: { kind: "delete", name: ref.shortName, force: false },
                      title: `Delete branch ${ref.shortName}?`,
                      body: "Git deletes the branch only if its commits are merged elsewhere; otherwise you will be asked again.",
                      label: "Delete branch",
                      destructive: true,
                    })
                  }
                >
                  Delete…
                </Button>
              )}
            </BranchLine>
          );
        })}

        {remotes.map((ref) => (
          <BranchLine key={ref.fullName} entry={ref} current={false}>
            <Button variant="ghost" disabled={operation.isPending} onClick={() => run({ kind: "checkout", name: ref.shortName })}>
              Check out as a local branch
            </Button>
            {currentBranch !== null && (
              <Button
                variant="ghost"
                disabled={operation.isPending}
                onClick={() =>
                  setPending({
                    request: { kind: "merge", source: ref.shortName },
                    title: `Merge ${ref.shortName} into ${currentBranch}?`,
                    body: `Brings the commits of ${ref.shortName} (as of the last fetch) into ${currentBranch}.`,
                    label: "Merge",
                    destructive: false,
                  })
                }
              >
                Merge into {currentBranch}
              </Button>
            )}
            <Button variant="ghost" onClick={() => openCompare(currentBranch ?? "HEAD", ref.shortName)}>
              Compare with {currentBranch ?? "HEAD"}
            </Button>
            {splitRemoteRef(ref.shortName, remoteList) !== null && (
              <Button
                variant="ghost"
                onClick={() => {
                  const target = splitRemoteRef(ref.shortName, remoteList);
                  if (target === null) return;
                  setPending({
                    request: { kind: "delete_remote", ...target },
                    title: `Delete ${target.branch} on ${target.remote}?`,
                    body: `Deletes the branch on the remote for everyone who uses ${target.remote}. Its commits stay wherever else they are; anyone who has not fetched them yet loses access through this branch.`,
                    label: "Delete on remote",
                    destructive: true,
                  });
                }}
              >
                Delete on remote…
              </Button>
            )}
          </BranchLine>
        ))}

        {tags.map((ref) => (
          <BranchLine key={ref.fullName} entry={ref} current={false} />
        ))}

        {tracking !== null && (
          <form
            aria-label={`Tracking for ${tracking}`}
            onSubmit={(event) => {
              event.preventDefault();
              run({ kind: "set_upstream", name: tracking, upstream: trackTarget === "" ? null : trackTarget });
              setTracking(null);
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <label className="flex items-center gap-2 font-mono text-xs">
              <span className="text-fg-muted">{tracking} tracks</span>
              <select
                autoFocus
                value={trackTarget}
                onChange={(event) => setTrackTarget(event.target.value)}
                className="h-7 rounded-sm border border-border bg-elevated px-1 font-mono text-xs text-fg"
              >
                <option value="">nothing (stop tracking)</option>
                {remoteRefNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="primary" disabled={operation.isPending}>
              Set tracking
            </Button>
            <Button variant="ghost" onClick={() => setTracking(null)}>
              Cancel
            </Button>
          </form>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!creating && renaming === null && (
            <Button variant="ghost" onClick={() => { setCreating(true); setNewName(""); }}>
              Create a branch here…
            </Button>
          )}
          {(creating || renaming !== null) && (
            <form onSubmit={submitName} className="flex items-center gap-2">
              <label className="flex items-center gap-2 border-b border-border focus-within:border-accent">
                <span className="sr-only">{renaming !== null ? `New name for ${renaming}` : "New branch name"}</span>
                <input
                  autoFocus
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setCreating(false);
                      setRenaming(null);
                    }
                  }}
                  placeholder={renaming !== null ? renaming : "feature/name"}
                  className="h-7 w-56 bg-transparent font-mono text-xs outline-none"
                />
              </label>
              <Button type="submit" variant="primary" disabled={newName.trim() === "" || operation.isPending}>
                {renaming !== null ? "Rename" : `Create at ${oid.slice(0, 7)}`}
              </Button>
              <Button variant="ghost" onClick={() => { setCreating(false); setRenaming(null); }}>
                Cancel
              </Button>
            </form>
          )}
        </div>

        {operation.error !== null && (
          <OperationError
            error={operation.error}
            request={lastRequest}
            onForceDelete={(name) =>
              setPending({
                request: { kind: "delete", name, force: true },
                title: `Delete ${name} with unmerged commits?`,
                body: `Its commits are not on any other branch. After deleting, they can only be recovered from the reflog for a limited time.`,
                label: "Delete anyway",
                destructive: true,
              })
            }
          />
        )}
        {outcome !== null && <OutcomeNotice outcome={outcome} />}
      </div>

      {pending !== null && (
        <ConfirmDialog
          title={pending.title}
          confirmLabel={pending.label}
          destructive={pending.destructive}
          busy={operation.isPending}
          onCancel={() => setPending(null)}
          onConfirm={() => confirmPending(pending.request)}
        >
          <p>{pending.body}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function BranchLine({ entry, current, children }: { entry: RefEntry; current: boolean; children?: ReactNode }) {
  const relation: string | null = entry.kind === "local" ? upstreamState(entry) : null;
  return (
    <div className="rounded-xl border border-border/80 bg-elevated/50 p-3.5 shadow-2xs space-y-2.5 transition-all hover:border-border-control">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-xs font-semibold ${current ? "text-accent" : entry.kind === "remote" ? "text-indigo-text" : entry.kind === "tag" ? "text-clay-text" : "text-fg"}`}>
            {entry.shortName}
          </span>
          {current && (
            <span className="rounded-full bg-accent/15 border border-accent/25 px-1.5 py-0.2 font-mono text-2xs font-semibold text-accent">
              current
            </span>
          )}
          <span className="text-2xs text-fg-muted font-sans">{describeRef(entry, current).replace(` ${entry.shortName}`, "")}</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-2xs text-fg-muted">
          {relation !== null && (
            <span className="rounded bg-canvas/60 border border-border/70 px-1.5 py-0.5 text-fg-secondary">
              {entry.upstream !== null ? `${entry.upstream} · ${relation}` : relation}
            </span>
          )}
          <span>last commit {formatRelative(entry.lastCommitTime)}</span>
        </div>
      </div>
      {children !== undefined && <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/50">{children}</div>}
    </div>
  );
}

function OperationError({
  error,
  request,
  onForceDelete,
}: {
  error: IpcError;
  request: BranchRequest | null;
  onForceDelete: (name: string) => void;
}) {
  if (error.kind === "would_overwrite_changes") {
    const paths: string[] = error.details?.paths ?? [];
    return (
      <div role="alert" className="border-l-2 border-warning py-1 pl-3 text-sm">
        <p className="text-fg">Nothing changed: switching would overwrite your uncommitted changes{paths.length > 0 ? " in:" : "."}</p>
        {paths.length > 0 && <p className="mt-1 font-mono text-xs text-fg-secondary">{paths.join("\n")}</p>}
        <p className="mt-1 text-xs text-fg-muted">Commit or discard those changes at the loose end, then switch.</p>
      </div>
    );
  }
  if (error.kind === "branch_not_fully_merged" && request?.kind === "delete") {
    return (
      <div role="alert" className="border-l-2 border-warning py-1 pl-3 text-sm">
        <p className="text-fg">{request.name} has commits that are not merged anywhere else, so Git kept it.</p>
        <Button variant="danger" className="mt-2" onClick={() => onForceDelete(request.name)}>
          Delete anyway…
        </Button>
      </div>
    );
  }
  return <ErrorNotice title="Git did not complete the operation" error={error} />;
}
