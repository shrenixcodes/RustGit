import { memo, type CSSProperties } from "react";
import type { DiffLine, WorkingDiffSide } from "../services/types";
import type { LineRef } from "../features/changes/diffModel";

/** Height of every row in diff streams. */
export const DIFF_ROW = 22;

const SIGN: Record<DiffLine["kind"], string> = { context: " ", add: "+", delete: "−" };

function lineTone(kind: DiffLine["kind"], selected: boolean): string {
  if (kind === "add") return selected ? "bg-[var(--rg-diff-add-marker)]" : "bg-[var(--rg-diff-add-bg)]";
  if (kind === "delete") return selected ? "bg-[var(--rg-diff-del-marker)]" : "bg-[var(--rg-diff-del-bg)]";
  return "";
}

/** Line text with the word-level change emphasised. */
export function LineContent({ refLine }: { refLine: LineRef }) {
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

export type HunkAction = "stage" | "unstage" | "discard";

interface HunkHeaderProps {
  style: CSSProperties;
  indent: number;
  header: string;
  side: WorkingDiffSide | "commit";
  active: boolean;
  selectedCount: number;
  disabled: boolean;
  onAction?: (action: HunkAction) => void;
}

/** Hunk header fill: the canvas, tinted with the selection colour when active. */
function hunkBackground(active: boolean): string {
  return active ? "linear-gradient(var(--rg-selection), var(--rg-selection)), var(--rg-canvas)" : "var(--rg-canvas)";
}

export function HunkHeader({ style, indent, header, side, active, selectedCount, disabled, onAction }: HunkHeaderProps) {
  const what: string = selectedCount > 0 ? `${selectedCount} line${selectedCount === 1 ? "" : "s"}` : "hunk";
  return (
    <div
      className="flex items-center gap-2 border-y border-border/40 font-mono text-xs"
      style={{ ...style, paddingLeft: indent, background: hunkBackground(active) }}
    >
      <span className="min-w-0 flex-1 truncate text-fg-muted font-medium">{header}</span>
      {onAction !== undefined && side !== "commit" && (
        // Opaque, so header text scrolled underneath does not show through the buttons.
        <span className="sticky right-0 flex shrink-0 items-center gap-1.5 pr-3 pl-2 font-sans" style={{ background: hunkBackground(active) }}>
          {side === "unstaged" ? (
            <>
              <HunkButton label={`Stage ${what}`} disabled={disabled} onClick={() => onAction("stage")} />
              <HunkButton label={`Discard ${what}`} disabled={disabled} onClick={() => onAction("discard")} danger />
            </>
          ) : (
            <HunkButton label={`Unstage ${what}`} disabled={disabled} onClick={() => onAction("unstage")} />
          )}
        </span>
      )}
    </div>
  );
}

function HunkButton({ label, disabled, onClick, danger = false }: { label: string; disabled: boolean; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-5 rounded px-2 font-mono text-2xs font-medium transition-all duration-100 disabled:opacity-40 active:scale-95 ${
        danger
          ? "border border-danger/30 text-danger hover:bg-danger/10 hover:border-danger"
          : "border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 hover:border-accent"
      }`}
    >
      {label}
    </button>
  );
}

interface UnifiedLineProps {
  style: CSSProperties;
  indent: number;
  refLine: LineRef;
  selected: boolean;
  selectable: boolean;
  onToggle?: (extend: boolean) => void;
}

export const UnifiedLine = memo(function UnifiedLine({ style, indent, refLine, selected, selectable, onToggle }: UnifiedLineProps) {
  const { line } = refLine;
  return (
    <div
      style={{ ...style, paddingLeft: indent }}
      onClick={(event) => selectable && onToggle?.(event.shiftKey)}
      aria-selected={selectable ? selected : undefined}
      className={`flex whitespace-pre ${lineTone(line.kind, selected)} ${selectable ? "cursor-pointer" : ""}`}
    >
      <span aria-hidden className={`w-1 shrink-0 ${selected ? "bg-accent" : ""}`} />
      <span className="w-10 shrink-0 pr-2 text-right text-fg-muted select-none">{line.oldLine ?? ""}</span>
      <span className="w-10 shrink-0 pr-2 text-right text-fg-muted select-none">{line.newLine ?? ""}</span>
      <span
        className={`w-4 shrink-0 select-none ${line.kind === "add" ? "text-success" : line.kind === "delete" ? "text-danger" : "text-fg-muted"}`}
      >
        {SIGN[line.kind]}
      </span>
      <span data-selectable className="pr-6 text-fg">
        <LineContent refLine={refLine} />
        {line.noNewlineAtEnd && <span className="ml-2 text-fg-muted">no newline at end</span>}
      </span>
    </div>
  );
});

interface SplitHalfProps {
  refLine: LineRef | null;
  selected: boolean;
  selectable: boolean;
  onToggle?: (extend: boolean) => void;
  side: "old" | "new";
}

export function SplitHalf({ refLine, selected, selectable, onToggle, side }: SplitHalfProps) {
  if (refLine === null) {
    return <div className={`w-1/2 min-w-0 ${side === "old" ? "border-r border-divider" : ""}`} />;
  }
  const { line } = refLine;
  const number: number | null = side === "old" ? line.oldLine : line.newLine;
  return (
    <div
      onClick={(event) => selectable && onToggle?.(event.shiftKey)}
      className={`flex w-1/2 min-w-0 overflow-hidden whitespace-pre ${lineTone(line.kind, selected)} ${
        side === "old" ? "border-r border-divider" : ""
      } ${selectable ? "cursor-pointer" : ""}`}
    >
      <span aria-hidden className={`w-1 shrink-0 ${selected ? "bg-accent" : ""}`} />
      <span className="w-10 shrink-0 pr-2 text-right text-fg-muted select-none">{number ?? ""}</span>
      <span data-selectable className="pr-4 text-fg">
        <LineContent refLine={refLine} />
        {line.noNewlineAtEnd && <span className="ml-2 text-fg-muted">no newline at end</span>}
      </span>
    </div>
  );
}
