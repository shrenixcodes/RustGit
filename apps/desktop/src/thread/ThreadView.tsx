import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight } from "lucide-react";
import { OpenNode } from "../components/Mark";
import { useLogPages, useRefs, useRepositoryStatus, type LogFilters } from "../services/queries";
import type { HeadState, LogCommit, LogPage, RefEntry, StatusSnapshot } from "../services/types";
import { rowHeightFor, usePreferences, type Zoom } from "../stores/preferences";
import { useUi } from "../stores/ui";
import { LOOSE_END, commitNode, mapNode, oidOf, useWorkspace, type NodeId } from "../stores/workspace";
import { countChanges } from "../features/changes/changeLabels";
import { GraphCell, MAX_DRAWN_LANES, laneWidthFor } from "../features/history/GraphCell";
import { initialLayoutState, layoutCommits, type GraphRow } from "../features/history/graphLayout";
import { HistoryLayoutCache, type LaidOutHistory } from "../features/history/historyLayout";
import { RefBadges, refsByCommit } from "../features/history/RefBadges";
import { formatAbsolute, formatRelative } from "../features/history/time";
import { CommitFold } from "./CommitFold";
import { condenseHistory } from "./condense";
import { MapFold } from "./MapFold";
import { ReviewStream } from "./ReviewStream";
import { useThreadWindow, type Unfolding, rowTop } from "./threadWindow";
import { useCommitComposer, type CommitComposer } from "./useCommitComposer";

const SEARCH_DEBOUNCE_MS = 300;
/** Loading pages to reveal a commit stops after this many commits. */
export const REVEAL_LIMIT = 20_000;
/** On the map, history is read further ahead so forks and merges have context. */
const MAP_PREFETCH = 3_000;
const LANE = laneWidthFor(0);
/** Content starts at the same x in every row, after the graph column. */
const CONTENT_LEFT = 72;

type ThreadRowModel =
  | { kind: "now"; id: NodeId }
  | { kind: "commit"; id: NodeId; commit: LogCommit; graph: GraphRow | undefined; hidden: number };

/**
 * The thread: the repository as one canvas. The loose end (the working
 * tree) is the open node at the top; commits follow, newest first. Any node
 * unfolds in place. Zoomed out, only branch heads, forks and merges remain.
 */
export function ThreadView({ repositoryId }: { repositoryId: number }) {
  const status = useRepositoryStatus(repositoryId);
  if (status.data === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center text-fg-muted">
        {status.isError ? `Could not read the repository: ${status.error.message}` : "Reading the repository…"}
      </div>
    );
  }
  return <Thread repositoryId={repositoryId} status={status.data} />;
}

