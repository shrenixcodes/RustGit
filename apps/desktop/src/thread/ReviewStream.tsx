import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CheckSquare, ChevronDown, ChevronRight, FileCheck, MinusSquare, Search, Square } from "lucide-react";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorNotice } from "../components/ErrorNotice";
import { SegmentedControl, type SegmentOption } from "../components/SegmentedControl";
import { useVirtualRows } from "../components/useVirtualRows";
import { useFileDiffs, useStaging, type DiffRequest, type StagingRequest } from "../services/queries";
import { ConflictResolver } from "./ConflictResolver";
import { OperationBanner } from "./OperationBanner";
import type { DiffHunk, FileDiff, FileStatus, StatusSnapshot, WorkingDiffSide } from "../services/types";
import { useUi } from "../stores/ui";
import { useWorkspace } from "../stores/workspace";
import {
  CHANGE_LABELS,
  displayKind,
  groupOf,
  isPartiallyStaged,
  matchesFilter,
  splitPath,
  stagingState,
  type NavigatorGroup,
} from "../features/changes/changeLabels";
import { buildCanvasRows, type CanvasRow, type DiffLayout } from "../features/changes/diffModel";
import { DIFF_ROW, HunkHeader, SplitHalf, UnifiedLine, type HunkAction } from "./diffParts";
import { formatShortcut } from "../app/shortcuts";
import { SUMMARY_GUIDE, type CommitComposer } from "./useCommitComposer";

const GROUPS: readonly NavigatorGroup[] = ["conflicts", "changes", "untracked"];
const LAYOUTS: readonly SegmentOption<DiffLayout>[] = [
  { value: "unified", label: "Unified" },
  { value: "split", label: "Split" },
];
/** Diff rows are indented under their file, which hangs off the thread. */
const DIFF_INDENT = 40;
/** Expanding every file is offered only up to this many (each costs a diff request). */
export const EXPAND_ALL_LIMIT = 100;

type StreamRow =
  | { kind: "group"; group: NavigatorGroup; count: number }
  | { kind: "file"; file: FileStatus; expanded: boolean; position: number; setSize: number }
  | { kind: "message"; path: string; text: string }
  | { kind: "diff"; path: string; row: CanvasRow };

interface PendingDiscard {
  title: string;
  body: string;
  confirmLabel: string;
  request: StagingRequest;
}

function sidesOf(file: FileStatus): WorkingDiffSide[] {
  if (file.conflicted) return [];
  const sides: WorkingDiffSide[] = [];
  if (file.staged !== null) sides.push("staged");
  if (file.unstaged !== null) sides.push("unstaged");
  return sides;
}

interface ReviewStreamProps {
  repositoryId: number;
  status: StatusSnapshot;
  composer: CommitComposer;
  height: number;
}

/**
 * The unfolded loose end: every changed file once, hanging off the open
 * node, with its staged and not-staged diffs inline when expanded. All
 * staging goes through the backend; results replace the cached status.
 */
