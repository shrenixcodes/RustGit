import { describe, expect, it } from "vitest";
import type { GraphCommit } from "../features/history/graphLayout";
import { condenseHistory } from "./condense";

// Test fixtures only.
const c = (oid: string, ...parents: string[]): GraphCommit => ({ oid, parents });

describe("condenseHistory", () => {
  // main: m3 - m2 - merge(m1, f2) - base - root ; feature: f2 - f1 - base
  const commits: GraphCommit[] = [
    c("m3", "m2"),
    c("m2", "merge"),
    c("merge", "m1", "f2"),
    c("f2", "f1"),
    c("m1", "base"),
    c("f1", "base"),
    c("base", "root"),
    c("root"),
  ];

  it("keeps heads, merges, forks and roots and reconnects them", () => {
    const result = condenseHistory(commits, new Set(["m3"]));
    expect(result.map((x) => x.oid)).toEqual(["m3", "merge", "base", "root"]);
    expect(result.find((x) => x.oid === "m3")).toEqual({ oid: "m3", parents: ["merge"], hidden: 1 });
    // Both merge parents lead back to the fork point "base".
    expect(result.find((x) => x.oid === "merge")).toEqual({ oid: "merge", parents: ["base"], hidden: 3 });
    expect(result.find((x) => x.oid === "base")).toEqual({ oid: "base", parents: ["root"], hidden: 0 });
  });

  it("keeps a branch head even when it is a plain commit", () => {
    const result = condenseHistory(commits, new Set(["m3", "f1"]));
    expect(result.map((x) => x.oid)).toEqual(["m3", "merge", "f1", "base", "root"]);
    expect(result.find((x) => x.oid === "merge")?.parents).toEqual(["base", "f1"]);
  });

  it("drops edges to parents outside the loaded history", () => {
    const partial: GraphCommit[] = [c("a", "b"), c("b", "not-loaded")];
    expect(condenseHistory(partial, new Set(["a"]))).toEqual([{ oid: "a", parents: [], hidden: 0 }]);
  });
});
