import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FileStatus } from "../../services/types";
import { useVirtualRows } from "../../components/useVirtualRows";
import { rowHeightFor, usePreferences } from "../../stores/preferences";
import type { ChangeSelection, ChangeSide } from "../../stores/workspace";
import {
  CHANGE_LABELS,
  GROUP_ORDER,
  GROUP_TITLES,
  isPartiallyStaged,
  kindInGroup,
  matchesFilter,
  splitChanges,
  splitPath,
  type ChangeGroupId,
} from "./changeLabels";

export type TreeRow =
  | { type: "group"; group: ChangeGroupId; count: number; expanded: boolean }
  | { type: "file"; group: ChangeGroupId; file: FileStatus; position: number; setSize: number };

export function sideOfGroup(group: ChangeGroupId): ChangeSide {
  return group === "staged" ? "staged" : "unstaged";
}

/** Flattens groups into rows for windowed rendering. Empty groups are omitted. */
export function buildRows(
  files: readonly FileStatus[],
  query: string,
  collapsed: ReadonlySet<ChangeGroupId>,
): TreeRow[] {
  const groups = splitChanges(files.filter((file: FileStatus) => matchesFilter(file, query)));
  const rows: TreeRow[] = [];
  for (const group of GROUP_ORDER) {
    const members: FileStatus[] = groups[group];
    if (members.length === 0) {
      continue;
    }
    const expanded: boolean = !collapsed.has(group);
    rows.push({ type: "group", group, count: members.length, expanded });
    if (expanded) {
      members.forEach((file: FileStatus, index: number) =>
        rows.push({ type: "file", group, file, position: index + 1, setSize: members.length }),
      );
    }
  }
  return rows;
}

function isSelected(row: TreeRow, selection: ChangeSelection | null): boolean {
  return (
    row.type === "file" &&
    selection !== null &&
    row.file.path === selection.path &&
    sideOfGroup(row.group) === selection.side
  );
}

interface ChangeTreeProps {
  files: readonly FileStatus[];
  query: string;
  selection: ChangeSelection | null;
  onSelect: (selection: ChangeSelection) => void;
}

