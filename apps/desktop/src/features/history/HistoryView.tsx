import { useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft, RefreshCw, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button, IconButton } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { Splitter } from "../../components/Splitter";
import { useShortcuts } from "../../app/shortcuts";
import { PageHeader } from "../../components/PageHeader";
import { InspectorToggle, WorkspaceLayout } from "../../app/WorkspaceLayout";
import { useLogPages, useRefs, useRepositoryStatus, type LogFilters } from "../../services/queries";
import type { LogPage, LogSearchField } from "../../services/types";
import { usePreferences } from "../../stores/preferences";
import { useWorkspace } from "../../stores/workspace";
import { BranchStrand } from "./BranchStrand";
import { CommitInspector } from "./CommitInspector";
import { CommitList, type FocusMode } from "./CommitList";
import { HistoryLayoutCache, type LaidOutHistory } from "./historyLayout";
import { refsByCommit } from "./RefBadges";
import { dayEnd, dayStart } from "./time";

const SEARCH_DEBOUNCE_MS = 300;
/** Loading pages to reveal a commit stops after this many commits. */
export const REVEAL_LIMIT = 20_000;

const SEARCH_FIELDS: ReadonlyArray<{ value: LogSearchField; label: string }> = [
  { value: "message", label: "Message" },
  { value: "author", label: "Author" },
  { value: "sha", label: "Commit id" },
];

