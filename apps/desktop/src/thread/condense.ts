import type { GraphCommit } from "../features/history/graphLayout";

export interface CondensedCommit extends GraphCommit {
  /** Commits folded into the edge(s) below this one, for "n commits" annotations. */
  hidden: number;
}

/**
 * Condenses loaded history for the map: keeps commits that are reference
 * targets, HEAD, merges, forks (two or more loaded children) and roots, and
 * reconnects each kept commit to its nearest kept ancestors. The result is
 * still in topological order, so the lane layout applies unchanged.
 */
export function condenseHistory(commits: readonly GraphCommit[], important: ReadonlySet<string>): CondensedCommit[] {
  const children: Map<string, number> = new Map();
  for (const commit of commits) {
    for (const parent of commit.parents) children.set(parent, (children.get(parent) ?? 0) + 1);
  }
  const keep = (commit: GraphCommit): boolean =>
    important.has(commit.oid) || commit.parents.length !== 1 || (children.get(commit.oid) ?? 0) >= 2;

  // Parents come after children, so a backwards pass resolves every chain once.
  const nearest: Map<string, { oid: string | null; skipped: number }> = new Map();
  const index: Map<string, number> = new Map(commits.map((commit, i) => [commit.oid, i]));
  for (let i = commits.length - 1; i >= 0; i -= 1) {
    const commit: GraphCommit = commits[i] as GraphCommit;
    if (keep(commit)) {
      nearest.set(commit.oid, { oid: commit.oid, skipped: 0 });
    } else {
      // A non-kept commit has exactly one parent.
      const parent: string = commit.parents[0] as string;
      const below = index.has(parent) ? nearest.get(parent) : undefined;
      nearest.set(commit.oid, { oid: below?.oid ?? null, skipped: (below?.skipped ?? 0) + 1 });
    }
  }

  const result: CondensedCommit[] = [];
  for (const commit of commits) {
    if (!keep(commit)) continue;
    const parents: string[] = [];
    let hidden = 0;
    for (const parent of commit.parents) {
      const target = index.has(parent) ? nearest.get(parent) : undefined;
      if (target?.oid == null) continue;
      // Every folded chain counts, even when two chains end at the same kept commit.
      hidden += target.skipped;
      if (!parents.includes(target.oid)) parents.push(target.oid);
    }
    result.push({ oid: commit.oid, parents, hidden });
  }
  return result;
}