export function ChangeTree({ files, query, selection, onSelect }: ChangeTreeProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<ChangeGroupId>>(new Set());
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const container = useRef<HTMLDivElement>(null);
  const idPrefix: string = useId();
  const rowHeight: number = usePreferences((state) => rowHeightFor(state.personality));
  const rows: TreeRow[] = useMemo(() => buildRows(files, query, collapsed), [files, query, collapsed]);
  const { start, end, totalHeight, ensureVisible } = useVirtualRows(container, rows.length, rowHeight);

  // Keep the active row on the selected file when the rows change (refresh, filter).
  const selectedIndex: number = rows.findIndex((row: TreeRow) => isSelected(row, selection));
  const effectiveActive: number =
    activeIndex >= 0 && activeIndex < rows.length && (selectedIndex < 0 || rows[activeIndex]?.type === "group")
      ? activeIndex
      : selectedIndex;

  useEffect(() => {
    if (effectiveActive >= 0) {
      ensureVisible(effectiveActive);
    }
  }, [effectiveActive, ensureVisible]);

  const toggleGroup = (group: ChangeGroupId, expand?: boolean): void => {
    setCollapsed((current: ReadonlySet<ChangeGroupId>) => {
      const next: Set<ChangeGroupId> = new Set(current);
      const shouldExpand: boolean = expand ?? next.has(group);
      if (shouldExpand) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const activate = (index: number): void => {
    const row: TreeRow | undefined = rows[index];
    if (row === undefined) {
      return;
    }
    setActiveIndex(index);
    if (row.type === "file") {
      onSelect({ path: row.file.path, side: sideOfGroup(row.group) });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current: number = effectiveActive;
    const row: TreeRow | undefined = rows[current];
    const pageSize: number = Math.max(1, Math.floor((container.current?.clientHeight ?? 480) / rowHeight) - 1);
    let next: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        next = Math.min(rows.length - 1, current + 1);
        break;
      case "ArrowUp":
        next = Math.max(0, current - 1);
        break;
      case "PageDown":
        next = Math.min(rows.length - 1, current + pageSize);
        break;
      case "PageUp":
        next = Math.max(0, current - pageSize);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = rows.length - 1;
        break;
      case "ArrowRight":
        if (row?.type === "group" && !row.expanded) toggleGroup(row.group, true);
        else if (row?.type === "group") next = current + 1;
        break;
      case "ArrowLeft":
        if (row?.type === "group" && row.expanded) toggleGroup(row.group, false);
        else if (row?.type === "file") next = rows.findIndex((r: TreeRow) => r.type === "group" && r.group === row.group);
        break;
      case "Enter":
      case " ":
        if (row?.type === "group") toggleGroup(row.group);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next !== null && next >= 0) {
      activate(next);
    }
  };

  if (rows.length === 0) {
    return (
      <p className="px-3 py-4 text-fg-muted">
        {files.length === 0 ? "No changes. The working tree is clean." : `No changed files match “${query}”.`}
      </p>
    );
  }

  const activeRow: TreeRow | undefined = rows[effectiveActive];
  return (
    <div
      ref={container}
      role="tree"
      aria-label="Changed files"
      tabIndex={0}
      aria-activedescendant={activeRow === undefined ? undefined : `${idPrefix}-${effectiveActive}`}
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (effectiveActive < 0) {
          activate(rows.findIndex((row: TreeRow) => row.type === "file"));
        }
      }}
      className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--rg-accent)]"
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {rows.slice(start, end).map((row: TreeRow, offset: number) => {
          const index: number = start + offset;
          return (
            <TreeRowView
              key={row.type === "group" ? `g:${row.group}` : `f:${row.group}:${row.file.path}`}
              id={`${idPrefix}-${index}`}
              row={row}
              top={index * rowHeight}
              height={rowHeight}
              active={index === effectiveActive}
              selected={isSelected(row, selection)}
              onClick={() => {
                activate(index);
                if (row.type === "group") toggleGroup(row.group);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

interface TreeRowViewProps {
  id: string;
  row: TreeRow;
  top: number;
  height: number;
  active: boolean;
  selected: boolean;
  onClick: () => void;
}

const TreeRowView = memo(function TreeRowView({ id, row, top, height, active, selected, onClick }: TreeRowViewProps) {
  const style = { position: "absolute" as const, top, height, left: 0, right: 0 };
  const activeRing: string = active ? "shadow-[inset_0_0_0_1px_var(--rg-border-control)]" : "";

  if (row.type === "group") {
    const Chevron = row.expanded ? ChevronDown : ChevronRight;
    return (
      <div
        id={id}
        role="treeitem"
        aria-level={1}
        aria-expanded={row.expanded}
        aria-selected={false}
        aria-label={`${GROUP_TITLES[row.group]}, ${row.count} file${row.count === 1 ? "" : "s"}`}
        onClick={onClick}
        style={style}
        className={`flex cursor-default items-center gap-1.5 bg-surface px-2 ${activeRing}`}
      >
        <Chevron aria-hidden className="size-3.5 text-fg-muted" />
        <span className={`rg-label ${row.group === "conflicted" ? "text-danger" : ""}`}>{GROUP_TITLES[row.group]}</span>
        <span className="font-mono text-2xs tabular-nums text-fg-muted">{row.count}</span>
      </div>
    );
  }

  const kind = kindInGroup(row.file, row.group);
  const meta = kind === null ? null : CHANGE_LABELS[kind];
  const { name, directory } = splitPath(row.file.path);
  const partial: boolean = isPartiallyStaged(row.file) && row.group !== "conflicted";
  return (
    <div
      id={id}
      role="treeitem"
      aria-level={2}
      aria-selected={selected}
      aria-posinset={row.position}
      aria-setsize={row.setSize}
      aria-label={`${row.file.path}, ${meta?.label ?? "changed"}${partial ? ", partially staged" : ""}`}
      onClick={onClick}
      style={style}
      className={`flex cursor-default items-center gap-2 pl-6 pr-2 ${
        selected ? "bg-selection-strong" : "hover:bg-hover"
      } ${activeRing}`}
    >
      <span aria-hidden className={`w-3 shrink-0 text-center font-mono text-xs font-semibold ${meta?.tone ?? ""}`}>
        {meta?.letter}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        {/* The file name keeps priority; the directory gives up space first. */}
        <span className="max-w-[75%] shrink-0 truncate text-fg">{name}</span>
        {row.file.originalPath !== null && row.group === "staged" && (
          <span className="shrink-0 truncate font-mono text-2xs text-fg-muted">← {splitPath(row.file.originalPath).name}</span>
        )}
        {/* RTL direction truncates the start of long directories; the LTR isolate keeps "." prefixes in place. */}
        <span className="min-w-0 truncate font-mono text-2xs text-fg-muted" dir="rtl">
          <bdi dir="ltr">{directory}</bdi>
        </span>
      </span>
      {partial && (
        <span
          aria-hidden
          title="Partially staged: this file also has changes in the other group"
          className="shrink-0 rounded-xs border border-amber/60 px-1 font-mono text-2xs leading-4 text-amber"
        >
          partial
        </span>
      )}
    </div>
  );
});
