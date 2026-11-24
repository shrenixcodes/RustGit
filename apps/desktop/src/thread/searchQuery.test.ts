import { describe, expect, it } from "vitest";
import { parseThreadSearch } from "./searchQuery";

const localDay = (year: number, month: number, day: number): number => Math.floor(new Date(year, month - 1, day).getTime() / 1000);

describe("parseThreadSearch", () => {
  it("searches messages, or commit ids for a lone hex word", () => {
    expect(parseThreadSearch("fix login")).toEqual({ revision: null, search: { text: "fix login", field: "message" }, since: null, until: null });
    expect(parseThreadSearch("  a1b2c3 ").search).toEqual({ text: "a1b2c3", field: "sha" });
  });

  it("filters by author, dates and branch", () => {
    expect(parseThreadSearch("author:ada since:2026-01-31 until:2026-02-28 branch:feature/x")).toEqual({
      revision: "feature/x",
      search: { text: "ada", field: "author" },
      since: localDay(2026, 1, 31),
      until: localDay(2026, 3, 1) - 1,
    });
  });

  it("keeps the author qualifier in the message text when words are given", () => {
    expect(parseThreadSearch("author:ada fix").search).toEqual({ text: "fix author:ada", field: "message" });
  });

  it("treats unusable qualifiers as plain text", () => {
    const parsed = parseThreadSearch("since:2026-02-30 branch:--all");
    expect(parsed.since).toBeNull();
    expect(parsed.revision).toBeNull();
    expect(parsed.search).toEqual({ text: "since:2026-02-30 branch:--all", field: "message" });
  });

  it("applies date filters alone without a text search", () => {
    const parsed = parseThreadSearch("since:2026-01-01");
    expect(parsed.search).toBeNull();
    expect(parsed.since).toBe(localDay(2026, 1, 1));
  });
});
