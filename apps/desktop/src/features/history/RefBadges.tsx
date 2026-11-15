import { memo } from "react";
import { Cloud, GitBranch, Tag } from "lucide-react";
import type { HeadState, RefEntry } from "../../services/types";

/** Groups references by the commit they point at, current branch first. */
export function refsByCommit(refs: readonly RefEntry[], head: HeadState | undefined): Map<string, RefEntry[]> {
  const order = (ref: RefEntry): number => {
    if (head?.kind === "branch" && ref.kind === "local" && ref.shortName === head.name) return 0;
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
 * Reference labels. Local branches are solid, remote branches outlined with
 * a cloud, tags amber; the current branch is filled cyan. Shapes and icons
 * distinguish them as well as color.
 */
export const RefBadges = memo(function RefBadges({ refs, head, detachedHead, max = 3 }: RefBadgesProps) {
  const shown: RefEntry[] = refs.slice(0, max);
  const hidden: RefEntry[] = refs.slice(max);
  return (
    <span className="flex shrink-0 items-center gap-1">
      {detachedHead && (
        <span
          title="HEAD is detached at this commit"
          className="rounded-xs border border-amber px-1 font-mono text-2xs leading-4 font-semibold text-amber"
        >
          HEAD
        </span>
      )}
      {shown.map((ref: RefEntry) => {
        const current: boolean = head?.kind === "branch" && ref.kind === "local" && ref.shortName === head.name;
        return <Badge key={ref.fullName} entry={ref} current={current} />;
      })}
      {hidden.length > 0 && (
        <span
          title={hidden.map((ref) => describeRef(ref, false)).join("\n")}
          className="rounded-xs border border-border px-1 font-mono text-2xs leading-4 text-fg-muted"
        >
          +{hidden.length}
        </span>
      )}
    </span>
  );
});

function Badge({ entry, current }: { entry: RefEntry; current: boolean }) {
  const label: string = describeRef(entry, current);
  if (current) {
    return (
      <span
        title={`HEAD → ${entry.shortName}`}
        className="flex max-w-48 items-center gap-0.5 rounded-xs bg-accent px-1 font-mono text-2xs leading-4 font-semibold text-accent-contrast"
      >
        <GitBranch aria-hidden className="size-2.5 shrink-0" />
        <span className="sr-only">{label}</span>
        <span aria-hidden className="truncate">{entry.shortName}</span>
      </span>
    );
  }
  const style: string =
    entry.kind === "local"
      ? "border-accent/60 bg-selection text-accent"
      : entry.kind === "remote"
        ? "border-lavender/50 text-lavender"
        : "border-amber/60 text-amber";
  const Icon = entry.kind === "local" ? GitBranch : entry.kind === "remote" ? Cloud : Tag;
  return (
    <span title={label} className={`flex max-w-48 items-center gap-0.5 rounded-xs border px-1 font-mono text-2xs leading-4 ${style}`}>
      <Icon aria-hidden className="size-2.5 shrink-0" />
      <span className="sr-only">{label}</span>
      <span aria-hidden className="truncate">{entry.shortName}</span>
    </span>
  );
}
