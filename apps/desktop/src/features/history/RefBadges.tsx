import { memo } from "react";
import { Cloud, GitBranch, Tag } from "lucide-react";
import type { HeadState, RefEntry } from "../../services/types";

/** Groups references by the commit they point at, current branch first. */
export function refsByCommit(refs: readonly RefEntry[], head: HeadState | undefined): Map<string, RefEntry[]> {
  const order = (ref: RefEntry): number => {
    if (isCurrent(ref, head)) return 0;
    return ref.kind === "local" ? 1 : ref.kind === "remote" ? 2 : 3;
  };
  const map: Map<string, RefEntry[]> = new Map();
  for (const ref of [...refs].sort((a, b) => order(a) - order(b) || a.shortName.localeCompare(b.shortName))) {
    const list: RefEntry[] | undefined = map.get(ref.oid);
    if (list === undefined) map.set(ref.oid, [ref]);
    else list.push(ref);
  }
  return map;
}

export function isCurrent(ref: RefEntry, head: HeadState | undefined): boolean {
  return head?.kind === "branch" && ref.kind === "local" && ref.shortName === head.name;
}

const KIND_LABEL: Record<RefEntry["kind"], string> = { local: "branch", remote: "remote branch", tag: "tag" };

export function describeRef(ref: RefEntry, current: boolean): string {
  return `${current ? "current branch" : KIND_LABEL[ref.kind]} ${ref.shortName}`;
}

interface RefBadgesProps {
  refs: readonly RefEntry[];
  head: HeadState | undefined;
  /** True when HEAD is detached at this commit. */
  detachedHead: boolean;
  max?: number;
}

/**
 * Reference labels as quiet mono text with a glyph (no pills): sage for the
 * current branch, secondary for local branches, indigo for remote branches,
 * clay for tags and a detached HEAD. The glyph and the accessible text carry
 * the kind as well as the colour.
 */
export const RefBadges = memo(function RefBadges({ refs, head, detachedHead, max = 2 }: RefBadgesProps) {
  const shown: RefEntry[] = refs.slice(0, max);
  const hidden: RefEntry[] = refs.slice(max);
  return (
    <span className="flex shrink-0 items-center gap-2.5 font-mono text-xs">
      {detachedHead && (
        <span title="HEAD is detached at this commit" className="text-clay-text">
          HEAD
        </span>
      )}
      {shown.map((ref: RefEntry) => (
        <Label key={ref.fullName} entry={ref} current={isCurrent(ref, head)} />
      ))}
      {hidden.length > 0 && (
        <span title={hidden.map((ref) => describeRef(ref, false)).join("\n")} className="text-fg-muted">
          +{hidden.length}
        </span>
      )}
    </span>
  );
});

function Label({ entry, current }: { entry: RefEntry; current: boolean }) {
  const label: string = describeRef(entry, current);
  const tone: string = current
    ? "font-medium text-accent"
    : entry.kind === "local"
      ? "text-fg-secondary"
      : entry.kind === "remote"
        ? "text-indigo-text"
        : "text-clay-text";
  const Icon = entry.kind === "remote" ? Cloud : entry.kind === "tag" ? Tag : GitBranch;
  return (
    <span title={current ? `HEAD → ${entry.shortName}` : label} className={`flex max-w-48 items-center gap-1 ${tone}`}>
      <Icon aria-hidden className="size-3 shrink-0" strokeWidth={1.75} />
      <span className="sr-only">{label}</span>
      <span aria-hidden className={`truncate ${current ? "underline decoration-1 underline-offset-[3px]" : ""}`}>
        {entry.shortName}
      </span>
    </span>
  );
}

/** Relationship of a local branch to its upstream, in words where Git provides them. */
export function upstreamState(ref: RefEntry): string {
  if (ref.upstream === null) return "no upstream";
  if (ref.upstreamGone) return "upstream gone";
  const parts: string[] = [];
  if ((ref.ahead ?? 0) > 0) parts.push(`${ref.ahead}↑`);
  if ((ref.behind ?? 0) > 0) parts.push(`${ref.behind}↓`);
  return parts.length === 0 ? "in sync" : parts.join(" ");
}
