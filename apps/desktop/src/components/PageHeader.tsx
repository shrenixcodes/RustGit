import type { ReactNode } from "react";
import { RidgeActions } from "../app/Ridge";

interface PageHeaderProps {
  title: string;
  /** Short state summary shown in the ridge before the actions (counts, totals). */
  subtitle?: ReactNode;
  /** Workspace actions, rendered at the right of the ridge. */
  actions?: ReactNode;
  /**
   * Show the title in the content. Only for screens without repository
   * context (Settings, Repositories); repository workspaces are named by the
   * rail and the ridge, so their title is for assistive technology only.
   */
  visible?: boolean;
}

/**
 * Workspace heading. There is no header bar: the ridge already carries the
 * repository context, so the workspace contributes its summary and actions
 * to the ridge and keeps the content area for content.
 */
export function PageHeader({ title, subtitle, actions, visible = false }: PageHeaderProps) {
  return (
    <>
      {visible ? (
        <div className="shrink-0 px-8 pt-8 pb-2">
          <h1 className="text-xl font-medium text-fg">{title}</h1>
        </div>
      ) : (
        <h1 className="sr-only">{title}</h1>
      )}
      {(subtitle !== undefined || actions !== undefined) && (
        <RidgeActions>
          {subtitle !== undefined && <span className="mr-3 truncate font-mono text-xs text-fg-muted">{subtitle}</span>}
          {actions}
        </RidgeActions>
      )}
    </>
  );
}
