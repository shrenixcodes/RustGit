import type { RepositoryEntry } from "../../services/types";

/** Case-insensitive match on name or path; every whitespace-separated term must match. */
export function filterRepositories(entries: readonly RepositoryEntry[], query: string): RepositoryEntry[] {
  const terms: string[] = query.toLowerCase().split(/\s+/).filter((term: string) => term.length > 0);
  if (terms.length === 0) {
    return [...entries];
  }
  return entries.filter((entry: RepositoryEntry) => {
    const haystack: string = `${entry.name}\n${entry.path}`.toLowerCase();
    return terms.every((term: string) => haystack.includes(term));
  });
}
