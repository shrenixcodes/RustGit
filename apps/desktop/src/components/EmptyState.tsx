import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

/** Consistent empty state presentation with icon, explanation, and action button. */
export function EmptyState({ icon: Icon, title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-10 px-4 text-center ${className}`}>
      <div className="mb-3.5 flex size-10 items-center justify-center rounded-xl border border-border/80 bg-elevated/60 text-fg-muted shadow-2xs">
        <Icon aria-hidden className="size-5 text-accent" />
      </div>
      <h3 className="text-sm font-semibold tracking-tight text-fg">{title}</h3>
      <p className="mt-1 max-w-sm text-xs text-fg-muted leading-relaxed">{description}</p>
      {action && <div className="mt-4 flex items-center gap-2">{action}</div>}
    </div>
  );
}
