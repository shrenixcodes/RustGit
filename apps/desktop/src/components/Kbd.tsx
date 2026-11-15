import { formatShortcut } from "../app/shortcuts";

/** Renders a keyboard shortcut such as "Mod+K" with the platform's modifier name. */
export function Kbd({ shortcut }: { shortcut: string }) {
  return (
    <kbd className="inline-flex h-4 items-center rounded-xs border border-border bg-canvas px-1 font-mono text-2xs text-fg-muted">
      {formatShortcut(shortcut)}
    </kbd>
  );
}