export function HistoryView({ repositoryId }: { repositoryId: number }) {
  const status = useRepositoryStatus(repositoryId);
  const refs = useRefs(repositoryId);
  const selected: string | null = useWorkspace((state) => state.selectedCommit);
  const selectCommit = useWorkspace((state) => state.selectCommit);

  const [revision, setRevision] = useState<string | null>(null);
  const [searchField, setSearchField] = useState<LogSearchField>("message");
  const [searchText, setSearchText] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [since, setSince] = useState<string>("");
  const [until, setUntil] = useState<string>("");
  const [focusMode, setFocusMode] = useState<FocusMode>("none");
  const [reveal, setReveal] = useState<string | null>(null);

  useEffect(() => {
    const timer: number = window.setTimeout(() => setDebouncedSearch(searchText.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const filters: LogFilters = useMemo(
    () => ({
      revision,
      search: debouncedSearch === "" ? null : { text: debouncedSearch, field: searchField },
      since: since === "" ? null : dayStart(since),
      until: until === "" ? null : dayEnd(until),
    }),
    [revision, debouncedSearch, searchField, since, until],
  );
  const searching: boolean = filters.search !== null;

  const log = useLogPages(repositoryId, filters);
  const headOid: string | null = status.data?.branch.oid ?? null;
  const cache = useRef<HistoryLayoutCache>(new HistoryLayoutCache());
  const history: LaidOutHistory = useMemo(
    () => cache.current.update((log.data?.pages ?? []) as LogPage[], headOid, !searching),
    [log.data, headOid, searching],
  );
  const refMap = useMemo(() => refsByCommit(refs.data?.refs ?? [], refs.data?.head), [refs.data]);
  const zoom = usePreferences((state) => state.historyZoom);
  const zoomHistory = usePreferences((state) => state.zoomHistory);
  const strandOpen: boolean = usePreferences((state) => state.strandOpen);
  const toggleStrand = usePreferences((state) => state.toggleStrand);
  const strandWidth: number = usePreferences((state) => state.sizes.strand);
  useShortcuts([
    { shortcut: "Mod+=", run: () => zoomHistory(1) },
    { shortcut: "Mod+-", run: () => zoomHistory(-1) },
    { shortcut: "Mod+0", run: () => zoomHistory(0) },
  ]);

  // Reveal: page in history until the requested commit is loaded (bounded).
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = log;
  const loaded: number = history.commits.length;
  const [revealFailed, setRevealFailed] = useState<string | null>(null);
  useEffect(() => {
    if (reveal === null) return;
    if (history.indexByOid.has(reveal)) {
      selectCommit(reveal);
      setReveal(null);
    } else if (hasNextPage && loaded < REVEAL_LIMIT) {
      if (!isFetchingNextPage) void fetchNextPage();
    } else if (!log.isFetching) {
      setRevealFailed(reveal);
      setReveal(null);
    }
  }, [reveal, history.indexByOid, hasNextPage, isFetchingNextPage, fetchNextPage, loaded, log.isFetching, selectCommit]);

  const revealCommit = (oid: string): void => {
    setRevealFailed(null);
    if (history.indexByOid.has(oid)) selectCommit(oid);
    else setReveal(oid);
  };

  const showInGraph = (oid: string): void => {
    setSearchText("");
    setDebouncedSearch("");
    setRevealFailed(null);
    setReveal(oid);
  };

  const filtered: boolean = revision !== null || searching || since !== "" || until !== "";
  const clearFilters = (): void => {
    setRevision(null);
    setSearchText("");
    setDebouncedSearch("");
    setSince("");
    setUntil("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="History"
        subtitle={
          log.data === undefined
            ? undefined
            : `${searching ? `${loaded} matching` : `${loaded} commits`}${log.hasNextPage ? " loaded" : ""}`
        }
        actions={
          <>
            <IconButton label="Zoom out" shortcut="Mod+-" onClick={() => zoomHistory(-1)} disabled={zoom === -1}>
              <ZoomOut aria-hidden className="size-3.5" />
            </IconButton>
            <IconButton label="Zoom in" shortcut="Mod+=" onClick={() => zoomHistory(1)} disabled={zoom === 1}>
              <ZoomIn aria-hidden className="size-3.5" />
            </IconButton>
            <Button variant="ghost" onClick={() => void log.refetch()} disabled={log.isFetching}>
              <RefreshCw aria-hidden className={`size-3.5 ${log.isFetching ? "motion-safe:animate-spin" : ""}`} />
              Refresh
            </Button>
            <InspectorToggle />
          </>
        }
      />

      <WorkspaceLayout
        inspector={
          selected === null ? null : (
            <CommitInspector
              repositoryId={repositoryId}
              oid={selected}
              refs={refMap.get(selected) ?? []}
              head={refs.data?.head}
              onSelectCommit={revealCommit}
              onShowInGraph={searching ? showInGraph : null}
            />
          )
        }
      >
        <div className="flex min-h-0 flex-1">
          {strandOpen && (
            <>
              <aside aria-label="Branch strand" style={{ width: strandWidth }} className="flex shrink-0 flex-col bg-surface">
                <BranchStrand refs={refs.data} selected={revision} onSelect={setRevision} />
              </aside>
              <Splitter panel="strand" label="Resize branch strand" grows="right" />
            </>
          )}

          <section aria-label="Lineage" className="flex min-w-0 flex-1 flex-col">
            <div role="toolbar" aria-label="History filters" className="flex h-11 shrink-0 items-center gap-3 px-4">
              <IconButton
                label={strandOpen ? "Hide branch strand" : "Show branch strand"}
                pressed={strandOpen}
                onClick={toggleStrand}
              >
                <PanelLeft aria-hidden className="size-3.5" />
              </IconButton>
              <div className="flex min-w-0 flex-1 items-center gap-2 border-b border-border focus-within:border-accent">
                <Search aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
                <input
                  type="search"
                  aria-label="Search commits"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && searchText !== "") {
                      event.stopPropagation();
                      setSearchText("");
                    }
                  }}
                  placeholder={searchField === "sha" ? "commit id prefix (4+ characters)" : "search the lineage"}
                  className="rg-control min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-muted"
                />
                <select
                  aria-label="Search in"
                  value={searchField}
                  onChange={(event) => setSearchField(event.target.value as LogSearchField)}
                  className="rg-control bg-transparent font-mono text-xs text-fg-muted"
                >
                  {SEARCH_FIELDS.map((field) => (
                    <option key={field.value} value={field.value}>
                      {field.label.toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-1.5 font-mono text-xs text-fg-muted">
                from
                <input type="date" value={since} max={until || undefined} onChange={(e) => setSince(e.target.value)} className="rg-control bg-transparent text-xs text-fg" />
              </label>
              <label className="flex items-center gap-1.5 font-mono text-xs text-fg-muted">
                to
                <input type="date" value={until} min={since || undefined} onChange={(e) => setUntil(e.target.value)} className="rg-control bg-transparent text-xs text-fg" />
              </label>
              <label className="flex items-center gap-1.5 font-mono text-xs text-fg-muted">
                focus
                <select
                  value={focusMode}
                  disabled={searching || selected === null}
                  title={searching ? "Focus is available on the graph, not on search results" : selected === null ? "Select a commit first" : undefined}
                  onChange={(event) => setFocusMode(event.target.value as FocusMode)}
                  className="rg-control bg-transparent text-xs text-fg disabled:opacity-45"
                >
                  <option value="none">none</option>
                  <option value="ancestors">ancestors</option>
                  <option value="descendants">descendants</option>
                </select>
              </label>
              {filtered && (
                <IconButton label="Clear filters" onClick={clearFilters}>
                  <X aria-hidden className="size-3.5" />
                </IconButton>
              )}
            </div>

            {searching && log.data !== undefined && (
              <p role="status" className="shrink-0 px-5 pb-2 text-xs text-fg-muted">
                Commits matching “{filters.search?.text}”. The graph is hidden because matches are not connected history;
                “Show in graph” in the inspector places a commit in its lineage.
              </p>
            )}
            {revealFailed !== null && (
              <p role="status" className="shrink-0 px-5 pb-2 text-xs text-clay-text">
                Commit {revealFailed.slice(0, 10)} is not in the {filtered ? "filtered " : ""}history loaded so far (up to{" "}
                {REVEAL_LIMIT.toLocaleString()} commits).
              </p>
            )}
            {log.isPending && <p className="rg-canvas flex-1 p-5 text-fg-muted">Reading history…</p>}
            {log.isError && (
              <div className="p-3">
                <ErrorNotice title="Could not read history" error={log.error} />
              </div>
            )}
            {log.data !== undefined && (
              <CommitList
                history={history}
                graph={!searching}
                headOid={headOid}
                head={refs.data?.head}
                refMap={refMap}
                selected={selected}
                focusMode={searching ? "none" : focusMode}
                onSelect={revealCommit}
                hasMore={log.hasNextPage}
                loadingMore={log.isFetchingNextPage}
                onLoadMore={() => void log.fetchNextPage()}
                emptyText={
                  searching
                    ? `No commits match “${filters.search?.text}”.`
                    : filtered
                      ? "No commits in this range."
                      : "No commits yet."
                }
              />
            )}
          </section>
        </div>
      </WorkspaceLayout>
    </div>
  );
}
