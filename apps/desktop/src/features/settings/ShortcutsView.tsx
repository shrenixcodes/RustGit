import { useMemo, useState } from "react";
import { Keyboard, Search } from "lucide-react";
import { Input } from "../../components/Input";
import { Kbd } from "../../components/Kbd";
import { PageHeader } from "../../components/PageHeader";
import { SHORTCUT_GROUPS, type ShortcutEntry, type ShortcutGroup } from "../../app/shortcutReference";

/** Every keyboard shortcut, grouped by where it applies ("?"). */
export function ShortcutsView() {
  const [filter, setFilter] = useState("");

  const filteredGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return SHORTCUT_GROUPS;
    return SHORTCUT_GROUPS.map((group) => {
      const entries = group.entries.filter(
        (entry) =>
          entry.action.toLowerCase().includes(q) ||
          entry.keys.toLowerCase().includes(q) ||
          group.title.toLowerCase().includes(q),
      );
      return { ...group, entries };
    }).filter((group) => group.entries.length > 0);
  }, [filter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-8 pt-6 pb-2">
        <PageHeader title="Keyboard shortcuts" visible />
        <div className="w-56">
          <Input
            icon={<Search className="size-3.5" />}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search shortcuts…"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        <div className="grid max-w-4xl gap-4 md:grid-cols-2">
          {filteredGroups.map((group: ShortcutGroup) => (
            <section
              key={group.title}
              aria-label={group.title}
              className="rounded-xl border border-border/80 bg-elevated/40 p-4 shadow-2xs space-y-3"
            >
              <div>
                <h3 className="text-xs font-semibold tracking-tight text-fg flex items-center gap-2">
                  <Keyboard className="size-3.5 text-accent" />
                  <span>{group.title}</span>
                </h3>
                <p className="mt-0.5 text-2xs text-fg-muted">{group.scope}</p>
              </div>
              <dl className="space-y-1.5 pt-1">
                {group.entries.map((entry: ShortcutEntry) => (
                  <div
                    key={`${entry.keys}-${entry.action}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-canvas/40 px-3 py-1.5 text-xs transition-colors hover:bg-canvas/70"
                  >
                    <dd className="min-w-0 flex-1 truncate text-fg-secondary text-2xs sm:text-xs">{entry.action}</dd>
                    <dt className="shrink-0">
                      <KeyList keys={entry.keys} />
                    </dt>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function KeyList({ keys }: { keys: string }) {
  const alternatives: string[] = keys.split(" / ");
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {alternatives.map((key: string, index: number) => (
        <span key={key} className="inline-flex items-center gap-1">
          {index > 0 && <span className="text-fg-muted font-mono text-2xs">/</span>}
          <Kbd shortcut={key} />
        </span>
      ))}
    </span>
  );
}
