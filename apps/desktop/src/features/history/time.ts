const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

const relative: Intl.RelativeTimeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
const absolute: Intl.DateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** "3 days ago" style time for a Unix-seconds timestamp. */
export function formatRelative(seconds: number, nowMs: number = Date.now()): string {
  const delta: number = seconds - Math.round(nowMs / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(delta) >= size) {
      return relative.format(Math.round(delta / size), unit);
    }
  }
  return "just now";
}

export function formatAbsolute(seconds: number): string {
  return absolute.format(seconds * 1000);
}

/** Start of the local day for a `yyyy-mm-dd` date input value, in Unix seconds. */
export function dayStart(value: string): number | null {
  const date: Date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  // Engines roll impossible days over ("2026-02-30" becomes 2 March): refuse them.
  const [year, month, day] = value.split("-").map(Number);
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return null;
  return Math.floor(date.getTime() / 1000);
}

/** End of the local day for a `yyyy-mm-dd` date input value, in Unix seconds. */
export function dayEnd(value: string): number | null {
  const start: number | null = dayStart(value);
  return start === null ? null : start + 24 * 3600 - 1;
}
