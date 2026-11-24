import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Copy, GitCompare, GitFork, RotateCcw } from "lucide-react";
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
const INLINE_LINE_LIMIT = 5000;

interface CommitFoldProps {
  repositoryId: number;
  oid: string;
  refs: readonly RefEntry[];
  head: HeadState | undefined;
  currentBranch: string | null;
  height: number;
  /** Left padding that clears the graph lanes running through the fold. */
  inset: number;
  onGoTo: (oid: string) => void;
  onHeightChange?: (height: number) => void;
}

/** A commit unfolded in place: everything about it, under its own row. */
export function CommitFold({ repositoryId, oid, refs, head, currentBranch, height, inset, onGoTo, onHeightChange }: CommitFoldProps) {
  const details = useCommitDetails(repositoryId, oid);
  const operation = useBranchOperation(repositoryId);
  const [openFiles, setOpenFiles] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<{ request: BranchRequest; title: string; body: string; label: string } | null>(null);
  const [outcome, setOutcome] = useState<BranchOutcome | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const detached: boolean = head?.kind === "detached" && head.oid === oid;

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = (): void => {
      const measured = Math.ceil(el.getBoundingClientRect().height) + 24;
      onHeightChange?.(measured);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [onHeightChange, details.data]);

  const toggleFile = (path: string): void =>
    setOpenFiles((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const allExpanded: boolean =
    details.data !== undefined &&
    details.data.files.length > 0 &&
    details.data.files.every((file) => openFiles.has(file.path));

  const run = (request: BranchRequest): void => {
    setOutcome(null);
    operation.mutate(request, { onSuccess: setOutcome, onSettled: () => setPending(null) });
  };

  return (
    <div style={{ height, paddingLeft: inset }} className="overflow-y-auto pr-4 sm:pr-6 pb-5">
      {details.isPending && <p className="py-4 text-xs font-mono text-fg-muted">Reading commit…</p>}
      {details.isError && <ErrorNotice title="Could not read commit" error={details.error} />}
      {details.data !== undefined && (
        <div ref={contentRef} className="space-y-4 pt-3.5 w-full">
          {/* Header pill: SHA, Copy, Badges */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-elevated/50 px-3 py-2 shadow-2xs">
            <div className="flex items-center gap-2 min-w-0">
              <span data-selectable className="font-mono text-xs font-semibold text-accent break-all">
                {oid}
              </span>
              <CopyButton value={oid} />
            </div>
            {(refs.length > 0 || detached) && <RefBadges refs={refs} head={head} detachedHead={detached} max={12} />}
          </div>

          {/* Commit Message & Metadata Top Section */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-4">
            {/* Commit Message Box */}
            <div className="rounded-xl border border-border/80 bg-canvas/40 p-4 shadow-2xs">
              <Message message={details.data.message} />
            </div>

            {/* Author / Committer / Parents Grid */}
            <div className="rounded-xl border border-border/80 bg-elevated/40 p-4 shadow-2xs space-y-3">
              <dl className="grid grid-cols-[80px_1fr] items-baseline gap-x-3 gap-y-2.5 text-xs">
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
                    <span className="text-fg-muted font-sans">None (root commit)</span>
                  ) : (
                    <span className="flex flex-wrap gap-2">
                      {details.data.parents.map((parent, index) => (
                        <button
                          key={parent}
                          type="button"
                          onClick={() => onGoTo(parent)}
                          title={index === 0 ? "Go to the first parent" : `Go to parent ${index + 1} (merged in)`}
                          className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-canvas/60 px-2 py-0.5 font-mono text-xs font-medium text-fg-secondary hover:border-accent hover:text-accent transition-colors"
                        >
                          <GitFork className="size-3 text-accent" />
                          <span>{parent.slice(0, 7)}</span>
                        </button>
                      ))}
                    </span>
                  )}
                </Field>
              </dl>
            </div>
          </div>

          {/* Commit Actions Toolbar: cherry-pick and revert need a branch; comparing only needs HEAD. */}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {currentBranch !== null && (
              <>
                <Button
                  variant="secondary"
                  disabled={operation.isPending}
                  onClick={() =>
                    setPending({
                      request: { kind: "cherry_pick", oid },
                      title: `Cherry-pick onto ${currentBranch}?`,
                      body: `Applies the changes of ${oid.slice(0, 7)} as a new commit on ${currentBranch}. Conflicts, if any, are left for you to resolve.`,
                      label: "Cherry-pick",
                    })
                  }
                  className="h-7.5 text-xs font-medium"
                >
                  <GitFork className="size-3.5 mr-1 text-accent" />
                  Cherry-pick onto {currentBranch}
                </Button>
                <Button
                  variant="secondary"
                  disabled={operation.isPending}
                  onClick={() =>
                    setPending({
                      request: { kind: "revert", oid },
                      title: `Revert ${oid.slice(0, 7)}?`,
                      body: `Creates a new commit on ${currentBranch} that undoes this commit's changes. History is not rewritten.`,
                      label: "Revert",
                    })
                  }
                  className="h-7.5 text-xs font-medium"
                >
                  <RotateCcw className="size-3.5 mr-1 text-clay-text" />
                  Revert…
                </Button>
              </>
            )}
            {head !== undefined && head.kind !== "unborn" && (
              <Button
                variant="ghost"
                onClick={() => useUi.getState().openCompare(oid, "HEAD")}
                className="h-7.5 text-xs font-medium"
              >
                <GitCompare className="size-3.5 mr-1" />
                Compare with HEAD
              </Button>
            )}
          </div>

          {operation.error !== null && <ErrorNotice title="Git did not complete the operation" error={operation.error} />}
          {outcome !== null && <OutcomeNotice outcome={outcome} />}

          {/* Changed Files Section — Full Width with Expand All */}
          <div className="w-full rounded-xl border border-border/80 bg-elevated/40 p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between pb-2.5 border-b border-border/60">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-xs text-fg">
                  Changed files ({details.data.files.length})
                </span>
                {details.data.parents.length > 1 && (
                  <span className="font-mono text-2xs text-fg-muted">
                    against first parent
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  setOpenFiles(allExpanded ? new Set() : new Set(details.data.files.map((file) => file.path)))
                }
                className="rounded-md border border-border/80 bg-canvas/60 px-2.5 py-1 font-sans text-xs font-medium text-accent hover:bg-hover hover:border-accent transition-all cursor-pointer shadow-2xs"
              >
                {allExpanded ? "Fold all" : "Expand all"}
              </button>
            </div>
            <ul className="space-y-2">
              {details.data.files.map((file) => (
                <FileEntry
                  key={file.path}
                  file={file}
                  open={openFiles.has(file.path)}
                  onToggle={() => toggleFile(file.path)}
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
    <li className="rounded-lg overflow-hidden border border-border/70 bg-canvas/40 hover:border-border-control transition-all shadow-2xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        title={file.originalPath === null ? file.path : `${file.originalPath} → ${file.path}`}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs cursor-pointer select-none hover:bg-hover/60 transition-colors"
      >
        <Chevron aria-hidden className={`size-3.5 shrink-0 transition-transform ${open ? "text-accent" : "text-fg-muted"}`} />
        <span
          aria-label={meta.label}
          className={`flex size-4 shrink-0 items-center justify-center rounded text-2xs font-mono font-bold leading-none ${meta.tone}`}
        >
          {meta.letter}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="max-w-[70%] shrink-0 truncate font-mono text-xs font-semibold text-fg">{name}</span>
          <span className="min-w-0 truncate font-mono text-2xs text-fg-muted" dir="rtl">
            <bdi dir="ltr">{directory}</bdi>
          </span>
        </span>
        <span className="shrink-0 font-mono text-2xs tabular-nums">
          {file.additions === null ? (
            <span className="text-fg-muted bg-elevated px-1.5 py-0.5 rounded">binary</span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-success font-semibold">+{file.additions}</span>
              <span className="text-danger font-semibold">−{file.deletions ?? 0}</span>
            </span>
          )}
        </span>
      </button>
      {open && <div className="rg-fold-anim border-t border-border/60 bg-surface/80 p-3 overflow-x-auto w-full">{diff()}</div>}
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
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-muted transition-colors hover:bg-hover hover:text-fg active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      {copied ? <Check aria-hidden className="size-3 text-success" /> : <Copy aria-hidden className="size-3" />}
      {copied ? "copied" : "copy"}
    </button>
  );
}
