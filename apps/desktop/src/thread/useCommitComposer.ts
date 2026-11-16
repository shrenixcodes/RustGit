import { useState } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import type { IpcError } from "../services/ipc";
import { useCommitContext, useCreateCommit, useStagedTotals } from "../services/queries";
import type { ChangeTotals, CommitContext, CommitResult, StatusSnapshot } from "../services/types";
import { EMPTY_DRAFT, useUi, type CommitDraft } from "../stores/ui";
import { countChanges } from "../features/changes/changeLabels";

/** Summary length after which Git tooling usually truncates; guidance only. */
export const SUMMARY_GUIDE = 72;

export function composeMessage(summary: string, description: string): string {
  const body: string = description.trim();
  return body === "" ? summary.trim() : `${summary.trim()}\n\n${body}`;
}

export function splitMessage(message: string): { summary: string; description: string } {
  const [summary = "", ...rest] = message.replace(/\s+$/, "").split("\n");
  return { summary, description: rest.join("\n").replace(/^\n+/, "") };
}

export interface CommitComposer {
  draft: CommitDraft;
  update: (patch: Partial<CommitDraft>) => void;
  toggleAmend: (amend: boolean) => void;
  submit: () => void;
  canCommit: boolean;
  /** Why committing is not possible yet, in plain words. */
  reason: string | null;
  context: UseQueryResult<CommitContext, IpcError>;
  totals: UseQueryResult<ChangeTotals, IpcError>;
  mutation: UseMutationResult<CommitResult, IpcError, { message: string; amend: boolean }>;
  /** The last commit made from this composer, until the draft changes again. */
  done: CommitResult | null;
  stagedFiles: number;
  merging: boolean;
  identityMissing: boolean;
}

/** State and rules of the next commit for a repository. Shared by the loose end's row and its unfolded stream. */
export function useCommitComposer(repositoryId: number, status: StatusSnapshot): CommitComposer {
  const totals = useStagedTotals(repositoryId);
  const context = useCommitContext(repositoryId);
  const mutation = useCreateCommit(repositoryId);
  const draft: CommitDraft = useUi((state) => state.commitDrafts[repositoryId] ?? EMPTY_DRAFT);
  const setDraft = useUi((state) => state.setCommitDraft);
  const updateDraft = useUi((state) => state.updateCommitDraft);
  const [done, setDone] = useState<CommitResult | null>(null);

  const ctx: CommitContext | undefined = context.data;
  const stagedFiles: number = countChanges(status.files).staged;
  const merging: boolean = status.inProgress === "merging";
  const identityMissing: boolean = ctx !== undefined && (ctx.authorName === null || ctx.authorEmail === null);
  const hasContent: boolean = stagedFiles > 0 || draft.amend || merging;
  const canCommit: boolean = draft.summary.trim() !== "" && hasContent && ctx !== undefined && !identityMissing && !mutation.isPending;

  const update = (patch: Partial<CommitDraft>): void => {
    setDone(null);
    if (mutation.error !== null) mutation.reset();
    updateDraft(repositoryId, patch);
  };

  const toggleAmend = (amend: boolean): void => {
    const head = ctx?.head;
    if (amend && draft.summary.trim() === "" && draft.description.trim() === "" && head !== null && head !== undefined) {
      update({ amend, ...splitMessage(head.message) });
    } else {
      update({ amend });
    }
  };

  const submit = (): void => {
    if (!canCommit) return;
    mutation.mutate(
      { message: composeMessage(draft.summary, draft.description), amend: draft.amend },
      {
        onSuccess: (result: CommitResult) => {
          setDraft(repositoryId, EMPTY_DRAFT);
          setDone(result);
        },
      },
    );
  };

  const reason: string | null = identityMissing
    ? "Set your name and email in Git first."
    : !hasContent
      ? "Stage changes to commit them."
      : draft.summary.trim() === ""
        ? "Write a summary."
        : null;

  return {
    draft,
    update,
    toggleAmend,
    submit,
    canCommit,
    reason,
    context,
    totals,
    mutation,
    done,
    stagedFiles,
    merging,
    identityMissing,
  };
}
