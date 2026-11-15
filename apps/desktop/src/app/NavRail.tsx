import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { IconButton } from "../components/Button";
import { Kbd } from "../components/Kbd";
import { Splitter } from "../components/Splitter";
import { SECTIONS, isSectionEnabled, type SectionDefinition, type SectionId } from "./navigation";
import { RepositorySwitcher } from "./RepositorySwitcher";
import { usePreferences } from "../stores/preferences";
import { useUi } from "../stores/ui";
import { useWorkspace } from "../stores/workspace";
import { RAIL_COLLAPSE_WIDTH, useWindowWidth } from "./useWindowWidth";

const COLLAPSED_WIDTH = 48;

/** Whether the rail is collapsed, honouring both the preference and narrow windows. */
export function useRailCollapsed(): { collapsed: boolean; narrow: boolean; toggle: () => void } {
  const narrow: boolean = useWindowWidth() < RAIL_COLLAPSE_WIDTH;
  const preferenceCollapsed: boolean = usePreferences((state) => state.railCollapsed);
  const toggleRail = usePreferences((state) => state.toggleRail);
  const narrowExpanded: boolean = useUi((state) => state.narrowRailExpanded);
  const toggleNarrowRail = useUi((state) => state.toggleNarrowRail);
  return {
    collapsed: narrow ? !narrowExpanded : preferenceCollapsed,
    narrow,
    toggle: narrow ? toggleNarrowRail : toggleRail,
  };
}

export function NavRail() {
  const activeRepositoryId: number | null = useWorkspace((state) => state.activeRepositoryId);
  const section: SectionId = useWorkspace((state) => state.section);
  const showSection = useWorkspace((state) => state.showSection);
  const width: number = usePreferences((state) => state.sizes.rail);
  const { collapsed, toggle } = useRailCollapsed();
  const railSections: SectionDefinition[] = SECTIONS.filter((definition) => definition.inRail);

  return (
    <>
      <nav
        aria-label="Main"
        style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
        className="flex shrink-0 flex-col bg-sidebar"
      >
        <RepositorySwitcher collapsed={collapsed} />
        <ul className="flex-1 space-y-px overflow-y-auto overflow-x-hidden p-1.5">
          {railSections.map((definition: SectionDefinition) => {
            const enabled: boolean = isSectionEnabled(definition, activeRepositoryId !== null);
            const current: boolean = definition.id === section;
            const Icon = definition.icon;
            const reason: string | undefined = !definition.available
              ? definition.unavailableReason
              : !enabled
                ? "Open a repository first"
                : undefined;
            return (
              <li key={definition.id} className={definition.id === "settings" ? "mt-2 border-t border-divider pt-2" : ""}>
                <button
                  type="button"
                  disabled={!enabled}
                  aria-current={current ? "page" : undefined}
                  aria-label={collapsed ? definition.label : undefined}
                  title={reason ?? (collapsed ? definition.label : undefined)}
                  onClick={() => showSection(definition.id)}
                  className={`group relative flex h-7 w-full items-center gap-2.5 rounded-sm text-left transition-colors duration-100 ${
                    collapsed ? "justify-center" : "px-2"
                  } ${
                    current ? "bg-selection text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg"
                  } disabled:cursor-default disabled:text-fg-muted disabled:opacity-55 disabled:hover:bg-transparent`}
                >
                  {current && (
                    <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />
                  )}
                  <Icon aria-hidden className={`size-4 shrink-0 ${current ? "text-accent" : ""}`} />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate">{definition.label}</span>
                      {!definition.available && <span className="rg-label">Soon</span>}
                      {enabled && definition.shortcut !== undefined && (
                        <span aria-hidden className="opacity-0 transition-opacity duration-100 group-hover:opacity-100">
                          <Kbd shortcut={definition.shortcut} />
                        </span>
                      )}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className={`flex border-t border-border p-1.5 ${collapsed ? "justify-center" : "justify-end"}`}>
          <IconButton label={collapsed ? "Expand sidebar" : "Collapse sidebar"} shortcut="Mod+B" onClick={toggle}>
            {collapsed ? (
              <PanelLeftOpen aria-hidden className="size-4" />
            ) : (
              <PanelLeftClose aria-hidden className="size-4" />
            )}
          </IconButton>
        </div>
      </nav>
      {collapsed ? <div aria-hidden className="w-px shrink-0 bg-border" /> : <Splitter panel="rail" label="Resize sidebar" grows="right" />}
    </>
  );
}
