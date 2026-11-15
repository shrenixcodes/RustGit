import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { SegmentedControl, type SegmentOption } from "../../components/SegmentedControl";
import { useVirtualRows } from "../../components/useVirtualRows";
import type { IpcError } from "../../services/ipc";
import { useFileDiff, useStaging, type StagingRequest } from "../../services/queries";
import type { DiffHunk, DiffLine, FileDiff, FileStatus, WorkingDiffSide } from "../../services/types";
import { buildCanvasRows, longestLine, type CanvasRow, type DiffLayout, type LineRef } from "./diffModel";
import { splitPath } from "./changeLabels";

const ROW = 20;
const CHAR_WIDTH = 7.25;
const UNIFIED_GUTTER = 16 + 40 + 40 + 16;

const LAYOUTS: readonly SegmentOption<DiffLayout>[] = [
  { value: "unified", label: "Unified" },
  { value: "split", label: "Split" },
];

type Selection = ReadonlyMap<string, ReadonlySet<number>>;

function hunkKey(side: WorkingDiffSide, hunkIndex: number): string {
  return `${side}:${hunkIndex}`;
}

interface PendingDiscard {
  title: string;
  body: string;
  confirmLabel: string;
  request: StagingRequest;
}

interface DiffCanvasProps {
  repositoryId: number;
  file: FileStatus;
}

/**
 * The diff canvas for one file: its staged change above its not-staged
 * change, each with hunk and line actions that call the backend's
 * `apply_hunk`. The canvas never edits text itself.
 */
