import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ChangeKind, FileStatus } from "../../services/types";
import { useVirtualRows } from "../../components/useVirtualRows";
import { rowHeightFor, usePreferences } from "../../stores/preferences";
import { CHANGE_LABELS, isPartiallyStaged, matchesFilter, splitPath } from "./changeLabels";

/** Navigator groups. A file belongs to exactly one, so it appears once. */
export type NavigatorGroup = "conflicts" | "changes" | "untracked";

const GROUP_ORDER: readonly NavigatorGroup[] = ["conflicts", "changes", "untracked"];
const GROUP_TITLES: Record<NavigatorGroup, string> = { conflicts: "conflicts", changes: "changes", untracked: "untracked" };

export function groupOf(file: FileStatus): NavigatorGroup {
  if (file.conflicted) return "conflicts";
  if (file.staged === null && file.unstaged === "untracked") return "untracked";
  return "changes";
}

/** Plain-language staging state, used for accessible names. */
export function stagingState(file: FileStatus): string {
  if (file.conflicted) return "conflicted";
  if (isPartiallyStaged(file)) return "partially staged";
  if (file.staged !== null) return "staged";
  return file.unstaged === "untracked" ? "untracked" : "not staged";
}

/** The kind shown for a file: what is staged, else what changed in the working tree. */
export function displayKind(file: FileStatus): ChangeKind | null {
  if (file.conflicted) return "unmerged";
  return file.staged ?? file.unstaged;
}

export type NavigatorRow =
  | { type: "group"; group: NavigatorGroup; count: number; expanded: boolean }
  | { type: "file"; group: NavigatorGroup; file: FileStatus; position: number; setSize: number };

