import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Consistent empty state presentation with icon, explanation, and action.
 * The icon well sits on a soft gradient halo so the moment reads as an
 * intentional pause rather than a blank screen; the hierarchy is otherwise
 * quiet so nothing competes with the primary action.
 */
export function EmptyState({ icon: Icon, title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`}>
      <div className="relative mb-4">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 rounded-full bg-accent/10 blur-xl"
          style={{ transform: "scale(1.6)" }}
        />
        <div className="flex size-12 items-center justify-center rounded-xl border border-border/70 bg-elevated/80 text-fg-muted shadow-raised">
          <Icon aria-hidden className="size-[22px] text-accent" strokeWidth={1.75} />
        </div>
      </div>
      <h3 className="text-sm font-semibold tracking-tight text-fg">{title}</h3>
      <p className="mt-1.5 max-w-sm text-xs text-fg-muted leading-relaxed">{description}</p>
      {action && <div className="mt-5 flex items-center gap-2">{action}</div>}
    </div>
  );
}
