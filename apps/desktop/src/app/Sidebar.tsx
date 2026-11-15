import { GitBranch } from "lucide-react";
import { SECTIONS, isSectionEnabled, type SectionDefinition, type SectionId } from "./navigation";
import { useRepositories, useRepositoryStatus } from "../services/queries";
import type { RepositoryEntry } from "../services/types";
import { useWorkspace } from "../stores/workspace";

export function Sidebar() {
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const section: SectionId = useWorkspace((state) => state.section);
  const showSection = useWorkspace((state) => state.showSection);

  return (
    <nav aria-label="Main" className="flex w-52 shrink-0 flex-col border-r border-border bg-sidebar">
      <ActiveRepository repositoryId={activeRepositoryId} />
      <ul className="flex-1 space-y-px overflow-y-auto p-2">
        {SECTIONS.map((definition: SectionDefinition) => {
          const enabled: boolean = isSectionEnabled(definition, activeRepositoryId !== null);
          const current: boolean = definition.id === section;
          const Icon = definition.icon;
          return (
            <li key={definition.id}>
              <button
                type="button"
                disabled={!enabled}
                aria-current={current ? "page" : undefined}
                title={definition.available ? undefined : `${definition.label} is not available yet`}
                onClick={() => showSection(definition.id)}
                className={`flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-base transition-colors ${
                  current ? "bg-selection text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg"
                } disabled:cursor-default disabled:text-fg-muted disabled:opacity-60 disabled:hover:bg-transparent`}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                <span className="flex-1 truncate">{definition.label}</span>
                {!definition.available && <span className="text-xs text-fg-muted">Soon</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ActiveRepository({ repositoryId }: { repositoryId: number | null }) {
  const repositories = useRepositories();
  const status = useRepositoryStatus(repositoryId);
  const repository: RepositoryEntry | undefined = repositories.data?.find(
    (entry: RepositoryEntry) => entry.id === repositoryId,
  );

  return (
    <div className="border-b border-border px-3 py-2.5">
      <p className="truncate font-medium">{repository?.name ?? "No repository open"}</p>
      <p className="flex items-center gap-1 truncate font-mono text-xs text-fg-muted">
        {repository !== undefined && <GitBranch aria-hidden className="size-3 shrink-0" />}
        <span className="truncate">
          {repository === undefined
            ? "Choose one under Repositories"
            : status.data === undefined
              ? "…"
              : (status.data.branch.head ?? "detached HEAD")}
        </span>
      </p>
    </div>
  );
}
