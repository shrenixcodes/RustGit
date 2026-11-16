import { describe, expect, it } from "vitest";
import { compareSummary } from "./CompareView";
import type { Comparison } from "../../services/types";

const comparison = (ahead: number, behind: number): Comparison => ({ base: "b", head: "h", mergeBase: null, ahead, behind, files: [] });

describe("compareSummary", () => {
  it("states both sides", () => {
    expect(compareSummary(comparison(2, 1), "main", "topic")).toBe("2 commits in topic not in main; 1 commit in main not in topic.");
  });
  it("states identical history", () => {
    expect(compareSummary(comparison(0, 0), "main", "topic")).toBe("topic and main point at the same history.");
  });
  it("omits an empty side", () => {
    expect(compareSummary(comparison(1, 0), "main", "topic")).toBe("1 commit in topic not in main.");
  });
});
