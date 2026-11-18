import { formatShortcut } from "../app/shortcuts";

/** Renders a keyboard shortcut such as "Mod+K" with the platform's modifier name. */
export function Kbd({ shortcut }: { shortcut: string }) {
  return (
    <kbd className="inline-flex h-4.5 items-center rounded border border-border/70 bg-canvas/80 px-1.5 font-mono text-2xs font-medium text-fg-muted shadow-2xs">
      {formatShortcut(shortcut)}
    </kbd>
  );
}
