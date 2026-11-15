import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { HeadState, RefEntry, RefList } from "../../services/types";
import { isCurrent } from "./RefBadges";

interface BranchStrandProps {
  refs: RefList | undefined;
  /** Selected revision (a ref's full name), or null for everything. */
  selected: string | null;
  onSelect: (revision: string | null) => void;
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

/**
 * The strand: History's branch-relationship view. Choosing a branch filters
 * the lineage to its ancestry; choosing "all" returns to every ref.
 */
export function BranchStrand({ refs, selected, onSelect }: BranchStrandProps) {
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const head: HeadState | undefined = refs?.head;
  const all: RefEntry[] = refs?.refs ?? [];
  const current: RefEntry | undefined = all.find((ref) => isCurrent(ref, head));
  const locals: RefEntry[] = all
    .filter((ref) => ref.kind === "local" && ref !== current)
    .sort((a, b) => b.lastCommitTime - a.lastCommitTime);
  const remotes: RefEntry[] = all.filter((ref) => ref.kind === "remote").sort((a, b) => a.shortName.localeCompare(b.shortName));
  const tags: RefEntry[] = all.filter((ref) => ref.kind === "tag").sort((a, b) => b.lastCommitTime - a.lastCommitTime);

  const toggleGroup = (group: string): void =>
    setOpenGroups((open) => {
      const next: Set<string> = new Set(open);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  return (
    <nav aria-label="Branches" className="flex min-h-0 flex-1 flex-col overflow-y-auto py-3">
      <StrandItem active={selected === null} onClick={() => onSelect(null)} label="All branches and tags">
        <span className="text-fg-secondary">all</span>
      </StrandItem>
      {head?.kind === "detached" && (
        <StrandItem active={selected === "HEAD"} onClick={() => onSelect("HEAD")} label="Detached HEAD">
          <span className="text-clay-text">HEAD</span>
          <span className="text-fg-muted">{head.oid.slice(0, 7)}</span>
        </StrandItem>
      )}

      {current !== undefined && (
        <Group title="current">
          <BranchItem entry={current} current selected={selected} onSelect={onSelect} />
        </Group>
      )}
      {locals.length > 0 && (
        <Group title={`local ${locals.length}`}>
          {locals.map((ref) => (
            <BranchItem key={ref.fullName} entry={ref} current={false} selected={selected} onSelect={onSelect} />
          ))}
        </Group>
      )}
      {remotes.length > 0 && (
        <Folded title="remotes" count={remotes.length} open={openGroups.has("remotes")} onToggle={() => toggleGroup("remotes")}>
          {remotes.map((ref) => (
            <BranchItem key={ref.fullName} entry={ref} current={false} selected={selected} onSelect={onSelect} />
          ))}
        </Folded>
      )}
      {tags.length > 0 && (
        <Folded title="tags" count={tags.length} open={openGroups.has("tags")} onToggle={() => toggleGroup("tags")}>
          {tags.map((ref) => (
            <BranchItem key={ref.fullName} entry={ref} current={false} selected={selected} onSelect={onSelect} />
          ))}
        </Folded>
      )}
    </nav>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <p className="rg-label px-4 pb-1">{title}</p>
      <ul>{children}</ul>
    </div>
  );
}

function Folded({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-1 px-4 pb-1 font-mono text-xs text-fg-muted hover:text-fg"
      >
        <ChevronRight aria-hidden className={`size-3 transition-transform duration-100 ${open ? "rotate-90" : ""}`} />
        {title} {count}
      </button>
      {open && <ul>{children}</ul>}
    </div>
  );
}

function BranchItem({
  entry,
  current,
  selected,
  onSelect,
}: {
  entry: RefEntry;
  current: boolean;
  selected: string | null;
  onSelect: (revision: string | null) => void;
}) {
  const active: boolean = selected === entry.fullName;
  const relation: string | null = entry.kind === "local" ? upstreamState(entry) : null;
  const tone: string = current ? "text-accent" : entry.kind === "remote" ? "text-indigo-text" : entry.kind === "tag" ? "text-clay-text" : "text-fg";
  return (
    <li>
      <StrandItem
        active={active}
        onClick={() => onSelect(active ? null : entry.fullName)}
        label={`${entry.shortName}${relation === null ? "" : `, ${relation}`}${current ? ", current branch" : ""}`}
        title={entry.lastCommitSummary}
      >
        {current && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />}
        <span className={`min-w-0 flex-1 truncate ${tone}`}>{entry.shortName}</span>
        {relation !== null && (
          <span className={`shrink-0 ${relation === "upstream gone" ? "text-clay-text" : "text-fg-muted"}`}>{relation}</span>
        )}
      </StrandItem>
    </li>
  );
}

function StrandItem({
  active,
  onClick,
  label,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={title}
      onClick={onClick}
      className={`rg-row relative flex w-full items-center gap-2 px-4 text-left font-mono text-xs transition-colors duration-100 ${
        active ? "bg-selection" : "hover:bg-hover"
      }`}
    >
      {active && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 bg-accent" />}
      {children}
    </button>
  );
}
