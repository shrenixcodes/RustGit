import { describe, expect, it } from "vitest";
import type { LogCommit, LogPage } from "../../services/types";
import { initialLayoutState, layoutCommits } from "./graphLayout";
import { HistoryLayoutCache, ancestorsOf, descendantsOf, nearestChild } from "./historyLayout";

// Test fixtures only; production history comes from `log_page`.
function commit(oid: string, ...parents: string[]): LogCommit {
  return { oid, parents, summary: oid, authorName: "A", authorEmail: "a@x", authorTime: 0, committerTime: 0 };
}

const all: LogCommit[] = [
  commit("m2", "m1", "t2"),
  commit("t2", "t1"),
  commit("m1", "b"),
  commit("t1", "b"),
  commit("b", "a"),
  commit("a"),
];
const page1: LogPage = { commits: all.slice(0, 3), hasMore: true };
const page2: LogPage = { commits: all.slice(3), hasMore: false };

describe("HistoryLayoutCache", () => {
  it("matches a whole-history layout when pages arrive one by one", () => {
    const cache = new HistoryLayoutCache();
    cache.update([page1], "m2", true);
    const result = cache.update([page1, page2], "m2", true);
    expect(result.rows).toEqual(layoutCommits(all, initialLayoutState("m2")).rows);
    expect(result.commits.map((c) => c.oid)).toEqual(all.map((c) => c.oid));
    expect(result.indexByOid.get("t1")).toBe(3);
    expect(result.maxLanes).toBe(2);
  });

  it("reuses unchanged pages and relays out from the first changed page", () => {
    const cache = new HistoryLayoutCache();
    const first = cache.update([page1, page2], "m2", true);
    const changedPage2: LogPage = { commits: [...page2.commits], hasMore: false };
    const second = cache.update([page1, changedPage2], "m2", true);
    // Rows of the reused first page are the same objects.
    expect(second.rows[0]).toBe(first.rows[0]);
    expect(second.rows).toEqual(first.rows);
  });

  it("starts over when HEAD moves", () => {
    const cache = new HistoryLayoutCache();
    const first = cache.update([page1, page2], "m2", true);
    const moved = cache.update([page1, page2], "t2", true);
    expect(moved.rows[0]).not.toBe(first.rows[0]);
    expect(moved.rows[1]?.color).toBe(0);
  });

  it("skips the graph for search results", () => {
    const result = new HistoryLayoutCache().update([page1], "m2", false);
    expect(result.rows).toEqual([]);
    expect(result.commits).toHaveLength(3);
  });
});

describe("ancestry", () => {
  const { indexByOid } = new HistoryLayoutCache().update([page1, page2], "m2", true);

  it("finds loaded ancestors through every parent", () => {
    expect([...ancestorsOf("m2", all, indexByOid)].sort()).toEqual(["a", "b", "m1", "m2", "t1", "t2"]);
    expect([...ancestorsOf("t1", all, indexByOid)].sort()).toEqual(["a", "b", "t1"]);
  });

  it("finds loaded descendants", () => {
    expect([...descendantsOf("t1", all, indexByOid)].sort()).toEqual(["m2", "t1", "t2"]);
    expect([...descendantsOf("a", all, indexByOid)]).toHaveLength(6);
  });

  it("finds the nearest child", () => {
    expect(nearestChild("b", all, indexByOid)).toBe("t1");
    expect(nearestChild("m2", all, indexByOid)).toBeNull();
  });
});
