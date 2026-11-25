import { describe, expect, it } from "vitest";
import { assemble, conflictCount, hasConflictMarkers, parseConflicts, type BlockResolution } from "./conflicts";

const merge = [
  "fn a() {}\n",
  "<<<<<<< HEAD\n",
  "let x = 1;\n",
  "=======\n",
  "let x = 2;\n",
  ">>>>>>> feature\n",
  "fn b() {}\n",
].join("");

const diff3 = [
  "head\r\n",
  "<<<<<<< ours\r\n",
  "A\r\n",
  "||||||| base\r\n",
  "O\r\n",
  "=======\r\n",
  "B\r\n",
  ">>>>>>> theirs\r\n",
].join("");

const choose = (entries: Array<[number, BlockResolution]>): Map<number, BlockResolution> => new Map(entries);

describe("parseConflicts", () => {
  it("splits text and conflict blocks with labels", () => {
    const segments = parseConflicts(merge);
    expect(segments).toEqual([
      { kind: "text", text: "fn a() {}\n" },
      { kind: "conflict", ours: "let x = 1;\n", base: null, theirs: "let x = 2;\n", oursLabel: "HEAD", baseLabel: null, theirsLabel: "feature" },
      { kind: "text", text: "fn b() {}\n" },
    ]);
  });

  it("reads diff3 base sections and keeps CRLF", () => {
    const [, block] = parseConflicts(diff3);
    expect(block).toEqual({ kind: "conflict", ours: "A\r\n", base: "O\r\n", theirs: "B\r\n", oursLabel: "ours", baseLabel: "base", theirsLabel: "theirs" });
  });

  it("leaves unterminated or look-alike markers as text", () => {
    expect(conflictCount(parseConflicts("<<<<<<< HEAD\nonly ours\n"))).toBe(0);
    expect(conflictCount(parseConflicts("<<<<<<<<< not a marker\n"))).toBe(0);
    expect(parseConflicts("<<<<<<< HEAD\nonly ours\n").map((s) => s.kind === "text" && s.text).join("")).toBe(
      "<<<<<<< HEAD\nonly ours\n",
    );
  });
});

describe("assemble", () => {
  const segments = parseConflicts(merge);

  it("resolves each choice", () => {
    expect(assemble(segments, choose([[0, { choice: "ours", custom: "" }]]))).toBe("fn a() {}\nlet x = 1;\nfn b() {}\n");
    expect(assemble(segments, choose([[0, { choice: "theirs", custom: "" }]]))).toBe("fn a() {}\nlet x = 2;\nfn b() {}\n");
    expect(assemble(segments, choose([[0, { choice: "both", custom: "" }]]))).toBe("fn a() {}\nlet x = 1;\nlet x = 2;\nfn b() {}\n");
    expect(assemble(segments, choose([[0, { choice: "both-reversed", custom: "" }]]))).toBe("fn a() {}\nlet x = 2;\nlet x = 1;\nfn b() {}\n");
    expect(assemble(segments, choose([[0, { choice: "custom", custom: "let x = 3;\n" }]]))).toBe("fn a() {}\nlet x = 3;\nfn b() {}\n");
  });

  it("keeps markers for unresolved blocks so an unfinished result is never clean", () => {
    const result: string = assemble(segments, new Map());
    expect(result).toBe(merge);
    expect(hasConflictMarkers(result)).toBe(true);
  });

  it("round-trips diff3 with CRLF when unresolved", () => {
    expect(assemble(parseConflicts(diff3), new Map())).toBe(diff3);
  });

  it("detects remaining markers", () => {
    expect(hasConflictMarkers("plain\ntext\n")).toBe(false);
  });

  it("detects markers left behind by a partial hand edit", () => {
    expect(hasConflictMarkers("<<<<<<< HEAD\nlet x = 1;\n=======\nlet x = 2;\n")).toBe(true);
    expect(hasConflictMarkers("let x = 2;\n>>>>>>> feature\n")).toBe(true);
    expect(hasConflictMarkers("Title\n=======\n")).toBe(false);
  });
});