export function DiffCanvas({ repositoryId, file }: DiffCanvasProps) {
  const [layout, setLayout] = useState<DiffLayout>("unified");
  const [ignoreWhitespace, setIgnoreWhitespace] = useState<boolean>(false);
  const [selection, setSelection] = useState<Selection>(new Map());
  const [anchor, setAnchor] = useState<{ key: string; lineIndex: number } | null>(null);
  const [activeHunk, setActiveHunk] = useState<number>(0);
  const [discard, setDiscard] = useState<PendingDiscard | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const staging = useStaging(repositoryId);

  const hasStaged: boolean = !file.conflicted && file.staged !== null;
  const hasUnstaged: boolean = !file.conflicted && file.unstaged !== null;
  const staged = useFileDiff(repositoryId, file.path, file.originalPath, "staged", ignoreWhitespace, hasStaged);
  const unstaged = useFileDiff(repositoryId, file.path, file.originalPath, "unstaged", ignoreWhitespace, hasUnstaged);

  const diffs: FileDiff[] = useMemo(
    () => [hasStaged ? staged.data : undefined, hasUnstaged ? unstaged.data : undefined].filter((d): d is FileDiff => d !== undefined),
    [hasStaged, hasUnstaged, staged.data, unstaged.data],
  );
  const rows: CanvasRow[] = useMemo(() => buildCanvasRows(diffs, layout), [diffs, layout]);
  const hunkRows: number[] = useMemo(
    () => rows.flatMap((row: CanvasRow, index: number) => (row.kind === "hunk" ? [index] : [])),
    [rows],
  );
  const { start, end, totalHeight, ensureVisible } = useVirtualRows(container, rows.length, ROW, 20);
  const contentWidth: number = UNIFIED_GUTTER + longestLine(diffs) * CHAR_WIDTH + 24;

  // A new diff invalidates line selections: they refer to line indices.
  useEffect(() => {
    setSelection(new Map());
    setAnchor(null);
  }, [staged.data, unstaged.data, file.path, layout]);

  const diffFor = (side: WorkingDiffSide): FileDiff | undefined => diffs.find((d) => d.side === side);
  const lineSelectable = (side: WorkingDiffSide): boolean => !ignoreWhitespace && diffFor(side)?.status === "modified";

  const toggleLine = (side: WorkingDiffSide, hunkIndex: number, lineIndex: number, extend: boolean): void => {
    const hunk: DiffHunk | undefined = diffFor(side)?.hunks[hunkIndex];
    if (hunk === undefined || !lineSelectable(side)) return;
    const key: string = hunkKey(side, hunkIndex);
    setSelection((current) => {
      const next: Map<string, ReadonlySet<number>> = new Map(current);
      const set: Set<number> = new Set(next.get(key) ?? []);
      if (extend && anchor !== null && anchor.key === key) {
        const [from, to] = [Math.min(anchor.lineIndex, lineIndex), Math.max(anchor.lineIndex, lineIndex)];
        for (let i = from; i <= to; i += 1) if (hunk.lines[i]?.kind !== "context") set.add(i);
      } else if (set.has(lineIndex)) set.delete(lineIndex);
      else set.add(lineIndex);
      if (set.size === 0) next.delete(key);
      else next.set(key, set);
      return next;
    });
    if (!extend) setAnchor({ key, lineIndex });
  };

  const hunkRequest = (side: WorkingDiffSide, hunkIndex: number, action: "stage" | "unstage" | "discard"): StagingRequest | null => {
    const hunk: DiffHunk | undefined = diffFor(side)?.hunks[hunkIndex];
    if (hunk === undefined) return null;
    const chosen: ReadonlySet<number> | undefined = selection.get(hunkKey(side, hunkIndex));
    return {
      kind: "hunk",
      path: file.path,
      side,
      action,
      hunkHeader: hunk.header,
      lineIndices: chosen === undefined ? null : [...chosen].sort((a, b) => a - b),
    };
  };

  const runHunk = (side: WorkingDiffSide, hunkIndex: number, action: "stage" | "unstage" | "discard"): void => {
    const request: StagingRequest | null = hunkRequest(side, hunkIndex, action);
    if (request === null || request.kind !== "hunk") return;
    if (action === "discard") {
      const count: number = request.lineIndices?.length ?? 0;
      setDiscard({
        title: count > 0 ? `Discard ${count} selected line${count === 1 ? "" : "s"}?` : "Discard this hunk?",
        body: `The ${count > 0 ? "selected lines" : "hunk"} in ${file.path} will be reverted in the working tree. Git keeps no copy of uncommitted changes, so this cannot be undone.`,
        confirmLabel: count > 0 ? `Discard ${count} line${count === 1 ? "" : "s"}` : "Discard hunk",
        request,
      });
      return;
    }
    staging.mutate(request);
  };

  const focusHunk = (step: 1 | -1): void => {
    if (hunkRows.length === 0) return;
    const next: number = Math.max(0, Math.min(hunkRows.length - 1, activeHunk + step));
    setActiveHunk(next);
    ensureVisible(hunkRows[next] as number);
  };

  const activeHunkRow: CanvasRow | undefined = rows[hunkRows[activeHunk] ?? -1];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = activeHunkRow?.kind === "hunk" ? activeHunkRow : null;
    switch (event.key) {
      case "n":
        focusHunk(1);
        break;
      case "p":
        focusHunk(-1);
        break;
      case "s":
        if (target?.side === "unstaged" && !ignoreWhitespace) runHunk("unstaged", target.hunkIndex, "stage");
        break;
      case "u":
        if (target?.side === "staged" && !ignoreWhitespace) runHunk("staged", target.hunkIndex, "unstage");
        break;
      case "d":
        if (target?.side === "unstaged" && !ignoreWhitespace) runHunk("unstaged", target.hunkIndex, "discard");
        break;
      case "Escape":
        setSelection(new Map());
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const loading: boolean = (hasStaged && staged.isPending) || (hasUnstaged && unstaged.isPending);
  const loadError: IpcError | null = staged.error ?? unstaged.error ?? null;
  const { name, directory } = splitPath(file.path);

  return (
    <section aria-label={`Diff of ${file.path}`} className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 px-5">
        <span className="truncate font-mono text-sm text-fg">{name}</span>
        <span className="min-w-0 truncate font-mono text-xs text-fg-muted">
          {file.originalPath !== null ? `${file.originalPath} → ` : ""}
          {directory}
        </span>
        <span className="flex-1" />
        {hasUnstaged && (
          <Button variant="ghost" disabled={staging.isPending} onClick={() => staging.mutate({ kind: "stage", paths: [file.path] })}>
            Stage file
          </Button>
        )}
        {hasStaged && (
          <Button variant="ghost" disabled={staging.isPending} onClick={() => staging.mutate({ kind: "unstage", paths: [file.path] })}>
            Unstage file
          </Button>
        )}
        {hasUnstaged && (
          <Button
            variant="ghost"
            disabled={staging.isPending}
            onClick={() =>
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
                      body: `${file.path} will be reverted to its staged version${hasStaged ? " (staged changes are kept)" : ""}. Unstaged changes cannot be recovered from Git.`,
                      confirmLabel: "Discard changes",
                      request: { kind: "discard", paths: [file.path] },
                    },
              )
            }
          >
            Discard…
          </Button>
        )}
        <label className="flex items-center gap-1.5 font-mono text-xs text-fg-muted" title="Hunks of a whitespace-ignoring diff cannot be staged">
          <input type="checkbox" checked={ignoreWhitespace} onChange={(event) => setIgnoreWhitespace(event.target.checked)} />
          ignore whitespace
        </label>
        <SegmentedControl label="Diff layout" options={LAYOUTS} value={layout} onChange={setLayout} />
      </header>

      {staging.error !== null && (
        <div className="px-5 pb-2">
          {staging.error.kind === "stale_diff" ? (
            <p role="alert" className="text-sm text-clay-text">
              The file changed since this diff was read. The diff has been refreshed and nothing was applied.
            </p>
          ) : (
            <ErrorNotice title="The change was not applied" error={staging.error} />
          )}
        </div>
      )}
      {ignoreWhitespace && (
        <p className="px-5 pb-2 text-xs text-fg-muted">
          Whitespace changes are hidden. Staging hunks or lines is disabled until whitespace is shown again.
        </p>
      )}

      {file.conflicted ? (
        <Empty>This file has merge conflicts. Resolve them, then stage the result.</Empty>
      ) : loading ? (
        <Empty>Reading the diff…</Empty>
      ) : loadError !== null ? (
        <div className="p-5">
          <ErrorNotice title="Could not read the diff" error={loadError} />
        </div>
      ) : (
        <div
          ref={container}
          tabIndex={0}
          role="region"
          aria-label="Diff lines. n and p move between hunks; s stages, u unstages, d discards the current hunk or selected lines."
          onKeyDown={onKeyDown}
          className="rg-canvas relative min-h-0 flex-1 overflow-auto font-mono text-xs leading-5 outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--rg-accent)]"
          style={{ tabSize: 4 }}
        >
          <div style={{ height: totalHeight, minWidth: layout === "unified" ? contentWidth : undefined, position: "relative" }}>
            {rows.slice(start, end).map((row: CanvasRow, offset: number) => {
              const index: number = start + offset;
              const style = { position: "absolute" as const, top: index * ROW, height: ROW, left: 0, right: 0 };
              if (row.kind === "section") {
                return (
                  <div key={`s${row.side}`} style={style} className="flex items-center gap-3 bg-bg px-5">
                    <span className="rg-label">{row.side === "staged" ? "staged" : "not staged"}</span>
                    <span className="tabular-nums">
                      <span className="text-success">+{row.added}</span> <span className="text-danger">−{row.deleted}</span>
                    </span>
                  </div>
                );
              }
              if (row.kind === "note") {
                return (
                  <div key={`n${row.side}`} style={style} className="px-5 font-sans text-sm text-fg-muted">
                    {row.text}
                  </div>
                );
              }
              if (row.kind === "hunk") {
                const key: string = hunkKey(row.side, row.hunkIndex);
                return (
                  <HunkHeader
                    key={`h${key}`}
                    style={style}
                    header={row.hunk.header}
                    side={row.side}
                    active={hunkRows[activeHunk] === index}
                    selectedCount={selection.get(key)?.size ?? 0}
                    disabled={ignoreWhitespace || staging.isPending}
                    onAction={(action) => {
                      setActiveHunk(hunkRows.indexOf(index));
                      runHunk(row.side, row.hunkIndex, action);
                    }}
                  />
                );
              }
              const key: string = hunkKey(row.side, row.hunkIndex);
              const chosen: ReadonlySet<number> | undefined = selection.get(key);
              if (row.kind === "line") {
                return (
                  <UnifiedLine
                    key={`l${key}:${row.lineIndex}`}
                    style={style}
                    refLine={row}
                    selected={chosen?.has(row.lineIndex) === true}
                    selectable={lineSelectable(row.side) && row.line.kind !== "context"}
                    onToggle={(extend) => toggleLine(row.side, row.hunkIndex, row.lineIndex, extend)}
                  />
                );
              }
              return (
                <div key={`x${key}:${index}`} style={style} className="flex">
                  <SplitHalf
                    refLine={row.left}
                    selected={row.left !== null && chosen?.has(row.left.lineIndex) === true}
                    selectable={row.left !== null && row.left.line.kind !== "context" && lineSelectable(row.side)}
                    onToggle={(extend) => row.left !== null && toggleLine(row.side, row.hunkIndex, row.left.lineIndex, extend)}
                    side="old"
                  />
                  <SplitHalf
                    refLine={row.right}
                    selected={row.right !== null && row.right.line.kind !== "context" && chosen?.has(row.right.lineIndex) === true}
                    selectable={row.right !== null && row.right.line.kind !== "context" && lineSelectable(row.side)}
                    onToggle={(extend) => row.right !== null && toggleLine(row.side, row.hunkIndex, row.right.lineIndex, extend)}
                    side="new"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {discard !== null && (
        <ConfirmDialog
          title={discard.title}
          confirmLabel={discard.confirmLabel}
          destructive
          busy={staging.isPending}
          onCancel={() => setDiscard(null)}
          onConfirm={() => {
            staging.mutate(discard.request, { onSettled: () => setDiscard(null) });
          }}
        >
          <p>{discard.body}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rg-canvas flex flex-1 items-center justify-center px-6 text-center text-sm text-fg-muted">{children}</div>;
}

interface HunkHeaderProps {
  style: React.CSSProperties;
  header: string;
  side: WorkingDiffSide;
  active: boolean;
  selectedCount: number;
  disabled: boolean;
  onAction: (action: "stage" | "unstage" | "discard") => void;
}

function HunkHeader({ style, header, side, active, selectedCount, disabled, onAction }: HunkHeaderProps) {
  const what: string = selectedCount > 0 ? `${selectedCount} line${selectedCount === 1 ? "" : "s"}` : "hunk";
  return (
    <div style={style} className={`flex items-center gap-2 border-t border-divider pl-5 ${active ? "bg-selection" : "bg-surface"}`}>
      <span className="min-w-0 flex-1 truncate text-fg-muted">{header}</span>
      <span className="sticky right-0 flex shrink-0 items-center gap-1 bg-inherit pr-3 font-sans">
        {side === "unstaged" ? (
          <>
            <HunkButton label={`Stage ${what}`} disabled={disabled} onClick={() => onAction("stage")} />
            <HunkButton label={`Discard ${what}`} disabled={disabled} onClick={() => onAction("discard")} danger />
          </>
        ) : (
          <HunkButton label={`Unstage ${what}`} disabled={disabled} onClick={() => onAction("unstage")} />
        )}
      </span>
    </div>
  );
}

function HunkButton({ label, disabled, onClick, danger = false }: { label: string; disabled: boolean; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-[18px] rounded-xs px-1.5 text-xs transition-colors duration-100 disabled:opacity-40 ${
        danger ? "text-fg-muted hover:text-danger" : "text-accent hover:bg-selection"
      }`}
    >
      {label}
    </button>
  );
}

const SIGN: Record<DiffLine["kind"], string> = { context: " ", add: "+", delete: "−" };

function lineTone(kind: DiffLine["kind"], selected: boolean): string {
  if (kind === "add") return selected ? "bg-[var(--rg-diff-add-marker)]" : "bg-[var(--rg-diff-add-bg)]";
  if (kind === "delete") return selected ? "bg-[var(--rg-diff-del-marker)]" : "bg-[var(--rg-diff-del-bg)]";
  return "";
}

function Content({ refLine }: { refLine: LineRef }) {
  const { line, words } = refLine;
  if (words === null) return <>{line.content}</>;
  const mark: string = line.kind === "add" ? "bg-[var(--rg-diff-add-marker)]" : "bg-[var(--rg-diff-del-marker)]";
  return (
    <>
      {line.content.slice(0, words.start)}
      <span className={`rounded-xs ${mark}`}>{line.content.slice(words.start, words.end)}</span>
      {line.content.slice(words.end)}
    </>
  );
}

const UnifiedLine = memo(function UnifiedLine({
  style,
  refLine,
  selected,
  selectable,
  onToggle,
}: {
  style: React.CSSProperties;
  refLine: LineRef;
  selected: boolean;
  selectable: boolean;
  onToggle: (extend: boolean) => void;
}) {
  const { line } = refLine;
  return (
    <div
      style={style}
      onClick={(event) => selectable && onToggle(event.shiftKey)}
      aria-selected={selectable ? selected : undefined}
      className={`flex whitespace-pre ${lineTone(line.kind, selected)} ${selectable ? "cursor-pointer" : ""}`}
    >
      <span aria-hidden className={`w-4 shrink-0 ${selected ? "bg-accent" : ""}`} />
      <span className="w-10 shrink-0 pr-2 text-right text-fg-muted select-none">{line.oldLine ?? ""}</span>
      <span className="w-10 shrink-0 pr-2 text-right text-fg-muted select-none">{line.newLine ?? ""}</span>
      <span className={`w-4 shrink-0 select-none ${line.kind === "add" ? "text-success" : line.kind === "delete" ? "text-danger" : "text-fg-muted"}`}>
        {SIGN[line.kind]}
      </span>
      <span data-selectable className="text-fg">
        <Content refLine={refLine} />
        {line.noNewlineAtEnd && <span className="ml-2 text-fg-muted">⏎̸ no newline</span>}
      </span>
    </div>
  );
});

function SplitHalf({
  refLine,
  selected,
  selectable,
  onToggle,
  side,
}: {
  refLine: LineRef | null;
  selected: boolean;
  selectable: boolean;
  onToggle: (extend: boolean) => void;
  side: "old" | "new";
}) {
  if (refLine === null) {
    return <div className={`w-1/2 min-w-0 ${side === "old" ? "border-r border-divider" : ""}`} />;
  }
  const { line } = refLine;
  const number: number | null = side === "old" ? line.oldLine : line.newLine;
  return (
    <div
      onClick={(event) => selectable && onToggle(event.shiftKey)}
      className={`flex w-1/2 min-w-0 overflow-hidden whitespace-pre ${lineTone(line.kind, selected)} ${
        side === "old" ? "border-r border-divider" : ""
      } ${selectable ? "cursor-pointer" : ""}`}
    >
      <span aria-hidden className={`w-1 shrink-0 ${selected ? "bg-accent" : ""}`} />
      <span className="w-10 shrink-0 pr-2 text-right text-fg-muted select-none">{number ?? ""}</span>
      <span className="truncate text-fg" title={line.content}>
        <Content refLine={refLine} />
      </span>
    </div>
  );
}
