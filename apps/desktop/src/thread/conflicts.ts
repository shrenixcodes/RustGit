/**
 * Conflict markers as Git writes them (merge, diff3 and zdiff3 styles):
 *
 *   <<<<<<< ours-label
 *   ours lines
 *   ||||||| base-label        (diff3 / zdiff3 only)
 *   base lines
 *   =======
 *   theirs lines
 *   >>>>>>> theirs-label
 *
 * Text is kept with its own line endings so a resolved file keeps CRLF or LF
 * exactly as Git wrote it.
 */

export type Segment =
  | { kind: "text"; text: string }
  | {
      kind: "conflict";
      ours: string;
      base: string | null;
      theirs: string;
      oursLabel: string;
      baseLabel: string | null;
      theirsLabel: string;
    };

export type Choice = "ours" | "theirs" | "both" | "both-reversed" | "custom";

export interface BlockResolution {
  choice: Choice;
  /** Used when choice is "custom". */
  custom: string;
}

/** Splits text into lines, each keeping its line ending. */
function lines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function marker(line: string, prefix: string): string | null {
  if (!line.startsWith(prefix)) return null;
  const rest: string = line.slice(prefix.length).replace(/\r?\n$/, "");
  return rest === "" || rest.startsWith(" ") ? rest.trim() : null;
}

/** Parses a file with conflict markers. Unterminated markers are left as text. */
export function parseConflicts(text: string): Segment[] {
  const all: string[] = lines(text);
  const segments: Segment[] = [];
  let plain = "";
  let index = 0;
  while (index < all.length) {
    const oursLabel: string | null = marker(all[index] as string, "<<<<<<<");
    if (oursLabel === null) {
      plain += all[index];
      index += 1;
      continue;
    }
    // Find the end of this block; if it is malformed, keep the opening line as text.
    let cursor: number = index + 1;
    let ours = "";
    let base: string | null = null;
    let baseLabel: string | null = null;
    let theirs = "";
    let section: "ours" | "base" | "theirs" = "ours";
    let theirsLabel: string | null = null;
    while (cursor < all.length) {
      const line: string = all[cursor] as string;
      if (section === "ours" && marker(line, "|||||||") !== null) {
        section = "base";
        base = "";
        baseLabel = marker(line, "|||||||");
      } else if (section !== "theirs" && /^=======\r?\n?$/.test(line)) {
        section = "theirs";
      } else if (section === "theirs" && (theirsLabel = marker(line, ">>>>>>>")) !== null) {
        break;
      } else if (section === "ours") ours += line;
      else if (section === "base") base += line;
      else theirs += line;
      cursor += 1;
    }
    if (theirsLabel === null) {
      plain += all[index];
      index += 1;
      continue;
    }
    if (plain !== "") segments.push({ kind: "text", text: plain });
    plain = "";
    segments.push({ kind: "conflict", ours, base, theirs, oursLabel, baseLabel, theirsLabel });
    index = cursor + 1;
  }
  if (plain !== "") segments.push({ kind: "text", text: plain });
  return segments;
}

export function conflictCount(segments: readonly Segment[]): number {
  return segments.filter((segment) => segment.kind === "conflict").length;
}

/** The text a block resolves to for a given choice. */
export function resolveBlock(segment: Extract<Segment, { kind: "conflict" }>, resolution: BlockResolution): string {
  switch (resolution.choice) {
    case "ours":
      return segment.ours;
    case "theirs":
      return segment.theirs;
    case "both":
      return joinBlocks(segment.ours, segment.theirs);
    case "both-reversed":
      return joinBlocks(segment.theirs, segment.ours);
    case "custom":
      return resolution.custom;
  }
}

/** Concatenates two blocks, inserting a line break if the first lacks one. */
function joinBlocks(first: string, second: string): string {
  if (first === "" || second === "") return first + second;
  const eol: string = first.includes("\r\n") || second.includes("\r\n") ? "\r\n" : "\n";
  return first.endsWith("\n") ? first + second : first + eol + second;
}

/**
 * Assembles the result. Blocks without a resolution keep their markers, so
 * an unfinished result can never look resolved.
 */
export function assemble(segments: readonly Segment[], resolutions: ReadonlyMap<number, BlockResolution>): string {
  let out = "";
  let conflictIndex = 0;
  for (const segment of segments) {
    if (segment.kind === "text") {
      out += segment.text;
      continue;
    }
    const resolution: BlockResolution | undefined = resolutions.get(conflictIndex);
    out += resolution === undefined ? rebuildMarkers(segment) : resolveBlock(segment, resolution);
    conflictIndex += 1;
  }
  return out;
}

function rebuildMarkers(segment: Extract<Segment, { kind: "conflict" }>): string {
  const eol: string = /\r\n/.test(segment.ours + segment.theirs) ? "\r\n" : "\n";
  const end = (text: string): string => (text === "" || text.endsWith("\n") ? text : text + eol);
  const label: string = segment.baseLabel === null || segment.baseLabel === "" ? "" : ` ${segment.baseLabel}`;
  const base: string = segment.base === null ? "" : `|||||||${label}${eol}${end(segment.base)}`;
  return `<<<<<<< ${segment.oursLabel}${eol}${end(segment.ours)}${base}=======${eol}${end(segment.theirs)}>>>>>>> ${segment.theirsLabel}${eol}`;
}

/**
 * True when the text still contains conflict markers: a complete block, or a
 * stray opening, base or closing marker left behind by a hand edit. A lone
 * "=======" line is not counted, since it is common in ordinary text.
 */
export function hasConflictMarkers(text: string): boolean {
  if (conflictCount(parseConflicts(text)) > 0) return true;
  return lines(text).some((line) => marker(line, "<<<<<<<") !== null || marker(line, "|||||||") !== null || marker(line, ">>>>>>>") !== null);
}
