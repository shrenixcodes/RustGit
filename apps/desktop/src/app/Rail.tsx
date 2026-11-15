import { Layers2 } from "lucide-react";
import { Mark } from "../components/Mark";
import { SECTIONS, isSectionEnabled, type SectionDefinition, type SectionId } from "./navigation";
import { formatShortcut } from "./shortcuts";
import { usePreferences, type Personality } from "../stores/preferences";
import { useWorkspace } from "../stores/workspace";

/**
 * Navigation rail: 48 px, icons only, tooltips with shortcuts. It carries
 * no repository data (that lives in the ridge), so it never needs labels.
 */
export function Rail() {
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const section: SectionId = useWorkspace((state) => state.section);
  const showSection = useWorkspace((state) => state.showSection);
  const personality: Personality = usePreferences((state) => state.personality);
  const togglePersonality = usePreferences((state) => state.togglePersonality);
  const workspaces: SectionDefinition[] = SECTIONS.filter((definition) => definition.inRail && definition.id !== "settings");
  const settings: SectionDefinition = SECTIONS.find((definition) => definition.id === "settings") as SectionDefinition;

  return (
    <nav aria-label="Main" className="flex w-12 shrink-0 flex-col items-center border-r border-divider bg-sidebar py-3">
      <div title="RustGit" className="mb-4 flex size-8 items-center justify-center">
        <Mark size={22} />
      </div>
      <ul className="flex flex-1 flex-col items-center gap-1">
        {workspaces.map((definition: SectionDefinition) => (
          <li key={definition.id}>
            <RailButton
              definition={definition}
              current={definition.id === section}
              enabled={isSectionEnabled(definition, activeRepositoryId !== null)}
              hasRepository={activeRepositoryId !== null}
              onSelect={showSection}
            />
          </li>
        ))}
      </ul>
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          aria-label="Deep workspace"
          aria-pressed={personality === "deep"}
          title={`${personality === "deep" ? "Deep workspace: on" : "Deep workspace: off"} (${formatShortcut("Mod+Shift+D")})`}
          onClick={togglePersonality}
          className="flex size-8 items-center justify-center rounded-sm text-fg-muted transition-colors duration-100 hover:bg-hover hover:text-fg aria-pressed:text-accent"
        >
          <Layers2 aria-hidden className="size-4" strokeWidth={1.5} />
        </button>
        <RailButton
          definition={settings}
          current={section === "settings"}
          enabled
          hasRepository={activeRepositoryId !== null}
          onSelect={showSection}
        />
      </div>
    </nav>
  );
}

interface RailButtonProps {
  definition: SectionDefinition;
  current: boolean;
  enabled: boolean;
  hasRepository: boolean;
  onSelect: (section: SectionId) => void;
}

function RailButton({ definition, current, enabled, hasRepository, onSelect }: RailButtonProps) {
  const Icon = definition.icon;
  const reason: string | undefined = !definition.available
    ? definition.unavailableReason
    : !hasRepository && definition.repositoryScoped
      ? "Open a repository first"
      : undefined;
  const tooltip: string =
    reason !== undefined
      ? `${definition.label}: ${reason}`
      : definition.shortcut === undefined
        ? definition.label
        : `${definition.label} (${formatShortcut(definition.shortcut)})`;
  return (
    <button
      type="button"
      disabled={!enabled}
      aria-label={definition.label}
      aria-current={current ? "page" : undefined}
      title={tooltip}
      onClick={() => onSelect(definition.id)}
      className={`relative flex size-8 items-center justify-center rounded-sm transition-colors duration-100 ${
        current ? "text-accent" : "text-fg-muted hover:bg-hover hover:text-fg"
      } disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-fg-muted`}
    >
      {current && <span aria-hidden className="absolute -left-2 inset-y-1.5 w-0.5 rounded-full bg-accent" />}
      <Icon aria-hidden className="size-4" strokeWidth={1.5} />
    </button>
  );
}