export function ReviewStream({ repositoryId, status, composer, height }: ReviewStreamProps) {
  const staging = useStaging(repositoryId);
  const selected: string | null = useWorkspace((state) => state.selectedChange?.path ?? null);
  const selectChange = useWorkspace((state) => state.selectChange);
  const [filter, setFilter] = useState<string>("");
  // Diff display choices outlive the fold (folding and unfolding keeps them).
  const layout: DiffLayout = useUi((state) => state.reviewLayout);
  const setLayout = useUi((state) => state.setReviewLayout);
  const ignoreWhitespace: boolean = useUi((state) => state.reviewIgnoreWhitespace);
  const setIgnoreWhitespace = useUi((state) => state.setReviewIgnoreWhitespace);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() =>
    new Set(status.files.length <= 4 ? status.files.map((f) => f.path) : status.files.slice(0, 1).map((f) => f.path)),
  );
  const [selection, setSelection] = useState<ReadonlyMap<string, ReadonlySet<number>>>(new Map());
  const [activeHunk, setActiveHunk] = useState<number>(-1);
  const [discard, setDiscard] = useState<PendingDiscard | null>(null);
  /** Conflicted file open in the resolver, in place of the stream. */
  const [resolving, setResolving] = useState<string | null>(null);
  // Close the resolver when Git no longer reports the file as conflicted (resolved here or elsewhere).
  useEffect(() => {
    if (resolving !== null && !status.files.some((file) => file.path === resolving && file.conflicted)) setResolving(null);
  }, [resolving, status.files]);
  const container = useRef<HTMLDivElement>(null);

  const files: FileStatus[] = useMemo(() => status.files.filter((file) => matchesFilter(file, filter)), [status.files, filter]);
  const expandedFiles: FileStatus[] = files.filter((file) => expanded.has(file.path));
  const requests: DiffRequest[] = expandedFiles.map((file) => ({ path: file.path, originalPath: file.originalPath, sides: sidesOf(file) }));
  const results = useFileDiffs(repositoryId, requests, ignoreWhitespace);

  // Map results back to files (requests are flattened per side, in order).
  const diffsByPath: Map<string, { diffs: FileDiff[]; loading: boolean; error: string | null }> = new Map();
  let cursor = 0;
  for (const request of requests) {
    const diffs: FileDiff[] = [];
    let loading = false;
    let error: string | null = null;
    for (let i = 0; i < request.sides.length; i += 1) {
      const result = results[cursor++];
      if (result?.data !== undefined) diffs.push(result.data);
      else if (result?.isError === true) error = result.error.message;
      else loading = true;
    }
    diffsByPath.set(request.path, { diffs, loading, error });
  }

  const rows: StreamRow[] = useMemo(() => {
    const out: StreamRow[] = [];
    for (const group of GROUPS) {
      const members: FileStatus[] = files.filter((file) => groupOf(file) === group);
      if (members.length === 0) continue;
      out.push({ kind: "group", group, count: members.length });
      members.forEach((file, index) => {
        const isOpen: boolean = expanded.has(file.path);
        out.push({ kind: "file", file, expanded: isOpen, position: index + 1, setSize: members.length });
        if (!isOpen) return;
        if (file.conflicted) {
          out.push({ kind: "message", path: file.path, text: "Open the resolver (Enter or Resolve…) to choose between both sides." });
          return;
        }
        const entry = diffsByPath.get(file.path);
        if (entry === undefined || entry.loading) out.push({ kind: "message", path: file.path, text: "Reading the diff…" });
        else if (entry.error !== null) out.push({ kind: "message", path: file.path, text: `Could not read the diff: ${entry.error}` });
        else for (const row of buildCanvasRows(entry.diffs, layout)) out.push({ kind: "diff", path: file.path, row });
      });
    }
    return out;
  }, [files, expanded, layout, results.map((r) => r.dataUpdatedAt).join(","), results.map((r) => r.status).join(",")]);

  const hunkRows: number[] = useMemo(
    () => rows.flatMap((row, index) => (row.kind === "diff" && row.row.kind === "hunk" ? [index] : [])),
    [rows],
  );
  const fileRows: number[] = useMemo(() => rows.flatMap((row, index) => (row.kind === "file" ? [index] : [])), [rows]);
  const { start, end, totalHeight, ensureVisible } = useVirtualRows(container, rows.length, DIFF_ROW, 16);

  // Line selections refer to line indices of a specific diff: drop them when diffs change.
  useEffect(() => setSelection(new Map()), [rows]);

  const diffFor = (path: string, side: WorkingDiffSide): FileDiff | undefined =>
    diffsByPath.get(path)?.diffs.find((diff) => diff.side === side);
  const lineSelectable = (path: string, side: WorkingDiffSide): boolean =>
    !ignoreWhitespace && diffFor(path, side)?.status === "modified";

  const toggleExpanded = (path: string): void =>
    setExpanded((current) => {
      const next: Set<string> = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const toggleStage = (file: FileStatus): void => {
    if (file.conflicted || staging.isPending) return;
    if (file.unstaged !== null) staging.mutate({ kind: "stage", paths: [file.path] });
    else if (file.staged !== null) staging.mutate({ kind: "unstage", paths: [file.path] });
  };

  const hunkKey = (path: string, side: WorkingDiffSide, hunkIndex: number): string => `${path}\u0000${side}\u0000${hunkIndex}`;

  const toggleLine = (path: string, side: WorkingDiffSide, hunkIndex: number, lineIndex: number): void => {
    if (!lineSelectable(path, side)) return;
    const key: string = hunkKey(path, side, hunkIndex);
    setSelection((current) => {
      const next: Map<string, ReadonlySet<number>> = new Map(current);
      const set: Set<number> = new Set(next.get(key) ?? []);
      if (set.has(lineIndex)) set.delete(lineIndex);
      else set.add(lineIndex);
      if (set.size === 0) next.delete(key);
      else next.set(key, set);
      return next;
    });
  };

  const runHunk = (path: string, side: WorkingDiffSide, hunkIndex: number, action: HunkAction): void => {
    const hunk: DiffHunk | undefined = diffFor(path, side)?.hunks[hunkIndex];
    if (hunk === undefined || ignoreWhitespace) return;
    const chosen = selection.get(hunkKey(path, side, hunkIndex));
    const lineIndices: number[] | null = chosen === undefined ? null : [...chosen].sort((a, b) => a - b);
    const request: StagingRequest = { kind: "hunk", path, side, action, hunkHeader: hunk.header, lineIndices };
    if (action === "discard") {
      const count: number = lineIndices?.length ?? 0;
      setDiscard({
        title: count > 0 ? `Discard ${count} selected line${count === 1 ? "" : "s"}?` : "Discard this hunk?",
        body: `The ${count > 0 ? "selected lines" : "hunk"} in ${path} will be reverted in the working tree. Git keeps no copy of uncommitted changes, so this cannot be undone.`,
        confirmLabel: count > 0 ? `Discard ${count} line${count === 1 ? "" : "s"}` : "Discard hunk",
        request,
      });
    } else {
      staging.mutate(request);
    }
  };

  const discardFile = (file: FileStatus): void =>
    setDiscard(
      file.unstaged === "untracked"
        ? {
            title: "Delete this untracked file?",
            body: `${file.path} has never been committed. It will be deleted from disk and cannot be recovered from Git.`,
            confirmLabel: "Delete file",
            request: { kind: "discard", paths: [file.path] },
          }
        : {
            title: "Discard the unstaged changes in this file?",
            body: `${file.path} will be reverted to its staged version${file.staged !== null ? " (staged changes are kept)" : ""}. Unstaged changes cannot be recovered from Git.`,
            confirmLabel: "Discard changes",
            request: { kind: "discard", paths: [file.path] },
          },
    );

  const activeFileRow: number = rows.findIndex((row) => row.kind === "file" && row.file.path === selected);

  const moveFile = (step: number): void => {
    if (fileRows.length === 0) return;
    const current: number = fileRows.indexOf(activeFileRow);
    const nextRow: number = fileRows[Math.max(0, Math.min(fileRows.length - 1, current < 0 ? 0 : current + step))] as number;
    const row = rows[nextRow];
    if (row?.kind === "file") {
      selectChange({ path: row.file.path, side: "unstaged" });
      ensureVisible(nextRow);
    }
  };

  const moveHunk = (step: number): void => {
    if (hunkRows.length === 0) return;
    const next: number = Math.max(0, Math.min(hunkRows.length - 1, activeHunk + step));
    setActiveHunk(next);
    ensureVisible(hunkRows[next] as number);
  };

  const activeHunkRow = rows[hunkRows[activeHunk] ?? -1];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const fileRow = rows[activeFileRow];
    const file: FileStatus | undefined = fileRow?.kind === "file" ? fileRow.file : undefined;
    const hunk = activeHunkRow?.kind === "diff" && activeHunkRow.row.kind === "hunk" ? activeHunkRow : null;
    switch (event.key) {
      case "ArrowDown":
        moveFile(1);
        break;
      case "ArrowUp":
        moveFile(-1);
        break;
      case "Enter":
        if (file?.conflicted === true) setResolving(file.path);
        else if (file !== undefined) toggleExpanded(file.path);
        break;
      case " ":
        if (file !== undefined) toggleStage(file);
        break;
      case "n":
        moveHunk(1);
        break;
      case "p":
        moveHunk(-1);
        break;
      case "s":
        if (hunk !== null && hunk.row.kind === "hunk" && hunk.row.side === "unstaged") runHunk(hunk.path, "unstaged", hunk.row.hunkIndex, "stage");
        break;
      case "u":
        if (hunk !== null && hunk.row.kind === "hunk" && hunk.row.side === "staged") runHunk(hunk.path, "staged", hunk.row.hunkIndex, "unstage");
        else if (file !== undefined && file.staged !== null && !staging.isPending) staging.mutate({ kind: "unstage", paths: [file.path] });
        break;
      case "d":
        if (hunk !== null && hunk.row.kind === "hunk" && hunk.row.side === "unstaged") runHunk(hunk.path, "unstaged", hunk.row.hunkIndex, "discard");
        break;
      case "Delete":
        if (file !== undefined && !file.conflicted && file.unstaged !== null) discardFile(file);
        break;
      case "Escape":
        if (selection.size === 0) return; // let the thread fold the loose end
        setSelection(new Map());
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const unstagedCount: number = status.files.filter((file) => !file.conflicted && file.unstaged !== null).length;
  const anyUnstaged: boolean = unstagedCount > 0;
  const anyStaged: boolean = composer.stagedFiles > 0;
  const allExpanded: boolean = files.length > 0 && files.every((file) => expanded.has(file.path));
  const ctx = composer.context.data;

  return (
    <div style={{ height }} className="flex flex-col">
      <OperationBanner repositoryId={repositoryId} status={status} />
      {resolving !== null ? (
        <div className="min-h-0 flex-1">
          <ConflictResolver repositoryId={repositoryId} path={resolving} status={status} height="100%" onBack={() => setResolving(null)} />
        </div>
      ) : (
      <>
      {/* Elevated Commit Composer Console */}
      <div className="flex shrink-0 gap-6 py-3 pr-5 pl-[72px]">
        <div className="min-w-0 max-w-4xl flex-1 rounded-xl border border-border/80 bg-elevated/50 p-4 shadow-sm backdrop-blur-xs space-y-3">
          <div className="flex items-center justify-between pb-1 border-b border-border/60">
            <div className="flex items-center gap-2">
              <FileCheck className="size-3.5 text-accent" />
              <span className="font-semibold text-xs text-fg">Commit Details</span>
              {composer.stagedFiles > 0 ? (
                <span className="rounded-full bg-accent/15 border border-accent/25 px-2 py-0.5 font-mono text-2xs font-semibold text-accent">
                  {composer.stagedFiles} file{composer.stagedFiles === 1 ? "" : "s"} staged
                </span>
              ) : (
                <span className="rounded-full bg-surface border border-border px-2 py-0.5 font-mono text-2xs text-fg-muted">
                  no staged files
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-2xs text-fg-muted">
              <span className="font-sans">Press</span>
              <kbd className="rounded border border-border/70 bg-canvas/80 px-1 py-0.5 font-mono text-fg-secondary">
                {formatShortcut("Mod+Enter")}
              </kbd>
              <span className="font-sans">to commit</span>
            </div>
          </div>

          <label className="block">
            <span className="sr-only">Description</span>
            <textarea
              value={composer.draft.description}
              onChange={(event) => composer.update({ description: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  composer.submit();
                } else if (event.key === "Escape") {
                  // Same as the summary field: leave the field, keep the fold open.
                  event.preventDefault();
                  event.currentTarget.closest<HTMLElement>('[role="tree"]')?.focus();
                }
              }}
              rows={2}
              placeholder="Description (optional)"
              className="w-full resize-y rounded-lg border border-border/70 bg-canvas/70 p-2.5 text-xs text-fg outline-none placeholder:text-fg-muted focus:border-accent focus:bg-canvas focus:ring-1 focus:ring-accent/30 font-sans transition-all"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 pt-0.5 text-xs">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-fg-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={composer.draft.amend}
                  disabled={ctx?.head === null}
                  onChange={(event) => composer.toggleAmend(event.target.checked)}
                  className="rounded border-border text-accent focus:ring-accent"
                />
                <span className="text-2xs font-medium">Amend last commit</span>
              </label>
              <span className={`font-mono text-2xs ${composer.draft.summary.length > SUMMARY_GUIDE ? "text-clay-text font-semibold" : "text-fg-muted"}`}>
                summary {composer.draft.summary.length}/{SUMMARY_GUIDE}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {ctx !== undefined && !composer.identityMissing && (
                <span className="truncate font-mono text-2xs text-fg-muted bg-canvas/40 border border-border/60 px-2 py-0.5 rounded-md" title={`Author: ${ctx.authorName} <${ctx.authorEmail}>`}>
                  {ctx.authorName} &lt;{ctx.authorEmail}&gt;{ctx.signing !== "off" ? ` · signed (${ctx.signing})` : ""}
                </span>
              )}
              <Button
                type="button"
                variant="primary"
                disabled={!composer.canCommit}
                title={composer.reason ?? "Commit changes (Ctrl+Enter)"}
                onClick={composer.submit}
                className="h-7 text-xs font-semibold px-3"
              >
                {composer.draft.amend ? "Amend commit" : composer.stagedFiles > 0 ? `Commit ${composer.stagedFiles} file${composer.stagedFiles === 1 ? "" : "s"}` : "Commit"}
              </Button>
            </div>
          </div>

          {composer.draft.amend && ctx?.head?.onUpstream === true && (
            <p className="text-2xs text-clay-text bg-clay/10 border border-clay/20 p-2 rounded-lg">
              The last commit is already on its upstream. Amending rewrites published history; pushing afterwards needs force-with-lease.
            </p>
          )}
          {composer.identityMissing && (
            <p className="text-2xs text-danger font-medium bg-danger/10 border border-danger/20 p-2 rounded-lg">
              No Git identity. Run <code className="font-mono">git config user.name</code> and{" "}
              <code className="font-mono">git config user.email</code>, then return here.
            </p>
          )}
          {composer.merging && <p className="text-2xs text-warning font-medium bg-warning/10 border border-warning/20 p-2 rounded-lg">Completing a merge: the commit records both parents.</p>}
          {composer.mutation.error !== null && (
            <ErrorNotice
              title={composer.draft.amend ? "Git did not amend the commit" : "Git did not create the commit"}
              error={composer.mutation.error}
            />
          )}
        </div>
      </div>

      {/* Changes Review Toolbar */}
      <div className="flex flex-wrap shrink-0 items-center justify-between gap-2 pr-5 pb-2.5 pl-[72px]">
        <div className="flex min-w-[200px] flex-1 items-center gap-2">
          <label className="flex h-7.5 w-full max-w-xs items-center gap-2 rounded-lg border border-border/80 bg-canvas/70 px-2.5 transition-all focus-within:border-accent focus-within:bg-canvas focus-within:ring-1 focus-within:ring-accent/30 shadow-2xs">
            <Search className="size-3 text-fg-muted shrink-0" />
            <span className="sr-only">Filter changed files</span>
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter changed files…"
              className="h-full min-w-0 flex-1 bg-transparent font-sans text-xs text-fg outline-none placeholder:text-fg-muted"
            />
            {filter !== "" && (
              <button type="button" onClick={() => setFilter("")} className="text-fg-muted hover:text-fg text-xs" title="Clear filter">
                ×
              </button>
            )}
          </label>

          <div className="hidden lg:flex items-center gap-1.5 font-mono text-2xs text-fg-muted pl-1">
            <span className="rounded bg-elevated border border-border px-1.5 py-0.5">
              {files.length} file{files.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={!anyUnstaged || staging.isPending}
            onClick={() => staging.mutate({ kind: "stage_all" })}
            className="h-7 text-xs font-medium"
            title="Stage all modified and untracked files"
          >
            Stage all{unstagedCount > 0 ? ` (${unstagedCount})` : ""}
          </Button>
          <Button
            variant="secondary"
            disabled={!anyStaged || staging.isPending}
            onClick={() => staging.mutate({ kind: "unstage_all" })}
            className="h-7 text-xs font-medium"
            title="Unstage all staged changes"
          >
            Unstage all{composer.stagedFiles > 0 ? ` (${composer.stagedFiles})` : ""}
          </Button>
          <Button
            variant="ghost"
            disabled={!allExpanded && files.length > EXPAND_ALL_LIMIT}
            title={files.length > EXPAND_ALL_LIMIT ? `Expanding all is limited to ${EXPAND_ALL_LIMIT} files` : undefined}
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(files.map((file) => file.path)))}
            className="h-7 text-xs"
          >
            {allExpanded ? "Fold all" : "Expand all"}
          </Button>
          <label className="flex items-center gap-1.5 font-mono text-2xs text-fg-muted cursor-pointer select-none" title="Hunks of a whitespace-ignoring diff cannot be staged">
            <input
              type="checkbox"
              checked={ignoreWhitespace}
              onChange={(event) => setIgnoreWhitespace(event.target.checked)}
              className="rounded border-border text-accent focus:ring-accent"
            />
            <span>ignore whitespace</span>
          </label>
          <SegmentedControl label="Diff layout" options={LAYOUTS} value={layout} onChange={setLayout} />
        </div>
      </div>

      {staging.error !== null && (
        <div className="shrink-0 pr-5 pb-2 pl-[72px]">
          {staging.error.kind === "stale_diff" ? (
            <p role="alert" className="text-xs text-clay-text font-medium">
              The file changed since this diff was read. The diff has been refreshed and nothing was applied.
            </p>
          ) : (
            <ErrorNotice title="The change was not applied" error={staging.error} />
          )}
        </div>
      )}

      <div
        ref={container}
        role="tree"
        aria-label="Changed files"
        aria-description="Up and down move between files; Space stages or unstages; Enter shows the diff; n and p move between hunks; s stages, u unstages, d discards the current hunk or selected lines; Delete discards the file."
        tabIndex={0}
        aria-activedescendant={activeFileRow >= 0 ? `stream-row-${activeFileRow}` : undefined}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (activeFileRow < 0) moveFile(0);
        }}
        className="relative min-h-0 flex-1 overflow-auto font-mono text-xs outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--rg-accent)]"
        style={{ tabSize: 4, lineHeight: `${DIFF_ROW}px` }}
      >
        {files.length === 0 ? (
          <p className="py-6 pl-[72px] font-sans text-xs text-fg-muted">
            {status.files.length === 0 ? "No changes. The working tree is clean." : `No changed files match “${filter}”.`}
          </p>
        ) : (
          <div style={{ height: totalHeight, position: "relative" }}>
            {rows.slice(start, end).map((row, offset) => {
              const index: number = start + offset;
              const style = { position: "absolute" as const, top: index * DIFF_ROW, height: DIFF_ROW, left: 0, right: 0 };
              return (
                <StreamRowView
                  key={rowKey(row, index)}
                  id={`stream-row-${index}`}
                  row={row}
                  style={style}
                  active={index === activeFileRow}
                  activeHunk={hunkRows[activeHunk] === index}
                  layout={layout}
                  busy={staging.isPending}
                  ignoreWhitespace={ignoreWhitespace}
                  selection={selection}
                  hunkKey={hunkKey}
                  lineSelectable={lineSelectable}
                  onSelectFile={(file) => selectChange({ path: file.path, side: "unstaged" })}
                  onResolve={(file) => setResolving(file.path)}
                  onToggleExpanded={toggleExpanded}
                  onToggleStage={toggleStage}
                  onDiscardFile={discardFile}
                  onToggleLine={toggleLine}
                  onHunk={(path, side, hunkIndex, action) => {
                    setActiveHunk(hunkRows.indexOf(index));
                    runHunk(path, side, hunkIndex, action);
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      </>
      )}

      {discard !== null && (
        <ConfirmDialog
          title={discard.title}
          confirmLabel={discard.confirmLabel}
          destructive
          busy={staging.isPending}
          onCancel={() => setDiscard(null)}
          onConfirm={() => staging.mutate(discard.request, { onSettled: () => setDiscard(null) })}
        >
          <p>{discard.body}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function rowKey(row: StreamRow, index: number): string {
  switch (row.kind) {
    case "group":
      return `g:${row.group}`;
    case "file":
      return `f:${row.file.path}`;
    case "message":
      return `m:${row.path}`;
    case "diff":
      return `d:${row.path}:${index}`;
  }
}

interface StreamRowViewProps {
  id: string;
  row: StreamRow;
  style: React.CSSProperties;
  active: boolean;
  activeHunk: boolean;
  layout: DiffLayout;
  busy: boolean;
  ignoreWhitespace: boolean;
  selection: ReadonlyMap<string, ReadonlySet<number>>;
  hunkKey: (path: string, side: WorkingDiffSide, hunkIndex: number) => string;
  lineSelectable: (path: string, side: WorkingDiffSide) => boolean;
  onSelectFile: (file: FileStatus) => void;
  onResolve: (file: FileStatus) => void;
  onToggleExpanded: (path: string) => void;
  onToggleStage: (file: FileStatus) => void;
  onDiscardFile: (file: FileStatus) => void;
  onToggleLine: (path: string, side: WorkingDiffSide, hunkIndex: number, lineIndex: number) => void;
  onHunk: (path: string, side: WorkingDiffSide, hunkIndex: number, action: HunkAction) => void;
}

function StreamRowView(props: StreamRowViewProps): ReactNode {
  const { id, row, style, active } = props;
  if (row.kind === "group") {
    return (
      <div style={style} className="flex items-end pb-0.5 pl-[72px]">
        <span className={`rg-tag font-semibold tracking-wider uppercase text-2xs ${row.group === "conflicts" ? "text-danger" : "text-fg-muted"}`}>
          {row.group} ({row.count})
        </span>
      </div>
    );
  }
  if (row.kind === "message") {
    return (
      <div style={{ ...style, paddingLeft: 72 + DIFF_INDENT }} className="font-sans text-xs text-fg-muted italic">
        {row.text}
      </div>
    );
  }
  if (row.kind === "file") return <FileRow {...props} file={row.file} expanded={row.expanded} position={row.position} setSize={row.setSize} id={id} active={active} />;

  const { path, row: canvas } = row;
  const indent: number = 72 + DIFF_INDENT;
  if (canvas.kind === "section") {
    return (
      <div style={{ ...style, paddingLeft: indent }} className="flex items-center gap-3">
        <span className="rg-label font-medium">{canvas.side === "staged" ? "staged" : "not staged"}</span>
        <span className="tabular-nums font-mono text-2xs">
          <span className="text-success font-semibold">+{canvas.added}</span> <span className="text-danger font-semibold">−{canvas.deleted}</span>
        </span>
      </div>
    );
  }
  if (canvas.kind === "note") {
    return (
      <div style={{ ...style, paddingLeft: indent }} className="font-sans text-xs text-fg-muted">
        {canvas.text}
      </div>
    );
  }
  if (canvas.kind === "hunk") {
    const selectedCount: number = props.selection.get(props.hunkKey(path, canvas.side, canvas.hunkIndex))?.size ?? 0;
    return (
      <HunkHeader
        style={style}
        indent={indent}
        header={canvas.hunk.header}
        side={canvas.side}
        active={props.activeHunk}
        selectedCount={selectedCount}
        disabled={props.ignoreWhitespace || props.busy}
        onAction={(action) => props.onHunk(path, canvas.side, canvas.hunkIndex, action)}
      />
    );
  }
  const chosen = props.selection.get(props.hunkKey(path, canvas.side, canvas.hunkIndex));
  const selectable: boolean = props.lineSelectable(path, canvas.side);
  if (canvas.kind === "line") {
    return (
      <UnifiedLine
        style={style}
        indent={indent}
        refLine={canvas}
        selected={chosen?.has(canvas.lineIndex) === true}
        selectable={selectable && canvas.line.kind !== "context"}
        onToggle={() => props.onToggleLine(path, canvas.side, canvas.hunkIndex, canvas.lineIndex)}
      />
    );
  }
  return (
    <div style={{ ...style, paddingLeft: indent }} className="flex">
      <SplitHalf
        refLine={canvas.left}
        selected={canvas.left !== null && chosen?.has(canvas.left.lineIndex) === true}
        selectable={canvas.left !== null && canvas.left.line.kind !== "context" && selectable}
        onToggle={() => canvas.left !== null && props.onToggleLine(path, canvas.side, canvas.hunkIndex, canvas.left.lineIndex)}
        side="old"
      />
      <SplitHalf
        refLine={canvas.right}
        selected={canvas.right !== null && canvas.right.line.kind !== "context" && chosen?.has(canvas.right.lineIndex) === true}
        selectable={canvas.right !== null && canvas.right.line.kind !== "context" && selectable}
        onToggle={() => canvas.right !== null && props.onToggleLine(path, canvas.side, canvas.hunkIndex, canvas.right.lineIndex)}
        side="new"
      />
    </div>
  );
}

function FileRow({
  id,
  style,
  file,
  expanded,
  position,
  setSize,
  active,
  busy,
  onSelectFile,
  onResolve,
  onToggleExpanded,
  onToggleStage,
  onDiscardFile,
}: StreamRowViewProps & { file: FileStatus; expanded: boolean; position: number; setSize: number }) {
  const kind = displayKind(file);
  const meta = kind === null ? null : CHANGE_LABELS[kind];
  const { name, directory } = splitPath(file.path);
  const staged: boolean = file.staged !== null && !file.conflicted;
  const changed: boolean = file.unstaged !== null && !file.conflicted;
  const partiallyStaged = isPartiallyStaged(file);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div
      id={id}
      role="treeitem"
      aria-level={1}
      aria-expanded={expanded}
      aria-selected={active}
      aria-posinset={position}
      aria-setsize={setSize}
      aria-label={`${file.path}, ${meta?.label ?? "changed"}, ${stagingState(file)}`}
      onClick={() => {
        onSelectFile(file);
        if (file.conflicted) onResolve(file);
        else onToggleExpanded(file.path);
      }}
      style={style}
      className={`group flex cursor-default items-center gap-2 pr-5 font-sans transition-colors ${
        active ? "bg-selection-strong font-medium" : "hover:bg-hover/80"
      }`}
    >
      {/* The file hangs off the thread: a short branch from the lane. */}
      <span aria-hidden className="ml-[20px] h-px w-[20px] shrink-0 bg-border-control/60" />

      {file.conflicted ? (
        <span aria-hidden className="w-[36px] text-center font-mono text-xs text-danger font-bold">
          !
        </span>
      ) : (
        <span className="flex w-[36px] shrink-0 items-center justify-center">
          <button
            type="button"
            tabIndex={-1}
            disabled={busy}
            title={changed ? "Stage" : "Unstage"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleStage(file);
            }}
            className="flex size-5 items-center justify-center rounded hover:bg-hover active:scale-90 transition-all cursor-pointer"
          >
            {partiallyStaged ? (
              <MinusSquare aria-hidden className="size-3.5 text-clay-text" />
            ) : staged ? (
              <CheckSquare aria-hidden className="size-3.5 text-accent" />
            ) : (
              <Square aria-hidden className="size-3.5 text-fg-muted group-hover:text-fg-secondary" />
            )}
          </button>
        </span>
      )}

      {/* Change kind badge */}
      <span
        aria-hidden
        className={`flex size-4 shrink-0 items-center justify-center rounded text-2xs font-mono font-bold leading-none ${
          meta?.tone ?? "text-fg-muted"
        }`}
        title={meta?.label ?? "changed"}
      >
        {meta?.letter}
      </span>

      <Chevron aria-hidden className="size-3.5 shrink-0 text-fg-muted transition-transform" />

      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="max-w-[65%] shrink-0 truncate font-mono text-xs font-semibold text-fg">
          {name}
        </span>
        <span className="min-w-0 truncate font-mono text-2xs text-fg-muted" dir="rtl">
          <bdi dir="ltr">{directory}</bdi>
        </span>
        {partiallyStaged && (
          <span className="shrink-0 rounded bg-clay/15 border border-clay/25 px-1.5 py-0.2 font-mono text-2xs font-semibold text-clay-text">
            partly staged
          </span>
        )}
      </span>

      {file.conflicted && (
        <button
          type="button"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onSelectFile(file);
            onResolve(file);
          }}
          className="shrink-0 rounded-md bg-accent/15 border border-accent/40 px-2 py-0.5 text-2xs font-semibold text-accent hover:bg-accent/25 transition-all shadow-2xs active:scale-95"
        >
          Resolve…
        </button>
      )}

      {changed && (
        <button
          type="button"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onDiscardFile(file);
          }}
          className="shrink-0 rounded px-2 py-0.5 text-2xs text-fg-muted opacity-0 transition-all duration-100 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger active:scale-95"
        >
          {file.unstaged === "untracked" ? "Delete…" : "Discard…"}
        </button>
      )}
    </div>
  );
}
