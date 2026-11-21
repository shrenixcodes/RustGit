import { describe, expect, it } from "vitest";
import { initialLayoutState, layoutCommits, type GraphCommit, type GraphRow } from "./graphLayout";

// Test fixtures only. Production history comes from the backend log (request R-8).
function c(oid: string, ...parents: string[]): GraphCommit {
  return { oid, parents };
}

function lanes(rows: readonly GraphRow[]): Record<string, number> {
  return Object.fromEntries(rows.map((row: GraphRow) => [row.oid, row.lane]));
}

describe("layoutCommits", () => {
  it("keeps a linear history in one lane", () => {
    const { rows, state } = layoutCommits([c("c", "b"), c("b", "a"), c("a")], initialLayoutState("c"));
    expect(lanes(rows)).toEqual({ c: 0, b: 0, a: 0 });
    expect(rows.map((row) => row.color)).toEqual([0, 0, 0]);
    expect(rows[2]?.root).toBe(true);
    expect(rows[2]?.outgoing).toEqual([]);
    expect(state.lanes).toEqual([]);
  });

  it("opens a lane for a merged branch and closes it at the fork point", () => {
    //   m        main merge of feature
    //   |\
    //   | f2
    //   x |      main-only commit
    //   | f1
    //   |/
    //   base
    const commits: GraphCommit[] = [
      c("m", "x", "f2"),
      c("f2", "f1"),
      c("x", "base"),
      c("f1", "base"),
      c("base"),
    ];
    const { rows } = layoutCommits(commits, initialLayoutState("m"));
    expect(lanes(rows)).toEqual({ m: 0, f2: 1, x: 0, f1: 1, base: 0 });

    const merge = rows[0] as GraphRow;
    expect(merge.merge).toBe(true);
    expect(merge.outgoing.map((line) => line.lane)).toEqual([0, 1]);

    // While the feature lane is open, the main commit "x" sees it pass by.
    expect(rows[2]?.passing.map((line) => line.lane)).toEqual([1]);

    // The feature lane joins main's lane right below f1 (like `|/` in `git log --graph`),
    // so base is reached through a single lane.
    expect(rows[3]?.outgoing.map((line) => line.lane)).toEqual([0]);
    expect(rows[3]?.passing.map((line) => line.lane)).toEqual([0]);
    expect(rows[4]?.incoming.map((line) => line.lane)).toEqual([0]);
    // HEAD's first-parent line keeps color 0; the feature lane gets another color.
    expect(merge.color).toBe(0);
    expect(rows[1]?.color).not.toBe(0);
  });

  it("gives separate branch tips their own lanes", () => {
    const { rows } = layoutCommits([c("main2", "root"), c("topic", "root"), c("root")], initialLayoutState("main2"));
    expect(lanes(rows)).toEqual({ main2: 0, topic: 1, root: 0 });
    expect(rows[1]?.incoming).toEqual([]);
    // topic's line joins the lane already waiting for root.
    expect(rows[1]?.outgoing.map((line) => line.lane)).toEqual([0]);
    expect(rows[2]?.incoming.map((line) => line.lane)).toEqual([0]);
  });

  it("keeps a branch tip newer than HEAD off HEAD's lane", () => {
    // fix branches off main (HEAD) and is newer, so it is listed first.
    const { rows } = layoutCommits([c("fix", "main"), c("main", "base"), c("base")], initialLayoutState("main"));
    expect(lanes(rows)).toEqual({ fix: 1, main: 0, base: 0 });
    // Nothing is drawn in HEAD's lane above HEAD except fix's edge joining it.
    expect(rows[0]?.passing).toEqual([]);
    expect(rows[0]?.outgoing.map((line) => line.lane)).toEqual([0]);
    expect(rows[1]?.incoming.map((line) => line.lane)).toEqual([0]);
    expect(rows[1]?.color).toBe(0);
  });

  it("draws no line above HEAD when no commit joins its lane", () => {
    const { rows } = layoutCommits([c("other", "root"), c("main", "root"), c("root")], initialLayoutState("main"));
    expect(lanes(rows)).toEqual({ other: 1, main: 0, root: 0 });
    expect(rows[0]?.passing).toEqual([]);
    expect(rows[1]?.incoming).toEqual([]);
  });

  it("handles octopus merges", () => {
    const { rows } = layoutCommits(
      [c("o", "a", "b", "d"), c("a", "r"), c("b", "r"), c("d", "r"), c("r")],
      initialLayoutState("o"),
    );
    expect(rows[0]?.outgoing.map((line) => line.lane)).toEqual([0, 1, 2]);
    expect(lanes(rows)).toEqual({ o: 0, a: 0, b: 1, d: 2, r: 0 });
    // b and d each rejoin lane 0, which then carries the single edge into r.
    expect(rows[2]?.outgoing.map((line) => line.lane)).toEqual([0]);
    expect(rows[3]?.outgoing.map((line) => line.lane)).toEqual([0]);
    expect(rows[4]?.incoming.map((line) => line.lane)).toEqual([0]);
  });

  it("joins an existing lane when two children share a first parent", () => {
    const { rows } = layoutCommits([c("x", "p"), c("y", "p"), c("p")], initialLayoutState(null));
    expect(lanes(rows)).toEqual({ x: 0, y: 1, p: 0 });
    // y's lane routes into the lane already waiting for p, then closes.
    expect(rows[1]?.outgoing).toEqual([{ lane: 0, color: rows[0]?.color }]);
  });

  it("produces identical rows when history arrives in pages", () => {
    const commits: GraphCommit[] = [
      c("m2", "m1", "t2"),
      c("t2", "t1"),
      c("m1", "b"),
      c("t1", "b"),
      c("u", "b"),
      c("b", "a"),
      c("a"),
    ];
    const whole = layoutCommits(commits, initialLayoutState("m2")).rows;
    const first = layoutCommits(commits.slice(0, 3), initialLayoutState("m2"));
    const second = layoutCommits(commits.slice(3), first.state);
    expect([...first.rows, ...second.rows]).toEqual(whole);
  });

  it("does not mutate the previous state", () => {
    const start = initialLayoutState("a");
    const { state } = layoutCommits([c("a", "b")], start);
    expect(start.lanes).toEqual(["a"]);
    expect(start.headPending).toBe(true);
    expect(state.lanes).toEqual(["b"]);
  });

  it("lays out ten thousand commits quickly", () => {
    // A long history with a feature branch merged every 10 commits.
    const commits: GraphCommit[] = [];
    for (let index = 0; index < 10_000; index += 1) {
      const next = `m${index + 1}`;
      if (index % 10 === 0) {
        commits.push(c(`m${index}`, next, `f${index}`));
        commits.push(c(`f${index}`, next));
      } else {
        commits.push(c(`m${index}`, next));
      }
    }
    const started: number = performance.now();
    const { rows } = layoutCommits(commits, initialLayoutState("m0"));
    const elapsed: number = performance.now() - started;
    expect(rows).toHaveLength(11_000);
    expect(Math.max(...rows.map((row) => row.width))).toBeLessThanOrEqual(2);
    expect(elapsed).toBeLessThan(500);
  });
});
