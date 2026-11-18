import { forwardRef, type ButtonHTMLAttributes } from "react";
import { formatShortcut } from "../app/shortcuts";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "border border-accent bg-accent text-accent-contrast shadow-xs hover:bg-accent-strong hover:border-accent-strong active:scale-[0.98] active:brightness-95",
  secondary:
    "border border-border/80 bg-elevated/70 text-fg shadow-2xs hover:border-border-control hover:bg-elevated active:scale-[0.98] active:bg-surface",
  ghost:
    "border border-transparent text-fg-secondary hover:bg-hover hover:text-fg active:scale-[0.98] active:bg-selection",
  danger:
    "border border-danger/30 bg-elevated text-danger shadow-2xs hover:border-danger hover:bg-danger/10 active:scale-[0.98]",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", className = "", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`rg-control inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
});

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> {
  /** Accessible name; also shown as the tooltip. */
  label: string;
  /** Optional shortcut shown in the tooltip, in shortcuts.ts notation ("Mod+I"). */
  shortcut?: string;
  pressed?: boolean;
}

/** Icon-only button. Always has an accessible name and a tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, pressed, className = "", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      title={shortcut === undefined ? label : `${label} (${formatShortcut(shortcut)})`}
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition-all duration-150 hover:bg-hover hover:text-fg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 aria-pressed:bg-selection aria-pressed:text-accent ${className}`}
      {...props}
    />
  );
});
