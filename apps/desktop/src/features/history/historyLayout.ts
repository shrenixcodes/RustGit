import type { LogCommit, LogPage } from "../../services/types";
import { initialLayoutState, layoutCommits, type GraphRow, type LayoutState } from "./graphLayout";

export interface LaidOutHistory {
  commits: LogCommit[];
  /** Graph rows, aligned with `commits`; empty when the graph is not drawn. */
  rows: GraphRow[];
  indexByOid: ReadonlyMap<string, number>;
  /** Widest row in lanes, for sizing the graph column. */
  maxLanes: number;
}

interface CachedPage {
  page: LogPage;
  rows: GraphRow[];
  /** Layout state after this page, to resume from. */
  state: LayoutState;
  maxLanes: number;
}

/**
 * Lays out paged history incrementally. Leading pages whose objects are
 * unchanged (TanStack Query keeps identity for equal data) are reused with
 * the layout state saved after them, so appending a page lays out only that
 * page and a refetch that changes nothing recomputes nothing.
 */
export class HistoryLayoutCache {
  private pages: CachedPage[] = [];
  private headOid: string | null = null;
  private graph = true;

  update(pages: readonly LogPage[], headOid: string | null, graph: boolean): LaidOutHistory {
    if (headOid !== this.headOid || graph !== this.graph) {
      this.pages = [];
      this.headOid = headOid;
      this.graph = graph;
    }

    let reused = 0;
    while (reused < this.pages.length && reused < pages.length && this.pages[reused]?.page === pages[reused]) {
      reused += 1;
    }
    this.pages.length = reused;

    let state: LayoutState = this.pages[reused - 1]?.state ?? initialLayoutState(headOid);
    for (let index = reused; index < pages.length; index += 1) {
      const page: LogPage = pages[index] as LogPage;
      if (graph) {
        const result = layoutCommits(page.commits, state);
        state = result.state;
        const maxLanes: number = result.rows.reduce((max: number, row: GraphRow) => Math.max(max, row.width), 0);
        this.pages.push({ page, rows: result.rows, state, maxLanes });
      } else {
        this.pages.push({ page, rows: [], state, maxLanes: 0 });
      }
    }

    const commits: LogCommit[] = [];
    const rows: GraphRow[] = [];
    let maxLanes = 0;
    for (const cached of this.pages) {
      commits.push(...cached.page.commits);
      rows.push(...cached.rows);
      maxLanes = Math.max(maxLanes, cached.maxLanes);
    }
    const indexByOid: Map<string, number> = new Map();
    commits.forEach((commit: LogCommit, index: number) => indexByOid.set(commit.oid, index));
    return { commits, rows, indexByOid, maxLanes };
  }
}

/** Commits reachable from `oid` through parents, within the loaded history. */
export function ancestorsOf(oid: string, commits: readonly LogCommit[], indexByOid: ReadonlyMap<string, number>): Set<string> {
  const result: Set<string> = new Set();
  const stack: string[] = [oid];
  while (stack.length > 0) {
    const current: string = stack.pop() as string;
    if (result.has(current)) continue;
    const index: number | undefined = indexByOid.get(current);
    if (index === undefined) continue;
    result.add(current);
    stack.push(...(commits[index]?.parents ?? []));
  }
  return result;
}

/** Commits that have `oid` as an ancestor, within the loaded history. */
export function descendantsOf(oid: string, commits: readonly LogCommit[], indexByOid: ReadonlyMap<string, number>): Set<string> {
  const result: Set<string> = new Set([oid]);
  const start: number | undefined = indexByOid.get(oid);
  if (start === undefined) return new Set();
  // Topological order puts every descendant above its ancestor, so one upward pass suffices.
  for (let index = start - 1; index >= 0; index -= 1) {
    const commit: LogCommit = commits[index] as LogCommit;
    if (commit.parents.some((parent: string) => result.has(parent))) {
      result.add(commit.oid);
    }
  }
  return result;
}

/** The nearest loaded child of `oid` (the row closest above it with `oid` as a parent). */
export function nearestChild(oid: string, commits: readonly LogCommit[], indexByOid: ReadonlyMap<string, number>): string | null {
  const start: number | undefined = indexByOid.get(oid);
  if (start === undefined) return null;
  for (let index = start - 1; index >= 0; index -= 1) {
    if (commits[index]?.parents.includes(oid)) return commits[index]?.oid ?? null;
  }
  return null;
}