export function buildRows(files: readonly FileStatus[], query: string, collapsed: ReadonlySet<NavigatorGroup>): NavigatorRow[] {
  const groups: Record<NavigatorGroup, FileStatus[]> = { conflicts: [], changes: [], untracked: [] };
  for (const file of files) {
    if (matchesFilter(file, query)) groups[groupOf(file)].push(file);
  }
  const rows: NavigatorRow[] = [];
  for (const group of GROUP_ORDER) {
    const members: FileStatus[] = groups[group];
    if (members.length === 0) continue;
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

interface ChangeTreeProps {
  files: readonly FileStatus[];
  query: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** Stage the file's remaining changes, or unstage it when it is fully staged. */
  onToggleStage: (file: FileStatus) => void;
  onUnstage: (file: FileStatus) => void;
  busy: boolean;
}

/**
 * The integrated navigator: each changed file once, with an index cell and
 * a working-tree cell (Git's XY status). Both filled means partially staged.
 */
export function ChangeTree({ files, query, selectedPath, onSelect, onToggleStage, onUnstage, busy }: ChangeTreeProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<NavigatorGroup>>(new Set());
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const container = useRef<HTMLDivElement>(null);
  const idPrefix: string = useId();
  const rowHeight: number = usePreferences((state) => rowHeightFor(state.personality));
  const rows: NavigatorRow[] = useMemo(() => buildRows(files, query, collapsed), [files, query, collapsed]);
  const { start, end, totalHeight, ensureVisible } = useVirtualRows(container, rows.length, rowHeight);

  const selectedIndex: number = rows.findIndex((row) => row.type === "file" && row.file.path === selectedPath);
  const effectiveActive: number =
    activeIndex >= 0 && activeIndex < rows.length && (selectedIndex < 0 || rows[activeIndex]?.type === "group")
      ? activeIndex
      : selectedIndex;

  useEffect(() => {
    if (effectiveActive >= 0) ensureVisible(effectiveActive);
  }, [effectiveActive, ensureVisible]);

  const toggleGroup = (group: NavigatorGroup, expand?: boolean): void => {
    setCollapsed((current) => {
      const next: Set<NavigatorGroup> = new Set(current);
      const shouldExpand: boolean = expand ?? next.has(group);
      if (shouldExpand) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const activate = (index: number): void => {
    const row: NavigatorRow | undefined = rows[index];
    if (row === undefined) return;
    setActiveIndex(index);
    if (row.type === "file") onSelect(row.file.path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current: number = effectiveActive;
    const row: NavigatorRow | undefined = rows[current];
    const page: number = Math.max(1, Math.floor((container.current?.clientHeight ?? 480) / rowHeight) - 1);
    let next: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        next = Math.min(rows.length - 1, current + 1);
        break;
      case "ArrowUp":
        next = Math.max(0, current - 1);
        break;
      case "PageDown":
        next = Math.min(rows.length - 1, current + page);
        break;
      case "PageUp":
        next = Math.max(0, current - page);
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
        else if (row?.type === "file") next = rows.findIndex((r) => r.type === "group" && r.group === row.group);
        break;
      case "Enter":
      case " ":
        if (row?.type === "group") toggleGroup(row.group);
        else if (row?.type === "file" && !row.file.conflicted && !busy) onToggleStage(row.file);
        break;
      case "u":
        if (row?.type === "file" && row.file.staged !== null && !busy) onUnstage(row.file);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next !== null && next >= 0) activate(next);
  };

  if (rows.length === 0) {
    return (
      <p className="px-5 py-4 text-sm text-fg-muted">
        {files.length === 0 ? "No changes. The working tree is clean." : `No changed files match “${query}”.`}
      </p>
    );
  }

  return (
    <div
      ref={container}
      role="tree"
      aria-label="Changed files"
      aria-description="Space stages or unstages the file, u unstages it."
      tabIndex={0}
      aria-activedescendant={rows[effectiveActive] === undefined ? undefined : `${idPrefix}-${effectiveActive}`}
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (effectiveActive < 0) activate(rows.findIndex((row) => row.type === "file"));
      }}
      className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--rg-accent)]"
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {rows.slice(start, end).map((row: NavigatorRow, offset: number) => {
          const index: number = start + offset;
          return (
            <NavigatorRowView
              key={row.type === "group" ? `g:${row.group}` : `f:${row.file.path}`}
              id={`${idPrefix}-${index}`}
              row={row}
              top={index * rowHeight}
              height={rowHeight}
              active={index === effectiveActive}
              selected={row.type === "file" && row.file.path === selectedPath}
              busy={busy}
              onClick={() => {
                activate(index);
                if (row.type === "group") toggleGroup(row.group);
              }}
              onToggleStage={onToggleStage}
            />
          );
        })}
      </div>
    </div>
  );
}

interface NavigatorRowViewProps {
  id: string;
  row: NavigatorRow;
  top: number;
  height: number;
  active: boolean;
  selected: boolean;
  busy: boolean;
  onClick: () => void;
  onToggleStage: (file: FileStatus) => void;
}

const NavigatorRowView = memo(function NavigatorRowView({
  id,
  row,
  top,
  height,
  active,
  selected,
  busy,
  onClick,
  onToggleStage,
}: NavigatorRowViewProps) {
  const style = { position: "absolute" as const, top, height, left: 0, right: 0 };
  const activeRing: string = active ? "shadow-[inset_2px_0_0_var(--rg-border-control)]" : "";

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
        className={`flex cursor-default items-end gap-1 px-4 pb-1 ${activeRing}`}
      >
        <Chevron aria-hidden className="mb-px size-3 text-fg-muted" />
        <span className={`rg-tag ${row.group === "conflicts" ? "text-danger" : ""}`}>
          {GROUP_TITLES[row.group]} {row.count}
        </span>
      </div>
    );
  }

  const { file } = row;
  const kind: ChangeKind | null = displayKind(file);
  const meta = kind === null ? null : CHANGE_LABELS[kind];
  const { name, directory } = splitPath(file.path);
  const state: string = stagingState(file);
  const staged: boolean = file.staged !== null && !file.conflicted;
  const changed: boolean = file.unstaged !== null && !file.conflicted;
  return (
    <div
      id={id}
      role="treeitem"
      aria-level={2}
      aria-selected={selected}
      aria-posinset={row.position}
      aria-setsize={row.setSize}
      aria-label={`${file.path}, ${meta?.label ?? "changed"}, ${state}`}
      onClick={onClick}
      style={style}
      className={`group flex cursor-default items-center gap-2.5 pr-4 pl-5 ${
        selected ? "bg-selection-strong" : "hover:bg-hover"
      } ${activeRing}`}
    >
      <span aria-hidden className={`w-3 shrink-0 text-center font-mono text-xs ${meta?.tone ?? ""}`}>
        {meta?.letter}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="max-w-[75%] shrink-0 truncate text-fg">{name}</span>
        <span className="min-w-0 truncate font-mono text-2xs text-fg-muted" dir="rtl">
          <bdi dir="ltr">{directory}</bdi>
        </span>
      </span>
      {file.conflicted ? (
        <span aria-hidden className="font-mono text-xs text-danger">
          !
        </span>
      ) : (
        <span aria-hidden className="flex shrink-0 items-center gap-1.5">
          {/* Index cell: click stages the rest, or unstages a fully staged file. */}
          <button
            type="button"
            tabIndex={-1}
            disabled={busy}
            title={changed ? "Stage" : "Unstage"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleStage(file);
            }}
            className="flex size-4 items-center justify-center rounded-full hover:bg-hover"
          >
            <span className={`size-2 rounded-full ${staged ? "bg-accent" : "border border-border-control"}`} />
          </button>
          <span className="flex size-4 items-center justify-center" title={changed ? "Changed in the working tree" : "Working tree matches the index"}>
            <span className={`size-2 rounded-full ${changed ? "bg-clay" : "border border-border"}`} />
          </span>
        </span>
      )}
    </div>
  );
});
