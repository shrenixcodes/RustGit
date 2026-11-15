import { describe, expect, it } from "vitest";
import type { DiffLine, FileDiff } from "../../services/types";
import { buildCanvasRows, changedRange, longestLine, pairChanges } from "./diffModel";

// Test fixtures only; production diffs come from `file_diff`.
function line(kind: DiffLine["kind"], content: string): DiffLine {
  return { kind, content, oldLine: kind === "add" ? null : 1, newLine: kind === "delete" ? null : 1, noNewlineAtEnd: false };
}

function diff(side: "staged" | "unstaged", lines: DiffLine[], extra: Partial<FileDiff> = {}): FileDiff {
  return {
    path: "src/lib.rs",
    originalPath: null,
    side,
    status: "modified",
    binary: false,
    tooLarge: false,
    hunks: [{ header: "@@ -1,3 +1,3 @@", oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines }],
    added: lines.filter((l) => l.kind === "add").length,
    deleted: lines.filter((l) => l.kind === "delete").length,
    ...extra,
  };
}

describe("changedRange", () => {
  it("finds the differing middle of two lines", () => {
    expect(changedRange("let x = 1;", "let x = 42;")).toEqual([
      { start: 8, end: 9 },
      { start: 8, end: 10 },
    ]);
  });

  it("returns null for identical or entirely different lines", () => {
    expect(changedRange("same", "same")).toBeNull();
    expect(changedRange("abc", "xyz")).toBeNull();
  });
});

describe("pairChanges", () => {
  it("pairs each deletion run with the following addition run", () => {
    const lines: DiffLine[] = [line("context", "a"), line("delete", "b"), line("delete", "c"), line("add", "B"), line("context", "d")];
    const pairs = pairChanges(lines);
    expect(pairs.get(1)).toBe(3);
    expect(pairs.get(3)).toBe(1);
    expect(pairs.has(2)).toBe(false);
  });
});

describe("buildCanvasRows", () => {
  const lines: DiffLine[] = [line("context", "fn a() {}"), line("delete", "let x = 1;"), line("add", "let x = 2;"), line("add", "let y = 3;")];

  it("lays out staged then not-staged sections with hunks and word ranges", () => {
    const rows = buildCanvasRows([diff("staged", lines), diff("unstaged", lines)], "unified");
    expect(rows.map((row) => row.kind)).toEqual([
      "section", "hunk", "line", "line", "line", "line",
      "section", "hunk", "line", "line", "line", "line",
    ]);
    const added = rows[4];
    expect(added?.kind === "line" && added.words).toEqual({ start: 8, end: 9 });
    const unpaired = rows[5];
    expect(unpaired?.kind === "line" && unpaired.words).toBeNull();
  });

  it("aligns deletions and additions side by side in split layout", () => {
    const rows = buildCanvasRows([diff("unstaged", lines)], "split").filter((row) => row.kind === "split");
    expect(rows).toHaveLength(3);
    const changed = rows[1];
    expect(changed?.kind === "split" && [changed.left?.line.content, changed.right?.line.content]).toEqual(["let x = 1;", "let x = 2;"]);
    const onlyAdded = rows[2];
    expect(onlyAdded?.kind === "split" && [onlyAdded.left, onlyAdded.right?.line.content]).toEqual([null, "let y = 3;"]);
  });

  it("explains binary and oversized diffs instead of showing lines", () => {
    const rows = buildCanvasRows(
      [diff("staged", [], { binary: true, hunks: [] }), diff("unstaged", [], { tooLarge: true, hunks: [] })],
      "unified",
    );
    expect(rows.filter((row) => row.kind === "note").map((row) => row.kind === "note" && row.text)).toEqual([
      "Binary file: there is no line diff to show.",
      "This diff is larger than 2 MiB or 20 000 lines and is not shown.",
    ]);
  });

  it("measures the longest line", () => {
    expect(longestLine([diff("unstaged", lines)])).toBe(10);
  });
});
