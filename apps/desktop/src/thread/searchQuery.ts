import type { LogFilters } from "../services/queries";

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
    } else if (key === "since" && dayStart(value) !== null) since = dayStart(value);
    else if (key === "until" && dayStart(value) !== null) until = (dayStart(value, 1) as number) - 1;
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

/**
 * Local midnight of a YYYY-MM-DD day (plus `addDays`, which keeps "end of
 * day" right across daylight saving changes), in Unix seconds; null if the
 * text is not a real date.
 */
function dayStart(value: string, addDays: number = 0): number | null {
  const match: RegExpMatchArray | null = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date: Date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return Math.floor(new Date(year, month - 1, day + addDays).getTime() / 1000);
}
