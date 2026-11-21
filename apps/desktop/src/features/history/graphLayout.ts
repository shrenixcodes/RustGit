/**
 * Commit graph lane layout.
 *
 * Input: commits in an order where every child precedes its parents (what
 * `git log --topo-order` and `--date-order` guarantee). One commit per row.
 * Each lane holds the commit id it expects next; a single sweep assigns
 * every commit a lane, so layout is O(rows × lanes) and incremental: the
 * returned state continues the layout when the next page of history arrives,
 * without touching rows that are already laid out.
 *
 * Lanes are never shifted sideways to compact the graph. That keeps every
 * existing row stable when more history loads.
 */

export interface GraphCommit {
  oid: string;
  /** First parent first, as Git reports them. */
  parents: readonly string[];
}

export interface LaneLine {
  lane: number;
  color: number;
}

export interface GraphRow {
  oid: string;
  lane: number;
  color: number;
  /** True when the commit has more than one parent. */
  merge: boolean;
  /** True when no parent will follow (root commit or parents outside the walk). */
  root: boolean;
  /** Lanes entering the node from the row above (children). */
  incoming: LaneLine[];
  /** Lanes leaving the node toward the row below (parents), including its own lane. */
  outgoing: LaneLine[];
  /** Lanes that pass this row vertically without touching the node. */
  passing: LaneLine[];
  /** Number of lane columns this row needs (for width). */
  width: number;
}

export interface LayoutState {
  /** Commit id each lane expects next; null for a free lane. */
  lanes: Array<string | null>;
  colors: number[];
  /** Commits on the first-parent chain of `headOid`, which keep color 0. */
  headChain: Set<string>;
  nextColor: number;
  /**
   * Lane 0 is held for HEAD from the start so newer branch tips (unmerged
   * branches, the loose end's siblings) never sit on HEAD's line. Until a
   * commit's edge actually enters it, the held lane draws nothing.
   */
  headPending: boolean;
}

/** Number of distinct lane colors (`--rg-lane-0` … `--rg-lane-5`); 0 is reserved for HEAD's line. */
export const LANE_COLORS = 6;

export function initialLayoutState(headOid: string | null): LayoutState {
  return {
    lanes: headOid === null ? [] : [headOid],
    colors: headOid === null ? [] : [0],
    headChain: new Set(headOid === null ? [] : [headOid]),
    nextColor: 1,
    headPending: headOid !== null,
  };
}

function copyState(state: LayoutState): LayoutState {
  return {
    lanes: [...state.lanes],
    colors: [...state.colors],
    headChain: new Set(state.headChain),
    nextColor: state.nextColor,
    headPending: state.headPending,
  };
}

function allocateLane(state: LayoutState, oid: string, avoid: number): number {
  let index: number = state.lanes.findIndex((value, lane) => value === null && lane !== avoid);
  if (index < 0) {
    index = state.lanes.length;
    state.lanes.push(null);
    state.colors.push(0);
  }
  state.lanes[index] = oid;
  if (state.headChain.has(oid)) {
    state.colors[index] = 0;
  } else {
    state.colors[index] = state.nextColor;
    state.nextColor = (state.nextColor % (LANE_COLORS - 1)) + 1;
  }
  return index;
}

function trimTrailing(state: LayoutState): void {
  while (state.lanes.length > 0 && state.lanes[state.lanes.length - 1] === null) {
    state.lanes.pop();
    state.colors.pop();
  }
}

/** Lays out `commits`, continuing from `previous` (which is not modified). */
export function layoutCommits(
  commits: readonly GraphCommit[],
  previous: LayoutState,
): { rows: GraphRow[]; state: LayoutState } {
  const state: LayoutState = copyState(previous);
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    const before: Array<string | null> = [...state.lanes];
    const beforeColors: number[] = [...state.colors];
    // The held HEAD lane has no edge above HEAD unless a commit joined it.
    const heldLane: number = state.headPending ? 0 : -1;

    // The commit's lane: the first lane that expects it, or a new one (a branch tip).
    let lane: number = state.lanes.indexOf(commit.oid);
    if (lane < 0) {
      lane = allocateLane(state, commit.oid, -1);
    }
    if (state.headChain.has(commit.oid)) {
      state.colors[lane] = 0;
      const firstParent: string | undefined = commit.parents[0];
      if (firstParent !== undefined) {
        state.headChain.add(firstParent);
      }
    }
    const color: number = state.colors[lane] ?? 0;

    // Children in other lanes converge here; those lanes end at this row.
    const incoming: LaneLine[] = [];
    before.forEach((expected, index) => {
      if (expected === commit.oid && index !== heldLane) {
        incoming.push({ lane: index, color: beforeColors[index] ?? 0 });
        if (index !== lane) {
          state.lanes[index] = null;
        }
      }
    });

    // First parent continues in this lane; other parents join or open lanes.
    const outgoing: LaneLine[] = [];
    if (lane === heldLane) {
      state.headPending = false;
    }
    const [firstParent, ...otherParents] = commit.parents;
    if (firstParent === undefined) {
      state.lanes[lane] = null;
    } else {
      const existing: number = state.lanes.indexOf(firstParent);
      // HEAD's first-parent line keeps its lane; other lines converge into it at the parent.
      const keepLane: boolean = state.headChain.has(commit.oid) && lane < existing;
      if (existing >= 0 && existing !== lane && !keepLane) {
        // Another lane already waits for this parent: join it and free ours.
        state.lanes[lane] = null;
        outgoing.push({ lane: existing, color: state.colors[existing] ?? 0 });
        if (existing === heldLane) state.headPending = false;
      } else {
        state.lanes[lane] = firstParent;
        outgoing.push({ lane, color });
      }
    }
    for (const parent of otherParents) {
      const existing: number = state.lanes.indexOf(parent);
      const target: number = existing >= 0 ? existing : allocateLane(state, parent, lane);
      outgoing.push({ lane: target, color: state.colors[target] ?? 0 });
      if (target === heldLane) state.headPending = false;
    }

    // Lanes that neither end nor start here pass straight through.
    const passing: LaneLine[] = [];
    before.forEach((expected, index) => {
      if (expected !== null && expected !== commit.oid && state.lanes[index] === expected && index !== heldLane) {
        passing.push({ lane: index, color: beforeColors[index] ?? 0 });
      }
    });

    const width: number = Math.max(before.length, state.lanes.length, lane + 1);
    trimTrailing(state);
    rows.push({
      oid: commit.oid,
      lane,
      color,
      merge: commit.parents.length > 1,
      root: commit.parents.length === 0,
      incoming,
      outgoing,
      passing,
      width,
    });
  }

  return { rows, state };
}