function Thread({ repositoryId, status }: { repositoryId: number; status: StatusSnapshot }) {
  const refs = useRefs(repositoryId);
  const zoom: Zoom = usePreferences((state) => state.zoom);
  const rowHeight: number = usePreferences((state) => rowHeightFor(state.personality));
  const search: string = useUi((state) => state.search);
  const focus: NodeId | null = useWorkspace((state) => state.focus);
  const unfolded: NodeId | null = useWorkspace((state) => state.unfolded);
  const setFocus = useWorkspace((state) => state.setFocus);
  const toggleUnfold = useWorkspace((state) => state.toggleUnfold);
  const unfold = useWorkspace((state) => state.unfold);
  const composer: CommitComposer = useCommitComposer(repositoryId, status);
  const container = useRef<HTMLDivElement>(null);
  const summaryInput = useRef<HTMLInputElement>(null);

  const [debounced, setDebounced] = useState<string>(search.trim());
  useEffect(() => {
    const timer: number = window.setTimeout(() => setDebounced(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);
  const searching: boolean = debounced !== "";
  const filters: LogFilters = useMemo(
    () => ({
      revision: null,
      search: searching ? { text: debounced, field: /^[0-9a-f]{4,64}$/i.test(debounced) ? "sha" : "message" } : null,
      since: null,
      until: null,
    }),
    [debounced, searching],
  );
  const log = useLogPages(repositoryId, filters);
  const headOid: string | null = status.branch.oid;
  const head: HeadState | undefined = refs.data?.head;
  const currentBranch: string | null = head?.kind === "branch" ? head.name : status.branch.head;

  // Thread layout: incremental across pages.
  const cache = useRef<HistoryLayoutCache>(new HistoryLayoutCache());
  const history: LaidOutHistory = useMemo(
    () => cache.current.update((log.data?.pages ?? []) as LogPage[], headOid, !searching),
    [log.data, headOid, searching],
  );
  const refMap = useMemo(() => refsByCommit(refs.data?.refs ?? [], head), [refs.data, head]);

  // Map layout: the same loaded history, condensed to heads, forks and merges.
  const mapModel = useMemo(() => {
    if (zoom !== "map" || searching) return null;
    const important: Set<string> = new Set(refMap.keys());
    if (headOid !== null) important.add(headOid);
    const condensed = condenseHistory(history.commits, important);
    const { rows } = layoutCommits(condensed, initialLayoutState(headOid));
    const byOid: Map<string, LogCommit> = new Map(history.commits.map((commit) => [commit.oid, commit]));
    return condensed.map((node, index) => ({
      commit: byOid.get(node.oid) as LogCommit,
      graph: rows[index],
      hidden: node.hidden,
    }));
  }, [zoom, searching, history.commits, refMap, headOid]);

  const rows: ThreadRowModel[] = useMemo(() => {
    const out: ThreadRowModel[] = [{ kind: "now", id: LOOSE_END }];
    if (mapModel !== null) {
      for (const node of mapModel) out.push({ kind: "commit", id: mapNode(node.commit.oid), commit: node.commit, graph: node.graph, hidden: node.hidden });
    } else {
      history.commits.forEach((commit, index) =>
        out.push({ kind: "commit", id: commitNode(commit.oid), commit, graph: searching ? undefined : history.rows[index], hidden: 0 }),
      );
    }
    return out;
  }, [mapModel, history, searching]);

  const indexById: Map<NodeId, number> = useMemo(() => new Map(rows.map((row, index) => [row.id, index])), [rows]);
  const graphLanes: number = Math.min(
    MAX_DRAWN_LANES,
    Math.max(1, mapModel !== null ? Math.max(1, ...mapModel.map((n) => n.graph?.width ?? 1)) : history.maxLanes),
  );
  const graphWidth: number = searching ? 0 : graphLanes * LANE + 12;
  const headIndex: number = headOid === null ? -1 : (indexById.get(zoom === "map" && !searching ? mapNode(headOid) : commitNode(headOid)) ?? -1);
  const headLane: number = headIndex > 0 ? ((rows[headIndex] as Extract<ThreadRowModel, { kind: "commit" }>).graph?.lane ?? 0) : 0;

  // Unfolding geometry.
  const [viewportHint, setViewportHint] = useState<number>(800);
  const [measuredCommitHeight, setMeasuredCommitHeight] = useState<number>(360);
  const unfoldedIndex: number = unfolded === null ? -1 : (indexById.get(unfolded) ?? -1);
  const unfoldedRow: ThreadRowModel | undefined = rows[unfoldedIndex];
  const unfoldHeight: number =
    unfoldedRow === undefined
      ? 0
      : unfoldedRow.kind === "now"
        ? Math.max(360, viewportHint - rowHeight * 2)
        : unfoldedRow.id.startsWith("m:")
          ? Math.min(Math.max(150, 80 + (refMap.get(unfoldedRow.commit.oid)?.length ?? 0) * 64), 420)
          : Math.min(measuredCommitHeight, Math.max(380, viewportHint - rowHeight * 2));
  const unfolding: Unfolding | null = useMemo(
    () => (unfoldedIndex >= 0 ? { after: unfoldedIndex, height: unfoldHeight } : null),
    [unfoldedIndex, unfoldHeight],
  );
  const { start, end, totalHeight, viewport, ensureVisible } = useThreadWindow(container, rows.length, rowHeight, unfolding);
  useEffect(() => setViewportHint(viewport), [viewport]);

  // Fold away a node that no longer exists (e.g. after switching zoom).
  useEffect(() => {
    if (unfolded !== null && unfoldedIndex < 0 && rows.length > 1) unfold(null);
  }, [unfolded, unfoldedIndex, rows.length, unfold]);

  // Keep the focused node in view only when focus or unfold target changes (not on every scroll tick).
  const lastFocus = useRef<NodeId | null>(null);
  const lastUnfolded = useRef<NodeId | null>(null);
  const focusIndex: number = focus === null ? -1 : (indexById.get(focus) ?? -1);
  useEffect(() => {
    if (focus === lastFocus.current && unfolded === lastUnfolded.current) {
      return;
    }
    lastFocus.current = focus;
    lastUnfolded.current = unfolded;
    if (focusIndex >= 0) {
      ensureVisible(focusIndex, focusIndex === unfoldedIndex ? Math.min(unfoldHeight, viewport - rowHeight) : 0);
    }
  }, [focus, unfolded, focusIndex, unfoldedIndex, unfoldHeight, viewport, rowHeight, ensureVisible]);

  // Page in history as the end approaches (further ahead on the map).
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = log;
  const loaded: number = history.commits.length;
  useEffect(() => {
    const wantMore: boolean = end >= rows.length - 60 || (zoom === "map" && !searching && loaded < MAP_PREFETCH);
    if (wantMore && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [end, rows.length, zoom, searching, loaded, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Reveal: page in history until a requested commit is loaded (bounded).
  const [reveal, setReveal] = useState<string | null>(null);
  const [revealFailed, setRevealFailed] = useState<string | null>(null);
  useEffect(() => {
    if (reveal === null) return;
    const node: NodeId = zoom === "map" && !searching ? mapNode(reveal) : commitNode(reveal);
    if (indexById.has(node)) {
      setFocus(node);
      setReveal(null);
    } else if (hasNextPage && loaded < REVEAL_LIMIT) {
      if (!isFetchingNextPage) void fetchNextPage();
    } else if (!log.isFetching) {
      setRevealFailed(reveal);
      setReveal(null);
    }
  }, [reveal, indexById, zoom, searching, hasNextPage, loaded, isFetchingNextPage, fetchNextPage, log.isFetching, setFocus]);

  const goTo = (oid: string): void => {
    setRevealFailed(null);
    if (zoom === "map") usePreferences.getState().setZoom("thread");
    setReveal(oid);
  };

  const counts = countChanges(status.files);
  const dirty: boolean = status.files.length > 0;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Keys inside an unfolded region belong to it.
    if (event.target !== event.currentTarget) {
      if (event.key === "Escape" && unfolded !== null && !event.defaultPrevented) {
        unfold(null);
        container.current?.focus();
        event.preventDefault();
      }
      return;
    }
    const current: number = focusIndex < 0 ? 0 : focusIndex;
    const page: number = Math.max(1, Math.floor(viewport / rowHeight) - 1);
    const move = (index: number): void => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
      if (row !== undefined) setFocus(row.id);
    };
    switch (event.key) {
      case "ArrowDown":
        move(current + 1);
        break;
      case "ArrowUp":
        move(current - 1);
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
        move(rows.length - 1);
        break;
      case "Enter":
      case "ArrowRight":
        if (rows[current] !== undefined && unfolded !== rows[current]?.id) toggleUnfold((rows[current] as ThreadRowModel).id);
        break;
      case "ArrowLeft":
      case "Escape":
        if (unfolded !== null) unfold(null);
        else return;
        break;
      case "c":
        setFocus(LOOSE_END);
        summaryInput.current?.focus();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(searching || revealFailed !== null) && (
        <p role="status" className="shrink-0 py-1.5 pr-5 text-xs text-fg-muted" style={{ paddingLeft: CONTENT_LEFT }}>
          {revealFailed !== null
            ? `Commit ${revealFailed.slice(0, 10)} is not in the history loaded so far (up to ${REVEAL_LIMIT.toLocaleString()} commits).`
            : log.isPending
              ? "Searching…"
              : `${loaded}${log.hasNextPage ? "+" : ""} commit${loaded === 1 ? "" : "s"} match “${debounced}”. Lines are hidden because matches are not connected history.`}
        </p>
      )}
      <div
        ref={container}
        role="tree"
        aria-label={zoom === "map" && !searching ? "Branch map" : "Thread"}
        aria-description="Up and down move along the thread; Enter or right unfolds a node; Escape or left folds it; c writes the next commit."
        tabIndex={0}
        aria-activedescendant={focusIndex >= 0 ? domId(rows[focusIndex] as ThreadRowModel) : undefined}
        onKeyDown={onKeyDown}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none"
      >
        <div style={{ height: totalHeight + (log.hasNextPage ? rowHeight : 0), position: "relative" }}>
          {rows.slice(start, end).map((row, offset) => {
            const index: number = start + offset;
            const top: number = rowTop(index, rowHeight, unfolding);
            if (row.kind === "now") {
              return (
                <NowRow
                  key={row.id}
                  id={domId(row)}
                  top={top}
                  height={rowHeight}
                  lane={headLane}
                  graphWidth={graphWidth}
                  linked={headIndex > 0 && !searching}
                  focused={focus === row.id}
                  unfolded={unfolded === row.id}
                  composer={composer}
                  counts={counts}
                  dirty={dirty}
                  summaryInput={summaryInput}
                  onToggle={() => toggleUnfold(row.id)}
                  onFocusRow={() => setFocus(row.id)}
                />
              );
            }
            return (
              <CommitRow
                key={row.id}
                id={domId(row)}
                top={top}
                height={rowHeight}
                row={row}
                graphWidth={graphWidth}
                head={row.commit.oid === headOid}
                headState={head}
                refs={refMap.get(row.commit.oid)}
                map={zoom === "map" && !searching}
                uncommitted={
                  !searching && headIndex > 0 && index > 0 && index <= headIndex
                    ? { lane: headLane, span: index === headIndex ? "top" : "full" }
                    : undefined
                }
                focused={focus === row.id}
                unfolded={unfolded === row.id}
                onClick={() => toggleUnfold(row.id)}
              />
            );
          })}

          {unfoldedRow !== undefined && unfolding !== null && (
            <div
              role="group"
              aria-label={unfoldedRow.kind === "now" ? "Uncommitted changes" : `Commit ${unfoldedRow.commit.oid.slice(0, 7)} unfolded`}
              style={{ position: "absolute", top: (unfolding.after + 1) * rowHeight, height: unfolding.height, left: 0, right: 0 }}
              className="border-y border-divider bg-surface"
            >
              {/* The thread keeps running past the fold: every lane that passes this point, in its colour. */}
              <FoldLanes row={unfoldedRow} headLane={headLane} />
              {unfoldedRow.kind === "now" ? (
                <ReviewStream repositoryId={repositoryId} status={status} composer={composer} height={unfolding.height} />
              ) : unfoldedRow.id.startsWith("m:") ? (
                <MapFold
                  repositoryId={repositoryId}
                  oid={unfoldedRow.commit.oid}
                  refs={refMap.get(unfoldedRow.commit.oid) ?? []}
                  currentBranch={currentBranch}
                  dirty={dirty}
                  height={unfolding.height}
                />
              ) : (
                <CommitFold
                  repositoryId={repositoryId}
                  oid={oidOf(unfoldedRow.id) as string}
                  refs={refMap.get(unfoldedRow.commit.oid) ?? []}
                  head={head}
                  currentBranch={currentBranch}
                  height={unfolding.height}
                  onGoTo={goTo}
                  onHeightChange={setMeasuredCommitHeight}
                />
              )}
            </div>
          )}

          {log.hasNextPage && (
            <div
              role="status"
              style={{ position: "absolute", top: totalHeight, height: rowHeight, left: CONTENT_LEFT }}
              className="flex items-center text-xs text-fg-muted"
            >
              {log.isFetchingNextPage ? "Reading further back…" : "More history below"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Lanes that continue through an unfolded region (the dashed link for the loose end). */
function FoldLanes({ row, headLane }: { row: ThreadRowModel; headLane: number }) {
  const x = (lane: number): number => 6 + lane * LANE + LANE / 2;
  if (row.kind === "now") {
    return <span aria-hidden className="absolute top-0 bottom-0 border-l border-dashed border-accent" style={{ left: x(headLane) }} />;
  }
  const lanes: Array<{ lane: number; color: number }> = [...(row.graph?.outgoing ?? []), ...(row.graph?.passing ?? [])].filter(
    (line, index, all) => line.lane < MAX_DRAWN_LANES && all.findIndex((other) => other.lane === line.lane) === index,
  );
  return (
    <>
      {lanes.map((line) => (
        <span
          key={line.lane}
          aria-hidden
          className="absolute top-0 bottom-0 w-[1.25px]"
          style={{ left: x(line.lane) - 0.5, background: `var(--rg-lane-${line.color})`, opacity: 0.8 }}
        />
      ))}
    </>
  );
}

function domId(row: ThreadRowModel): string {
  return `node-${row.id.replace(/[^a-z0-9]/gi, "-")}`;
}

interface NowRowProps {
  id: string;
  top: number;
  height: number;
  lane: number;
  graphWidth: number;
  linked: boolean;
  focused: boolean;
  unfolded: boolean;
  composer: CommitComposer;
  counts: ReturnType<typeof countChanges>;
  dirty: boolean;
  summaryInput: React.RefObject<HTMLInputElement | null>;
  onToggle: () => void;
  onFocusRow: () => void;
}

/** The loose end: the working tree as the open node, and the next commit's summary in its own row. */
function NowRow({ id, top, height, lane, graphWidth, linked, focused, unfolded, composer, counts, dirty, summaryInput, onToggle, onFocusRow }: NowRowProps) {
  const cx: number = 6 + lane * LANE + LANE / 2;
  const parts: string[] = [];
  if (counts.conflicted > 0) parts.push(`${counts.conflicted} conflicted`);
  parts.push(`${counts.staged} staged`, `${counts.unstaged} unstaged`, `${counts.untracked} untracked`);
  const summaryText: string = dirty ? parts.join(" · ") : "working tree clean";
  return (
    <div
      id={id}
      role="treeitem"
      aria-level={1}
      aria-expanded={unfolded}
      aria-selected={focused}
      aria-label={`Uncommitted changes: ${summaryText}`}
      style={{ position: "absolute", top, height, left: 0, right: 0 }}
      onClick={(event) => {
        if (!(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLButtonElement)) onToggle();
      }}
      className={`flex cursor-default items-center gap-2 sm:gap-3 pr-3 sm:pr-5 transition-colors duration-100 ${
        focused ? "bg-selection relative before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[2px] before:bg-accent before:rounded-r" : "hover:bg-hover"
      }`}
    >
      <svg aria-hidden width={Math.max(graphWidth, CONTENT_LEFT - 12)} height={height} className="shrink-0" style={{ display: "block" }}>
        {(linked || dirty) && (
          <line x1={cx} y1={height / 2 + 6} x2={cx} y2={height} stroke="var(--rg-accent)" strokeWidth={1.25} strokeDasharray="2 3" />
        )}
        <OpenNode cx={cx} cy={height / 2} r={6} stroke="var(--rg-clay)" width={1.6} />
      </svg>
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3" style={{ marginLeft: Math.max(0, CONTENT_LEFT - 12 - Math.max(graphWidth, CONTENT_LEFT - 12)) }}>
        <ChevronRight
          aria-hidden
          className={`size-3.5 shrink-0 transition-transform duration-150 ${
            unfolded ? "rotate-90 text-accent" : "text-fg-muted/60"
          }`}
        />
        <label className="min-w-0 flex-1">
          <span className="sr-only">Summary of the next commit</span>
          <input
            ref={summaryInput}
            value={composer.draft.summary}
            onFocus={onFocusRow}
            onChange={(event) => composer.update({ summary: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                composer.submit();
              } else if (event.key === "Escape") {
                event.currentTarget.blur();
              }
            }}
            placeholder={dirty ? "Write the next commit…" : "Nothing to commit"}
            className="h-7 w-full bg-transparent font-sans text-xs sm:text-sm font-medium text-fg outline-none placeholder:text-fg-muted/70"
          />
        </label>
        {dirty ? (
          <div className="hidden sm:flex items-center gap-1.5 font-mono text-2xs">
            {counts.conflicted > 0 && (
              <span className="rounded bg-danger/15 border border-danger/25 px-1.5 py-0.5 font-semibold text-danger">
                {counts.conflicted} conflicted
              </span>
            )}
            {counts.staged > 0 && (
              <span className="rounded bg-accent/15 border border-accent/25 px-1.5 py-0.5 font-semibold text-accent">
                {counts.staged} staged
              </span>
            )}
            {counts.unstaged > 0 && (
              <span className="rounded bg-clay/15 border border-clay/25 px-1.5 py-0.5 font-semibold text-clay-text">
                {counts.unstaged} unstaged
              </span>
            )}
            {counts.untracked > 0 && (
              <span className="rounded bg-elevated border border-border px-1.5 py-0.5 text-fg-muted">
                {counts.untracked} untracked
              </span>
            )}
            <span className="sr-only">{summaryText}</span>
          </div>
        ) : (
          <span className="shrink-0 font-sans text-xs text-fg-muted/90">{summaryText}</span>
        )}
        {composer.done !== null && (
          <span role="status" className="shrink-0 font-mono text-xs text-success font-medium">
            committed {composer.done.oid.slice(0, 7)}
          </span>
        )}
        <button
          type="button"
          disabled={!composer.canCommit}
          title={composer.reason ?? "Commit (Ctrl+Enter)"}
          onClick={composer.submit}
          className="h-6.5 shrink-0 rounded-md border border-accent/70 bg-accent/15 px-3 font-sans text-xs font-semibold text-accent transition-all duration-100 hover:bg-accent/25 active:scale-95 disabled:border-border disabled:bg-transparent disabled:text-fg-muted shadow-2xs"
        >
          {composer.draft.amend ? "Amend" : "Commit"}
        </button>
      </div>
    </div>
  );
}

interface CommitRowProps {
  id: string;
  top: number;
  height: number;
  row: Extract<ThreadRowModel, { kind: "commit" }>;
  graphWidth: number;
  head: boolean;
  headState: HeadState | undefined;
  refs: RefEntry[] | undefined;
  map: boolean;
  uncommitted: { lane: number; span: "full" | "top" } | undefined;
  focused: boolean;
  unfolded: boolean;
  onClick: () => void;
}

const CommitRow = memo(function CommitRow({ id, top, height, row, graphWidth, head, headState, refs, map, uncommitted, focused, unfolded, onClick }: CommitRowProps) {
  const { commit } = row;
  const detachedHere: boolean = headState?.kind === "detached" && headState.oid === commit.oid;
  const hasRefs: boolean = detachedHere || (refs !== undefined && refs.length > 0);
  const merge: boolean = commit.parents.length > 1;
  const label: string = [
    commit.summary,
    `by ${commit.authorName}`,
    formatRelative(commit.authorTime),
    commit.oid.slice(0, 7),
    merge ? "merge commit" : "",
    head ? "HEAD" : "",
    (refs ?? []).map((ref) => `${ref.kind === "local" ? "branch" : ref.kind === "remote" ? "remote branch" : "tag"} ${ref.shortName}`).join(", "),
  ]
    .filter((part) => part !== "")
    .join(", ");
  return (
    <div
      id={id}
      role="treeitem"
      aria-level={1}
      aria-expanded={unfolded}
      aria-selected={focused}
      aria-label={label}
      onClick={onClick}
      style={{ position: "absolute", top, height, left: 0, right: 0 }}
      className={`flex cursor-default items-center gap-2 sm:gap-3 pr-3 sm:pr-5 transition-colors duration-100 ${
        focused ? "bg-selection relative before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[2px] before:bg-accent before:rounded-r" : "hover:bg-hover"
      }`}
    >
      <span className="shrink-0 pl-1.5" style={{ width: Math.max(graphWidth, CONTENT_LEFT - 12) }}>
        {row.graph !== undefined && (
          <GraphCell row={row.graph} width={graphWidth} height={height} laneWidth={LANE} head={head} selected={focused} uncommitted={uncommitted} />
        )}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3" style={{ marginLeft: Math.max(0, CONTENT_LEFT - 12 - Math.max(graphWidth, CONTENT_LEFT - 12)) }}>
        <ChevronRight
          aria-hidden
          className={`size-3.5 shrink-0 transition-transform duration-150 ${
            unfolded ? "rotate-90 text-accent" : "text-fg-muted/60"
          }`}
        />
        {hasRefs && <RefBadges refs={refs ?? []} head={headState} detachedHead={detachedHere} max={map ? 4 : 2} />}
        <span className={`truncate text-xs sm:text-sm font-sans font-medium tracking-tight ${map && !hasRefs ? "text-fg-muted" : merge ? "text-fg-secondary" : "text-fg"}`}>{commit.summary}</span>
        {map && row.hidden > 0 && <span className="shrink-0 font-mono text-2xs text-fg-muted">· {row.hidden} commit{row.hidden === 1 ? "" : "s"} below folded</span>}
      </span>
      {!map && (
        <span className="hidden md:inline-block w-28 lg:w-32 shrink-0 truncate text-xs text-fg-muted/90 font-sans" title={commit.authorEmail}>
          {commit.authorName}
        </span>
      )}
      <time dateTime={new Date(commit.authorTime * 1000).toISOString()} title={formatAbsolute(commit.authorTime)} className="w-16 sm:w-20 shrink-0 text-right font-mono text-2xs sm:text-xs text-fg-muted/80 tabular-nums">
        {formatRelative(commit.authorTime)}
      </time>
      <span className={`w-14 shrink-0 font-mono text-2xs sm:text-xs text-right ${focused ? "text-accent font-semibold" : "text-fg-muted/70"}`}>{commit.oid.slice(0, 7)}</span>
    </div>
  );
});
