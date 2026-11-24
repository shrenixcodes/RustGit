import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorNotice } from "../components/ErrorNotice";
import { useBranchOperation, type BranchOutcome } from "../services/queries";
import type { InProgress, StatusSnapshot } from "../services/types";
import { countChanges } from "../features/changes/changeLabels";
import { OutcomeNotice } from "./OutcomeNotice";

const NAMES: Record<Exclude<InProgress, "none">, string> = {
  merging: "merge",
  rebasing: "rebase",
  cherry_picking: "cherry-pick",
  reverting: "revert",
};

/**
 * Shown at the loose end while Git is in the middle of a merge, rebase,
 * cherry-pick or revert: how many conflicts are left, and the two ways out.
 */
export function OperationBanner({ repositoryId, status }: { repositoryId: number; status: StatusSnapshot }) {
  const operation = useBranchOperation(repositoryId);
  const [confirmAbort, setConfirmAbort] = useState<boolean>(false);
  const [outcome, setOutcome] = useState<BranchOutcome | null>(null);
  const [aborted, setAborted] = useState<boolean>(false);
  const [confirmSkip, setConfirmSkip] = useState<boolean>(false);
  // A new operation starting replaces whatever the last one reported.
  useEffect(() => {
    if (status.inProgress === "none") return;
    setAborted(false);
    setOutcome(null);
  }, [status.inProgress]);
  if (status.inProgress === "none" && outcome === null && !aborted) return null;

  const name: string = status.inProgress === "none" ? "operation" : NAMES[status.inProgress];
  const conflicts: number = countChanges(status.files).conflicted;

  return (
    <div role="region" aria-label={`${name} in progress`} className="shrink-0 space-y-2 border-b border-divider py-2.5 pr-5 pl-[72px]">
      {status.inProgress !== "none" && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            <span className="font-medium text-warning">A {name} is in progress.</span>{" "}
            <span className="text-fg-secondary">
              {conflicts > 0
                ? `${conflicts} conflicted file${conflicts === 1 ? "" : "s"} left: resolve ${conflicts === 1 ? "it" : "them"}, then continue.`
                : status.inProgress === "merging"
                  ? "Every conflict is resolved: continue with Git's message, or write your own above and commit."
                  : "Every conflict is resolved: continue to the next step."}
            </span>
          </p>
          <span className="flex-1" />
          <Button
            variant="primary"
            disabled={conflicts > 0 || operation.isPending}
            title={conflicts > 0 ? "Resolve every conflicted file first" : undefined}
            onClick={() => {
              setOutcome(null);
              setAborted(false);
              operation.mutate({ kind: "continue" }, { onSuccess: setOutcome });
            }}
          >
            Continue the {name}
          </Button>
          {status.inProgress !== "merging" && (
            <Button
              variant="secondary"
              disabled={operation.isPending}
              title="Leave this commit out and go on with the next one"
              onClick={() => setConfirmSkip(true)}
            >
              Skip this commit…
            </Button>
          )}
          <Button variant="danger" disabled={operation.isPending} onClick={() => setConfirmAbort(true)}>
            Abort…
          </Button>
        </div>
      )}
      {operation.error !== null && <ErrorNotice title={`Git did not continue the ${name}`} error={operation.error} />}
      {outcome !== null && <OutcomeNotice outcome={outcome} />}
      {aborted && (
        <p role="status" className="text-sm text-success">
          Aborted. The branch and working tree are back to where they were before.
        </p>
      )}
      {confirmSkip && (
        <ConfirmDialog
          title="Skip this commit?"
          confirmLabel="Skip commit"
          destructive
          busy={operation.isPending}
          onCancel={() => setConfirmSkip(false)}
          onConfirm={() => {
            setOutcome(null);
            setAborted(false);
            operation.mutate({ kind: "skip" }, { onSuccess: setOutcome, onSettled: () => setConfirmSkip(false) });
          }}
        >
          <p>
            Git leaves the commit being replayed out of the {name} and moves on to the next one. Use this when resolving
            the conflicts left nothing to commit, or when the change is not wanted. Changes made for this commit so far are
            discarded.
          </p>
        </ConfirmDialog>
      )}
      {confirmAbort && (
        <ConfirmDialog
          title={`Abort the ${name}?`}
          confirmLabel={`Abort the ${name}`}
          destructive
          busy={operation.isPending}
          onCancel={() => setConfirmAbort(false)}
          onConfirm={() =>
            operation.mutate(
              { kind: "abort" },
              {
                onSuccess: () => {
                  setOutcome(null);
                  setAborted(true);
                },
                onSettled: () => setConfirmAbort(false),
              },
            )
          }
        >
          <p>
            Git restores the branch and working tree to how they were before the {name} started. Conflict resolutions made
            so far are discarded.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
