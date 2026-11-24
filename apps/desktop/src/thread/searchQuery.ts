import type { LogFilters } from "../services/queries";
import { dayEnd, dayStart } from "../features/history/time";

/**
 * Thread search text to log filters. Plain words search commit messages (a
 * lone hexadecimal word of 4+ characters is a commit id). Qualifiers narrow
 * the history the backend already knows how to filter:
 *
 *   author:ada          commits whose author name or email matches
 *   since:2026-01-31    on or after that day (local time)
 *   until:2026-02-28    on or before that day (local time)
 *   branch:feature/x    history of that branch, tag or commit only
 *
 * Git searches one field at a time, so `author:` applies only when no plain
 * words are given; with plain words it stays part of the message text. A
 * qualifier with an unusable value (an invalid date) is plain text too.
 */
export function parseThreadSearch(text: string): LogFilters {
  const words: string[] = text.trim().split(/\s+/).filter((word) => word !== "");
  let author: string | null = null;
  let authorWord: string = "";
  let since: number | null = null;
  let until: number | null = null;
  let revision: string | null = null;
  const plain: string[] = [];

  for (const word of words) {
    const match: RegExpMatchArray | null = /^(author|since|until|branch):(.+)$/i.exec(word);
    const key: string | undefined = match?.[1]?.toLowerCase();
    const value: string = match?.[2] ?? "";
    if (key === "author") {
      author = value;
      authorWord = word;
    } else if (key === "since" && day(value, false) !== null) since = day(value, false);
    else if (key === "until" && day(value, true) !== null) until = day(value, true);
    else if (key === "branch" && !value.startsWith("-")) revision = value;
    else plain.push(word);
  }

  let search: LogFilters["search"] = null;
  if (plain.length > 0) {
    const message: string = (author === null ? plain : [...plain, authorWord]).join(" ");
    search = { text: message, field: /^[0-9a-f]{4,64}$/i.test(message) ? "sha" : "message" };
  } else if (author !== null) {
    search = { text: author, field: "author" };
  }
  return { revision, search, since, until };
}

/** A `YYYY-MM-DD` value as the history date helpers read it; null if it is not a real date. */
function day(value: string, end: boolean): number | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? (end ? dayEnd(value) : dayStart(value)) : null;
}
