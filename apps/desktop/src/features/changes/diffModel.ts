import type { DiffHunk, DiffLine, FileDiff, WorkingDiffSide } from "../../services/types";

/** Changed character range within a line, for word-level emphasis. */
export interface WordRange {
  start: number;
  end: number;
}

export interface LineRef {
  lineIndex: number;
  line: DiffLine;
  words: WordRange | null;
}

export type CanvasRow =
  | { kind: "section"; side: WorkingDiffSide; added: number; deleted: number }
  | { kind: "note"; side: WorkingDiffSide; text: string }
  | { kind: "hunk"; side: WorkingDiffSide; hunkIndex: number; hunk: DiffHunk }
  | ({ kind: "line"; side: WorkingDiffSide; hunkIndex: number } & LineRef)
  | { kind: "split"; side: WorkingDiffSide; hunkIndex: number; left: LineRef | null; right: LineRef | null };

export type DiffLayout = "unified" | "split";

/** Lines longer than this are not compared word by word. */
const WORD_DIFF_LIMIT = 400;

/**
 * Character range that differs between two lines: everything between their
 * common prefix and common suffix. Null when the lines are identical or too
 * long, or when one side is entirely different (then emphasis adds nothing).
 */
export function changedRange(a: string, b: string): [WordRange, WordRange] | null {
  if (a === b || a.length > WORD_DIFF_LIMIT || b.length > WORD_DIFF_LIMIT) return null;
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (prefix === 0 && suffix === 0) return null;
  return [
    { start: prefix, end: a.length - suffix },
    { start: prefix, end: b.length - suffix },
  ];
}

/**
 * Pairs each run of deletions with the run of additions that follows it,
 * which is how Git presents a modified block. Returns, per line index, the
 * index of its partner (or undefined).
 */
export function pairChanges(lines: readonly DiffLine[]): Map<number, number> {
  const partner: Map<number, number> = new Map();
  let index = 0;
  while (index < lines.length) {
    if (lines[index]?.kind !== "delete") {
      index += 1;
      continue;
    }
    const deletes: number[] = [];
    while (lines[index]?.kind === "delete") deletes.push(index++);
    const adds: number[] = [];
    while (lines[index]?.kind === "add") adds.push(index++);
    for (let k = 0; k < Math.min(deletes.length, adds.length); k += 1) {
      partner.set(deletes[k] as number, adds[k] as number);
      partner.set(adds[k] as number, deletes[k] as number);
    }
  }
  return partner;
}

function lineRefs(hunk: DiffHunk): LineRef[] {
  const partner: Map<number, number> = pairChanges(hunk.lines);
  return hunk.lines.map((line: DiffLine, lineIndex: number) => {
    const other: number | undefined = partner.get(lineIndex);
    let words: WordRange | null = null;
    if (other !== undefined) {
      const otherLine: DiffLine = hunk.lines[other] as DiffLine;
      const ranges = line.kind === "delete" ? changedRange(line.content, otherLine.content) : changedRange(otherLine.content, line.content);
      if (ranges !== null) words = line.kind === "delete" ? ranges[0] : ranges[1];
    }
    return { lineIndex, line, words };
  });
}

function splitRows(side: WorkingDiffSide, hunkIndex: number, refs: readonly LineRef[]): CanvasRow[] {
  const rows: CanvasRow[] = [];
  let index = 0;
  while (index < refs.length) {
    const ref: LineRef = refs[index] as LineRef;
    if (ref.line.kind === "context") {
      rows.push({ kind: "split", side, hunkIndex, left: ref, right: ref });
      index += 1;
      continue;
    }
    const deletes: LineRef[] = [];
    while (refs[index]?.line.kind === "delete") deletes.push(refs[index++] as LineRef);
    const adds: LineRef[] = [];
    while (refs[index]?.line.kind === "add") adds.push(refs[index++] as LineRef);
    for (let k = 0; k < Math.max(deletes.length, adds.length); k += 1) {
      rows.push({ kind: "split", side, hunkIndex, left: deletes[k] ?? null, right: adds[k] ?? null });
    }
  }
  return rows;
}

/** Builds the canvas rows for the staged and not-staged diffs of one file. */
export function buildCanvasRows(diffs: ReadonlyArray<FileDiff>, layout: DiffLayout): CanvasRow[] {
  const rows: CanvasRow[] = [];
  for (const diff of diffs) {
    const side = diff.side as WorkingDiffSide;
    rows.push({ kind: "section", side, added: diff.added, deleted: diff.deleted });
    if (diff.binary) {
      rows.push({ kind: "note", side, text: "Binary file: there is no line diff to show." });
      continue;
    }
    if (diff.tooLarge) {
      rows.push({ kind: "note", side, text: "This diff is larger than 2 MiB or 20 000 lines and is not shown." });
      continue;
    }
    if (diff.hunks.length === 0) {
      rows.push({ kind: "note", side, text: "No line changes (for example a mode change or an empty file)." });
      continue;
    }
    diff.hunks.forEach((hunk: DiffHunk, hunkIndex: number) => {
      rows.push({ kind: "hunk", side, hunkIndex, hunk });
      const refs: LineRef[] = lineRefs(hunk);
      if (layout === "split") rows.push(...splitRows(side, hunkIndex, refs));
      else for (const ref of refs) rows.push({ kind: "line", side, hunkIndex, ...ref });
    });
  }
  return rows;
}

/**
 * Longest line, in characters, for sizing the horizontally scrollable canvas.
 * Tabs count as `tabSize` characters, matching how they are rendered.
 */
export function longestLine(diffs: ReadonlyArray<FileDiff>, tabSize: number = 1): number {
  let longest = 0;
  for (const diff of diffs) {
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        let tabs = 0;
        if (tabSize > 1) for (const char of line.content) if (char === "\t") tabs += 1;
        longest = Math.max(longest, line.content.length + tabs * (tabSize - 1));
      }
    }
  }
  return longest;
}
