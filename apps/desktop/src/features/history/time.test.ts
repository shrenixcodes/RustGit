import { describe, expect, it } from "vitest";
import { formatAbsolute, formatRelative } from "./time";

describe("time formatting cache", () => {
  it("formats relative durations consistently across repeated cached lookups", () => {
    const baseMs = 1_700_000_000_000;
    const oneHourAgo = Math.round(baseMs / 1000) - 3600;
    const first = formatRelative(oneHourAgo, baseMs);
    const second = formatRelative(oneHourAgo - 1, baseMs - 1000);
    expect(first).toBe(second);
    expect(formatRelative(Math.round(baseMs / 1000) - 5, baseMs)).toBe("just now");
  });

  it("returns stable absolute labels across repeated calls", () => {
    const first = formatAbsolute(1_700_000_000);
    const second = formatAbsolute(1_700_000_000);
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });
});
