import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { Button, IconButton } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { PageHeader } from "../../components/PageHeader";
import { InspectorToggle, WorkspaceLayout } from "../../app/WorkspaceLayout";
import { useLogPages, useRefs, useRepositoryStatus, type LogFilters } from "../../services/queries";
import type { LogPage, LogSearchField, RefEntry } from "../../services/types";
import { useWorkspace } from "../../stores/workspace";
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
  const branchRefs: RefEntry[] = (refs.data?.refs ?? []).filter((ref: RefEntry) => ref.kind !== "tag");

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
          log.data === undefined ? undefined : (
            <span className="font-mono tabular-nums">
              {searching ? `${loaded} matching` : `${loaded} commits`}
              {log.hasNextPage ? " loaded" : ""}
            </span>
          )
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => void log.refetch()} disabled={log.isFetching}>
              <RefreshCw aria-hidden className={`size-3.5 ${log.isFetching ? "motion-safe:animate-spin" : ""}`} />
              Refresh
            </Button>
            <InspectorToggle />
          </>
        }
      />

      <div role="toolbar" aria-label="History filters" className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-bg px-3">
        <label className="flex items-center gap-1.5">
          <span className="rg-label">Refs</span>
          <select
            value={revision ?? ""}
            onChange={(event) => setRevision(event.target.value === "" ? null : event.target.value)}
            className="rg-control max-w-44 rounded-sm border border-border bg-elevated px-1.5 font-mono text-xs text-fg"
          >
            <option value="">All refs</option>
            <option value="HEAD">HEAD</option>
            {branchRefs.map((ref: RefEntry) => (
              <option key={ref.fullName} value={ref.fullName}>
                {ref.shortName}
              </option>
            ))}
          </select>
        </label>

        <div className="flex min-w-0 flex-1 items-center gap-0 rounded-sm border border-border bg-elevated focus-within:border-accent">
          <select
            aria-label="Search in"
            value={searchField}
            onChange={(event) => setSearchField(event.target.value as LogSearchField)}
            className="rg-control rounded-l-sm border-r border-border bg-transparent px-1.5 text-xs text-fg-secondary"
          >
            {SEARCH_FIELDS.map((field) => (
              <option key={field.value} value={field.value}>
                {field.label}
              </option>
            ))}
          </select>
          <Search aria-hidden className="ml-2 size-3.5 shrink-0 text-fg-muted" />
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
            placeholder={searchField === "sha" ? "Commit id prefix (4+ characters)" : "Search commits"}
            className="rg-control min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-fg-muted"
          />
        </div>

        <label className="flex items-center gap-1">
          <span className="rg-label">From</span>
          <input type="date" value={since} max={until || undefined} onChange={(e) => setSince(e.target.value)} className="rg-control rounded-sm border border-border bg-elevated px-1 font-mono text-xs text-fg [color-scheme:inherit]" />
        </label>
        <label className="flex items-center gap-1">
          <span className="rg-label">To</span>
          <input type="date" value={until} min={since || undefined} onChange={(e) => setUntil(e.target.value)} className="rg-control rounded-sm border border-border bg-elevated px-1 font-mono text-xs text-fg [color-scheme:inherit]" />
        </label>

        <label className="flex items-center gap-1.5">
          <span className="rg-label">Focus</span>
          <select
            value={focusMode}
            disabled={searching || selected === null}
            title={searching ? "Focus is available on the graph, not on search results" : selected === null ? "Select a commit first" : undefined}
            onChange={(event) => setFocusMode(event.target.value as FocusMode)}
            className="rg-control rounded-sm border border-border bg-elevated px-1.5 text-xs text-fg disabled:opacity-45"
          >
            <option value="none">None</option>
            <option value="ancestors">Ancestors</option>
            <option value="descendants">Descendants</option>
          </select>
        </label>

        {filtered && (
          <IconButton label="Clear filters" onClick={clearFilters}>
            <X aria-hidden className="size-3.5" />
          </IconButton>
        )}
      </div>

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
        <div className="flex min-h-0 flex-1 flex-col">
          {searching && log.data !== undefined && (
            <p role="status" className="shrink-0 border-b border-divider bg-surface px-3 py-1 text-xs text-fg-muted">
              Showing commits matching “{filters.search?.text}”. The graph is hidden because matches are not connected
              history; use “Show in graph” in the inspector to see a commit in context.
            </p>
          )}
          {revealFailed !== null && (
            <p role="status" className="shrink-0 border-b border-divider bg-surface px-3 py-1 text-xs text-amber">
              Commit {revealFailed.slice(0, 10)} is not in the {filtered ? "filtered " : ""}history loaded so far (up to{" "}
              {REVEAL_LIMIT.toLocaleString()} commits).
            </p>
          )}
          {log.isPending && <p className="rg-grid flex-1 p-4 text-fg-muted">Reading history…</p>}
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
        </div>
      </WorkspaceLayout>
    </div>
  );
}
