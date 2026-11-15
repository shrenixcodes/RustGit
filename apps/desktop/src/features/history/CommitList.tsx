import { memo, useEffect, useId, useMemo, useRef, type KeyboardEvent } from "react";
import { useVirtualRows } from "../../components/useVirtualRows";
import type { HeadState, LogCommit, RefEntry } from "../../services/types";
import { usePreferences } from "../../stores/preferences";
import { GraphCell, LANE_WIDTH, MAX_DRAWN_LANES } from "./GraphCell";
import type { GraphRow } from "./graphLayout";
import { ancestorsOf, descendantsOf, nearestChild, type LaidOutHistory } from "./historyLayout";
import { RefBadges, describeRef } from "./RefBadges";
import { formatAbsolute, formatRelative } from "./time";

export type FocusMode = "none" | "ancestors" | "descendants";

/** Rows from the end at which the next page is requested. */
const LOAD_AHEAD_ROWS = 60;

interface CommitListProps {
  history: LaidOutHistory;
  graph: boolean;
  headOid: string | null;
  head: HeadState | undefined;
  refMap: ReadonlyMap<string, RefEntry[]>;
  selected: string | null;
  focusMode: FocusMode;
  onSelect: (oid: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  emptyText: string;
}

export function CommitList({
  history,
  graph,
  headOid,
  head,
  refMap,
  selected,
  focusMode,
  onSelect,
  hasMore,
  loadingMore,
  onLoadMore,
  emptyText,
}: CommitListProps) {
  const container = useRef<HTMLDivElement>(null);
  const idPrefix: string = useId();
  const rowHeight: number = usePreferences((state) => (state.density === "compact" ? 26 : 30));
  const { commits, rows, indexByOid } = history;
  const { start, end, totalHeight, ensureVisible } = useVirtualRows(container, commits.length, rowHeight, 12);
  const graphWidth: number = graph ? Math.min(Math.max(history.maxLanes, 1), MAX_DRAWN_LANES) * LANE_WIDTH + 8 : 0;
  const selectedIndex: number = selected === null ? -1 : (indexByOid.get(selected) ?? -1);

  // Ancestry focus is computed only when requested and only over loaded commits.
  const focused: ReadonlySet<string> | null = useMemo(() => {
    if (focusMode === "none" || selected === null || !indexByOid.has(selected)) return null;
    return focusMode === "ancestors"
      ? ancestorsOf(selected, commits, indexByOid)
      : descendantsOf(selected, commits, indexByOid);
  }, [focusMode, selected, commits, indexByOid]);

  useEffect(() => {
    if (selectedIndex >= 0) ensureVisible(selectedIndex);
  }, [selectedIndex, ensureVisible]);

  useEffect(() => {
    if (hasMore && !loadingMore && end >= commits.length - LOAD_AHEAD_ROWS) onLoadMore();
  }, [end, commits.length, hasMore, loadingMore, onLoadMore]);

  const move = (index: number): void => {
    const commit: LogCommit | undefined = commits[Math.max(0, Math.min(commits.length - 1, index))];
    if (commit !== undefined) onSelect(commit.oid);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current: number = selectedIndex < 0 ? -1 : selectedIndex;
    const page: number = Math.max(1, Math.floor((container.current?.clientHeight ?? 480) / rowHeight) - 1);
    const commit: LogCommit | undefined = commits[current];
    switch (event.key) {
      case "ArrowDown":
        move(current + 1);
        break;
      case "ArrowUp":
        move(current < 0 ? 0 : current - 1);
        break;
      case "PageDown":
        move(current + page);
        break;
      case "PageUp":
        move(current - page);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(commits.length - 1);
        break;
      case "ArrowLeft": {
        // First parent; may page in more history to reach it.
        const parent: string | undefined = commit?.parents[0];
        if (parent !== undefined) onSelect(parent);
        break;
      }
      case "ArrowRight": {
        const child: string | null = commit === undefined ? null : nearestChild(commit.oid, commits, indexByOid);
        if (child !== null) onSelect(child);
        break;
      }
      case "c":
        if (commit !== undefined && !event.ctrlKey && !event.metaKey && !event.altKey) {
          void navigator.clipboard.writeText(commit.oid).catch(() => {});
        } else {
          return;
        }
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  // Relative times are recomputed when history changes, not on every render (keeps rows memoized).
  const now: number = useMemo(() => Date.now(), [commits]);

  if (commits.length === 0) {
    return <p className="rg-grid flex-1 p-4 text-fg-muted">{emptyText}</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        aria-hidden
        className="flex h-6 shrink-0 items-center gap-3 border-b border-divider bg-surface pr-3 rg-label"
        style={{ paddingLeft: graph ? graphWidth : 12 }}
      >
        <span className="flex-1">Message</span>
        <span className="w-36">Author</span>
        <span className="w-24">Date</span>
        <span className="w-16">Commit</span>
      </div>
      <div
        ref={container}
        role="listbox"
        aria-label="Commits"
        tabIndex={0}
        aria-activedescendant={selectedIndex >= 0 ? `${idPrefix}-${selectedIndex}` : undefined}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (selectedIndex < 0) move(0);
        }}
        className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--rg-accent)]"
      >
        <div style={{ height: totalHeight + (hasMore || loadingMore ? rowHeight : 0), position: "relative" }}>
          {graph && (
            <div aria-hidden className="rg-grid absolute inset-y-0 left-0 border-r border-divider" style={{ width: graphWidth }} />
          )}
          {commits.slice(start, end).map((commit: LogCommit, offset: number) => {
            const index: number = start + offset;
            return (
              <CommitRow
                key={commit.oid}
                id={`${idPrefix}-${index}`}
                commit={commit}
                row={graph ? rows[index] : undefined}
                graphWidth={graphWidth}
                top={index * rowHeight}
                height={rowHeight}
                selected={commit.oid === selected}
                head={commit.oid === headOid}
                headState={head}
                refs={refMap.get(commit.oid)}
                dimmed={focused !== null && !focused.has(commit.oid)}
                now={now}
                onSelect={onSelect}
              />
            );
          })}
          {(hasMore || loadingMore) && (
            <div
              role="status"
              style={{ position: "absolute", top: totalHeight, height: rowHeight, left: graphWidth + 12 }}
              className="flex items-center text-xs text-fg-muted"
            >
              {loadingMore ? "Loading more history…" : "More history below"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface CommitRowProps {
  id: string;
  commit: LogCommit;
  row: GraphRow | undefined;
  graphWidth: number;
  top: number;
  height: number;
  selected: boolean;
  head: boolean;
  headState: HeadState | undefined;
  refs: RefEntry[] | undefined;
  dimmed: boolean;
  now: number;
  onSelect: (oid: string) => void;
}

const CommitRow = memo(function CommitRow({
  id,
  commit,
  row,
  graphWidth,
  top,
  height,
  selected,
  head,
  headState,
  refs,
  dimmed,
  now,
  onSelect,
}: CommitRowProps) {
  const detachedHere: boolean = headState?.kind === "detached" && headState.oid === commit.oid;
  const refText: string = (refs ?? [])
    .map((ref: RefEntry) => describeRef(ref, headState?.kind === "branch" && ref.kind === "local" && ref.shortName === headState.name))
    .join(", ");
  const label: string = [
    commit.summary,
    `by ${commit.authorName}`,
    formatRelative(commit.authorTime, now),
    commit.oid.slice(0, 7),
    row?.merge === true ? "merge commit" : "",
    head ? "HEAD" : "",
    refText,
  ]
    .filter((part: string) => part !== "")
    .join(", ");

  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-label={label}
      onClick={() => onSelect(commit.oid)}
      style={{ position: "absolute", top, height, left: 0, right: 0 }}
      className={`flex cursor-default items-center gap-3 pr-3 transition-opacity duration-100 ${
        selected ? "bg-selection-strong" : "hover:bg-hover"
      } ${dimmed ? "opacity-30" : ""}`}
    >
      {row !== undefined ? (
        <GraphCell row={row} width={graphWidth} height={height} head={head} selected={selected} />
      ) : (
        <span className="w-0 shrink-0" />
      )}
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {(detachedHere || (refs !== undefined && refs.length > 0)) && (
          <RefBadges refs={refs ?? []} head={headState} detachedHead={detachedHere} />
        )}
        <span className={`truncate ${row?.merge === true ? "text-fg-secondary" : "text-fg"}`}>{commit.summary}</span>
      </span>
      <span className="w-36 shrink-0 truncate text-sm text-fg-secondary" title={commit.authorEmail}>
        {commit.authorName}
      </span>
      <time
        dateTime={new Date(commit.authorTime * 1000).toISOString()}
        title={formatAbsolute(commit.authorTime)}
        className="w-24 shrink-0 truncate text-sm tabular-nums text-fg-muted"
      >
        {formatRelative(commit.authorTime, now)}
      </time>
      <span className={`w-16 shrink-0 font-mono text-xs ${selected ? "text-accent" : "text-fg-muted"}`}>
        {commit.oid.slice(0, 7)}
      </span>
    </div>
  );
});
