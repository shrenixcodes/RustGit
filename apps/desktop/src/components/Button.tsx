import { forwardRef, type ButtonHTMLAttributes } from "react";
import { formatShortcut } from "../app/shortcuts";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "border border-accent bg-accent text-accent-contrast hover:bg-accent-strong hover:border-accent-strong",
  secondary: "border border-border bg-elevated text-fg hover:border-border-control",
  ghost: "border border-transparent text-fg-secondary hover:bg-hover hover:text-fg",
  danger: "border border-border bg-elevated text-danger hover:border-danger",
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
      className={`rg-control inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-sm font-medium transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-45 ${VARIANT_CLASSES[variant]} ${className}`}
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
      className={`inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted transition-colors duration-100 hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:text-accent ${className}`}
      {...props}
    />
  );
});
