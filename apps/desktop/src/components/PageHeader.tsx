import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header
      style={{ minHeight: "var(--rg-header)" }}
      className="flex shrink-0 items-center gap-3 border-b border-border bg-bg px-3"
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <h1 className="shrink-0 text-base font-semibold">{title}</h1>
        {subtitle !== undefined && <div className="min-w-0 truncate text-sm text-fg-muted">{subtitle}</div>}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  );
}
