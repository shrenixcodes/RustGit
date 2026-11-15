import { useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { formatShortcut } from "../../app/shortcuts";
import { useCommitContext, useCreateCommit, useStagedTotals } from "../../services/queries";
import type { CommitContext, CommitResult, StatusSnapshot } from "../../services/types";
import { EMPTY_DRAFT, useUi, type CommitDraft } from "../../stores/ui";
import { countChanges } from "./changeLabels";

/** Summary length after which Git tooling usually truncates; guidance only. */
const SUMMARY_GUIDE = 72;

export function composeMessage(summary: string, description: string): string {
  const body: string = description.trim();
  return body === "" ? summary.trim() : `${summary.trim()}\n\n${body}`;
}

export function splitMessage(message: string): { summary: string; description: string } {
  const [summary = "", ...rest] = message.replace(/\s+$/, "").split("\n");
  return { summary, description: rest.join("\n").replace(/^\n+/, "") };
}

/**
 * The next commit, composed beside what it describes: staged totals, the
 * message, amend, identity, and Git's own output when it refuses.
 */
export function CommitComposer({ repositoryId, status }: { repositoryId: number; status: StatusSnapshot }) {
  const totals = useStagedTotals(repositoryId);
  const context = useCommitContext(repositoryId);
  const commit = useCreateCommit(repositoryId);
  const draft: CommitDraft = useUi((state) => state.commitDrafts[repositoryId] ?? EMPTY_DRAFT);
  const setDraft = useUi((state) => state.setCommitDraft);
  const updateDraft = useUi((state) => state.updateCommitDraft);
  const [done, setDone] = useState<CommitResult | null>(null);

  const update = (patch: Partial<CommitDraft>): void => {
    setDone(null);
    commit.reset();
    updateDraft(repositoryId, patch);
  };

  const ctx: CommitContext | undefined = context.data;
  const stagedFiles: number = countChanges(status.files).staged;
  const merging: boolean = status.inProgress === "merging";
  const identityMissing: boolean = ctx !== undefined && (ctx.authorName === null || ctx.authorEmail === null);
  const hasContent: boolean = stagedFiles > 0 || draft.amend || merging;
  const canCommit: boolean =
    draft.summary.trim() !== "" && hasContent && ctx !== undefined && !identityMissing && !commit.isPending;

  const toggleAmend = (amend: boolean): void => {
    if (amend && draft.summary.trim() === "" && draft.description.trim() === "" && ctx?.head !== null && ctx?.head !== undefined) {
      update({ amend, ...splitMessage(ctx.head.message) });
    } else {
      update({ amend });
    }
  };

  const submit = (): void => {
    if (!canCommit) return;
    commit.mutate(
      { message: composeMessage(draft.summary, draft.description), amend: draft.amend },
      {
        onSuccess: (result: CommitResult) => {
          setDraft(repositoryId, EMPTY_DRAFT);
          setDone(result);
        },
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  };

  const reason: string | null = identityMissing
    ? "Set your name and email in Git first."
    : !hasContent
      ? "Stage changes to commit them."
      : draft.summary.trim() === ""
        ? "Write a summary."
        : null;

  return (
    <form
      aria-label="Next commit"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4"
    >
      <p className="rg-label">next commit</p>
      <p className="mt-2 font-mono text-xs text-fg-secondary" aria-live="polite">
        {stagedFiles === 0 ? (
          <span className="text-fg-muted">nothing staged</span>
        ) : (
          <>
            {stagedFiles} file{stagedFiles === 1 ? "" : "s"}
            {totals.data !== undefined && (
              <>
                {" · "}
                <span className="text-success">+{totals.data.added}</span> <span className="text-danger">−{totals.data.deleted}</span>
              </>
            )}
          </>
        )}
      </p>
      {merging && <p className="mt-2 text-xs text-warning">Completing a merge: the commit records both parents.</p>}

      <label className="mt-5 block">
        <span className="sr-only">Summary</span>
        <input
          value={draft.summary}
          onChange={(event) => update({ summary: event.target.value })}
          onKeyDown={onKeyDown}
          placeholder="Summary"
          className="rg-control w-full border-b border-border bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent"
        />
      </label>
      <p className={`mt-1 text-right font-mono text-2xs tabular-nums ${draft.summary.length > SUMMARY_GUIDE ? "text-clay-text" : "text-fg-muted"}`}>
        {draft.summary.length}/{SUMMARY_GUIDE}
      </p>
      <label className="mt-2 block">
        <span className="sr-only">Description</span>
        <textarea
          value={draft.description}
          onChange={(event) => update({ description: event.target.value })}
          onKeyDown={onKeyDown}
          rows={5}
          placeholder="Description (optional)"
          className="w-full resize-y border-b border-border bg-transparent py-1 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent"
        />
      </label>

      <label className="mt-3 flex items-center gap-2 text-sm text-fg-secondary">
        <input type="checkbox" checked={draft.amend} disabled={ctx?.head === null} onChange={(event) => toggleAmend(event.target.checked)} />
        Amend the last commit
      </label>
      {draft.amend && ctx?.head?.onUpstream === true && (
        <p className="mt-1 text-xs text-clay-text">
          The last commit is already on its upstream. Amending rewrites published history; pushing afterwards needs
          force-with-lease.
        </p>
      )}

      <div className="mt-5 space-y-1 font-mono text-xs text-fg-muted">
        {ctx === undefined ? (
          context.isError ? <ErrorNotice title="Could not read commit settings" error={context.error} /> : <p>reading identity…</p>
        ) : identityMissing ? (
          <p className="font-sans text-danger">
            No Git identity. Run <code className="font-mono">git config user.name</code> and{" "}
            <code className="font-mono">git config user.email</code>, then return here.
          </p>
        ) : (
          <p className="truncate" title={`${ctx.authorName ?? ""} <${ctx.authorEmail ?? ""}>`}>
            {ctx.authorName} &lt;{ctx.authorEmail}&gt;
          </p>
        )}
        {ctx !== undefined && ctx.signing !== "off" && <p>signed with {ctx.signing}</p>}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={!canCommit} title={`Commit (${formatShortcut("Mod+Enter")})`}>
          {draft.amend ? "Amend commit" : "Commit"}
        </Button>
        {reason !== null && <span className="text-xs text-fg-muted">{reason}</span>}
      </div>

      {commit.error !== null && (
        <div className="mt-4">
          <ErrorNotice title={draft.amend ? "Git did not amend the commit" : "Git did not create the commit"} error={commit.error} />
          <p className="mt-1 text-xs text-fg-muted">Your message is kept. Hook output, if any, is shown above as Git reported it.</p>
        </div>
      )}
      {done !== null && (
        <p role="status" className="mt-4 flex items-center gap-1.5 text-sm text-success">
          <Check aria-hidden className="size-3.5" />
          <span className="font-mono text-xs">{done.oid.slice(0, 7)}</span>
          <span className="truncate text-fg-secondary">{done.summary}</span>
        </p>
      )}
    </form>
  );
}
