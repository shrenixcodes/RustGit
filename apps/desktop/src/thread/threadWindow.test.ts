import { describe, expect, it } from "vitest";
import { computeThreadWindow, rowTop } from "./threadWindow";

describe("thread window", () => {
  it("offsets rows below the unfolded region", () => {
    const unfolding = { after: 2, height: 500 };
    expect(rowTop(2, 30, unfolding)).toBe(60);
    expect(rowTop(3, 30, unfolding)).toBe(90 + 500);
  });

  it("renders only rows near the viewport, with or without an unfolding", () => {
    expect(computeThreadWindow(10_000, 30, null, 30 * 1000, 600, 5)).toEqual({ start: 995, end: 1026 });
    // Scrolled into the middle of the unfolded region below row 0: row 0 stays mounted.
    const inside = computeThreadWindow(10_000, 30, { after: 0, height: 2000 }, 1000, 600, 5);
    expect(inside.start).toBe(0);
    expect(inside.end).toBeLessThan(10);
    // Below the region, indices are shifted back by its height.
    const below = computeThreadWindow(10_000, 30, { after: 0, height: 2000 }, 2030 + 30 * 100, 600, 5);
    expect(below.start).toBe(96);
  });

  it("handles empty threads", () => {
    expect(computeThreadWindow(0, 30, null, 0, 600, 5)).toEqual({ start: 0, end: 0 });
  });
});
