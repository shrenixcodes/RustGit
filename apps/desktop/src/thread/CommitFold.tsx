import { useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorNotice } from "../components/ErrorNotice";
import type { IpcError } from "../services/ipc";
import { useBranchOperation, useCommitDetails, useCommitFileDiff, type BranchOutcome, type BranchRequest } from "../services/queries";
import type { CommitFile, FileDiff, HeadState, RefEntry } from "../services/types";
import { CHANGE_LABELS, splitPath } from "../features/changes/changeLabels";
import { buildCanvasRows, type CanvasRow } from "../features/changes/diffModel";
import { RefBadges } from "../features/history/RefBadges";
import { formatAbsolute, formatRelative } from "../features/history/time";
import { DIFF_ROW, HunkHeader, UnifiedLine } from "./diffParts";
import { OutcomeNotice } from "./OutcomeNotice";
import { useUi } from "../stores/ui";

/** Lines shown inline for one file before the diff is cut (the full diff stays one click away in Git). */
const INLINE_LINE_LIMIT = 1500;

interface CommitFoldProps {
  repositoryId: number;
  oid: string;
  refs: readonly RefEntry[];
  head: HeadState | undefined;
  currentBranch: string | null;
  height: number;
  onGoTo: (oid: string) => void;
}

/** A commit unfolded in place: everything about it, under its own row. */
export function CommitFold({ repositoryId, oid, refs, head, currentBranch, height, onGoTo }: CommitFoldProps) {
  const details = useCommitDetails(repositoryId, oid);
  const operation = useBranchOperation(repositoryId);
  const [openFile, setOpenFile] = useState<CommitFile | null>(null);
  const [pending, setPending] = useState<{ request: BranchRequest; title: string; body: string; label: string } | null>(null);
  const [outcome, setOutcome] = useState<BranchOutcome | null>(null);
  const detached: boolean = head?.kind === "detached" && head.oid === oid;

  const run = (request: BranchRequest): void => {
    setOutcome(null);
    operation.mutate(request, { onSuccess: setOutcome, onSettled: () => setPending(null) });
  };

  return (
    <div style={{ height }} className="overflow-y-auto pr-5 pb-4 pl-[72px]">
      {details.isPending && <p className="py-3 text-sm text-fg-muted">Reading commit…</p>}
      {details.isError && <ErrorNotice title="Could not read commit" error={details.error} />}
      {details.data !== undefined && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-10 pt-3">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span data-selectable className="break-all font-mono text-xs text-accent">
                {oid}
              </span>
              <CopyButton value={oid} />
            </div>
            {(refs.length > 0 || detached) && <RefBadges refs={refs} head={head} detachedHead={detached} max={12} />}
            <Message message={details.data.message} />
            <dl className="grid grid-cols-[76px_1fr] gap-x-3 gap-y-1.5 text-sm">
              <Field label="Author">
                <Person name={details.data.authorName} email={details.data.authorEmail} time={details.data.authorTime} />
              </Field>
              {(details.data.committerName !== details.data.authorName || details.data.committerTime !== details.data.authorTime) && (
                <Field label="Committer">
                  <Person name={details.data.committerName} email={details.data.committerEmail} time={details.data.committerTime} />
                </Field>
              )}
              <Field label={details.data.parents.length > 1 ? "Parents" : "Parent"}>
                {details.data.parents.length === 0 ? (
                  <span className="text-fg-muted">None (root commit)</span>
                ) : (
                  <span className="flex flex-wrap gap-1.5">
                    {details.data.parents.map((parent, index) => (
                      <button
                        key={parent}
                        type="button"
                        onClick={() => onGoTo(parent)}
                        title={index === 0 ? "Go to the first parent" : `Go to parent ${index + 1} (merged in)`}
                        className="font-mono text-xs text-fg-secondary underline decoration-border underline-offset-2 hover:text-accent"
                      >
                        {parent.slice(0, 7)}
                      </button>
                    ))}
                  </span>
                )}
              </Field>
            </dl>
            {currentBranch !== null && (
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="ghost"
                  disabled={operation.isPending}
                  onClick={() =>
                    setPending({
                      request: { kind: "cherry_pick", oid },
                      title: `Cherry-pick onto ${currentBranch}?`,
                      body: `Applies the changes of ${oid.slice(0, 7)} as a new commit on ${currentBranch}. Conflicts, if any, are left for you to resolve.`,
                      label: "Cherry-pick",
                    })
                  }
                >
                  Cherry-pick onto {currentBranch}
                </Button>
                <Button
                  variant="ghost"
                  disabled={operation.isPending}
                  onClick={() =>
                    setPending({
                      request: { kind: "revert", oid },
                      title: `Revert ${oid.slice(0, 7)}?`,
                      body: `Creates a new commit on ${currentBranch} that undoes this commit's changes. History is not rewritten.`,
                      label: "Revert",
                    })
                  }
                >
                  Revert…
                </Button>
                <Button variant="ghost" onClick={() => useUi.getState().openCompare(oid, "HEAD")}>
                  Compare with HEAD
                </Button>
              </div>
            )}
            {operation.error !== null && <ErrorNotice title="Git did not complete the operation" error={operation.error} />}
            {outcome !== null && <OutcomeNotice outcome={outcome} />}
          </div>

          <div className="min-w-0">
            <p className="rg-label mb-2">
              files {details.data.files.length}
              {details.data.parents.length > 1 ? " · against the first parent" : ""}
            </p>
            <ul className="space-y-px">
              {details.data.files.map((file) => (
                <FileEntry
                  key={file.path}
                  file={file}
                  open={openFile?.path === file.path}
                  onToggle={() => setOpenFile(openFile?.path === file.path ? null : file)}
                  diff={() => <InlineDiff repositoryId={repositoryId} oid={oid} file={file} />}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
      {pending !== null && (
        <ConfirmDialog
          title={pending.title}
          confirmLabel={pending.label}
          busy={operation.isPending}
          onCancel={() => setPending(null)}
          onConfirm={() => run(pending.request)}
        >
          <p>{pending.body}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** A changed file of a commit or comparison; unfolds its diff (rendered by `diff`). */
export function FileEntry({
  file,
  open,
  onToggle,
  diff,
}: {
  file: CommitFile;
  open: boolean;
  onToggle: () => void;
  diff: () => ReactNode;
}) {
  const meta = CHANGE_LABELS[file.kind];
  const { name, directory } = splitPath(file.path);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        title={file.originalPath === null ? file.path : `${file.originalPath} → ${file.path}`}
        className="flex w-full items-center gap-2 py-0.5 text-left text-sm hover:bg-hover"
      >
        <Chevron aria-hidden className="size-3 shrink-0 text-fg-muted" />
        <span aria-label={meta.label} className={`w-3 shrink-0 text-center font-mono text-xs ${meta.tone}`}>
          {meta.letter}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="max-w-[70%] shrink-0 truncate font-mono text-xs">{name}</span>
          <span className="min-w-0 truncate font-mono text-2xs text-fg-muted" dir="rtl">
            <bdi dir="ltr">{directory}</bdi>
          </span>
        </span>
        <span className="shrink-0 font-mono text-2xs tabular-nums">
          {file.additions === null ? (
            <span className="text-fg-muted">binary</span>
          ) : (
            <>
              <span className="text-success">+{file.additions}</span> <span className="text-danger">−{file.deletions ?? 0}</span>
            </>
          )}
        </span>
      </button>
      {open && diff()}
    </li>
  );
}

function InlineDiff({ repositoryId, oid, file }: { repositoryId: number; oid: string; file: CommitFile }) {
  return <ReadOnlyDiff diff={useCommitFileDiff(repositoryId, oid, file.path, file.originalPath)} />;
}

/** A read-only unified diff, capped at INLINE_LINE_LIMIT lines. */
export function ReadOnlyDiff({ diff }: { diff: UseQueryResult<FileDiff, IpcError> }) {
  if (diff.isPending) return <p className="py-1 pl-5 text-xs text-fg-muted">Reading the diff…</p>;
  if (diff.isError) return <ErrorNotice title="Could not read the diff" error={diff.error} />;
  const data: FileDiff = diff.data;
  const rows: CanvasRow[] = buildCanvasRows([{ ...data, side: "unstaged" }], "unified").slice(1);
  const shown: CanvasRow[] = rows.slice(0, INLINE_LINE_LIMIT);
  return (
    <div className="rg-canvas my-1 overflow-x-auto font-mono text-xs" style={{ lineHeight: `${DIFF_ROW}px` }}>
      {shown.map((row, index) => {
        const style = { height: DIFF_ROW };
        if (row.kind === "note") return <p key={index} className="px-3 font-sans text-sm text-fg-muted">{row.text}</p>;
        if (row.kind === "hunk")
          return <HunkHeader key={index} style={style} indent={8} header={row.hunk.header} side="commit" active={false} selectedCount={0} disabled />;
        if (row.kind === "line") return <UnifiedLine key={index} style={style} indent={0} refLine={row} selected={false} selectable={false} />;
        return null;
      })}
      {rows.length > shown.length && (
        <p className="px-3 py-1 font-sans text-xs text-fg-muted">
          {rows.length - shown.length} more lines not shown inline.
        </p>
      )}
    </div>
  );
}

function Message({ message }: { message: string }) {
  const [summary, ...rest] = message.replace(/\s+$/, "").split("\n");
  const body: string = rest.join("\n").replace(/^\n+/, "");
  return (
    <div data-selectable>
      <p className="text-base font-medium text-fg">{summary}</p>
      {body !== "" && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-fg-secondary">{body}</p>}
    </div>
  );
}

function Person({ name, email, time }: { name: string; email: string; time: number }) {
  return (
    <span data-selectable className="block min-w-0">
      <span className="text-fg">{name}</span> <span className="break-all text-fg-muted">&lt;{email}&gt;</span>
      <span className="block text-xs text-fg-muted">
        {formatAbsolute(time)} · {formatRelative(time)}
      </span>
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState<boolean>(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy SHA"}
      title="Copy the full commit id"
      onClick={() =>
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          },
          () => setCopied(false),
        )
      }
      className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
    >
      {copied ? <Check aria-hidden className="size-3 text-success" /> : <Copy aria-hidden className="size-3" />}
      {copied ? "copied" : "copy"}
    </button>
  );
}
