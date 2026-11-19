import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  action?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon, action, className = "", ...props },
  ref,
) {
  return (
    <div className={`group relative flex h-8 items-center gap-2 rounded-lg border border-border/80 bg-canvas/70 px-2.5 shadow-2xs transition-all duration-150 hover:border-border-control focus-within:border-accent focus-within:bg-canvas focus-within:ring-2 focus-within:ring-accent/35 ${className}`}>
      {icon && <span className="shrink-0 text-fg-muted transition-colors group-focus-within:text-accent">{icon}</span>}
      <input
        ref={ref}
        className="h-full min-w-0 flex-1 bg-transparent font-sans text-xs text-fg placeholder:text-fg-muted/70 outline-none disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      />
      {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
    </div>
  );
});
