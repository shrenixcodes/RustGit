import { useEffect, useRef } from "react";

/**
 * Shortcut strings use "+"-separated parts: modifiers ("Mod", "Shift", "Alt")
 * followed by one key name as in `KeyboardEvent.key` ("k", "Enter", "F5",
 * "ArrowUp"). "Mod" is Ctrl on Windows/Linux and Cmd on macOS.
 */

export function isMac(platform: string = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /Mac|iPhone|iPad/i.test(platform);
}

export function formatShortcut(shortcut: string, mac: boolean = isMac()): string {
  return shortcut
    .split("+")
    .map((part: string) => {
      switch (part) {
        case "Mod":
          return mac ? "⌘" : "Ctrl";
        case "Alt":
          return mac ? "⌥" : "Alt";
        case "Shift":
          return mac ? "⇧" : "Shift";
        case "ArrowUp":
          return "↑";
        case "ArrowDown":
          return "↓";
        case "ArrowLeft":
          return "←";
        case "ArrowRight":
          return "→";
        case "Escape":
          return "Esc";
        default:
          return part.length === 1 ? part.toUpperCase() : part;
      }
    })
    .join(mac ? "" : "+");
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string, mac: boolean = isMac()): boolean {
  const parts: string[] = shortcut.split("+");
  const key: string = parts[parts.length - 1] ?? "";
  const wantMod: boolean = parts.includes("Mod");
  const wantShift: boolean = parts.includes("Shift");
  const wantAlt: boolean = parts.includes("Alt");
  const modPressed: boolean = mac ? event.metaKey : event.ctrlKey;
  const otherPressed: boolean = mac ? event.ctrlKey : event.metaKey;
  if (modPressed !== wantMod || otherPressed || event.altKey !== wantAlt) {
    return false;
  }
  // Shift changes event.key for symbols ("?"), so only enforce it for letters and named keys.
  if (key.length > 1 || /[a-z]/i.test(key)) {
    if (event.shiftKey !== wantShift) {
      return false;
    }
  }
  return event.key.toLowerCase() === key.toLowerCase();
}

/** True when the event target accepts text, so plain-key shortcuts must not fire. */
export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "range", "submit", "reset"].includes(target.type);
  }
  return false;
}

export interface ShortcutBinding {
  shortcut: string;
  run: () => void;
  /** Fire even while a text field has focus (only for modifier shortcuts). */
  allowInInput?: boolean;
  /** Fire while a modal dialog (sheet, confirmation, credential prompt) is open. */
  allowInDialog?: boolean;
  enabled?: boolean;
}

/** Registers window-level shortcuts. Bindings may change every render without re-subscribing. */
export function useShortcuts(bindings: readonly ShortcutBinding[]): void {
  const latest = useRef<readonly ShortcutBinding[]>(bindings);
  latest.current = bindings;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }
      const inInput: boolean = isTextInput(event.target);
      // Whatever a shortcut opens or runs would happen behind the modal.
      const inDialog: boolean = document.querySelector("dialog[open]") !== null;
      for (const binding of latest.current) {
        if (binding.enabled === false || (inInput && binding.allowInInput !== true) || (inDialog && binding.allowInDialog !== true)) {
          continue;
        }
        if (matchesShortcut(event, binding.shortcut)) {
          event.preventDefault();
          binding.run();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
