import { Kbd } from "../../components/Kbd";
import { PageHeader } from "../../components/PageHeader";
import { SHORTCUT_GROUPS, type ShortcutEntry, type ShortcutGroup } from "../../app/shortcutReference";

/** Every keyboard shortcut, grouped by where it applies ("?"). */
export function ShortcutsView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Keyboard shortcuts" visible />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6">
        <div className="grid max-w-3xl gap-8 md:grid-cols-2">
          {SHORTCUT_GROUPS.map((group: ShortcutGroup) => (
            <section key={group.title} aria-label={group.title}>
              <h3 className="text-sm font-medium">{group.title}</h3>
              <p className="mb-2 text-xs text-fg-muted">{group.scope}</p>
              <dl className="space-y-1">
                {group.entries.map((entry: ShortcutEntry) => (
                  <div key={`${entry.keys}-${entry.action}`} className="flex items-baseline gap-3 text-sm">
                    <dt className="w-44 shrink-0">
                      <KeyList keys={entry.keys} />
                    </dt>
                    <dd className="text-fg-secondary">{entry.action}</dd>
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
          {index > 0 && <span className="text-fg-muted">/</span>}
          <Kbd shortcut={key} />
        </span>
      ))}
    </span>
  );
}
