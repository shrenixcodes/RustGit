import { describe, expect, it } from "vitest";
import { formatShortcut, isTextInput, matchesShortcut } from "./shortcuts";

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("formatShortcut", () => {
  it("uses Ctrl on Windows and symbols on macOS", () => {
    expect(formatShortcut("Mod+K", false)).toBe("Ctrl+K");
    expect(formatShortcut("Mod+Shift+P", true)).toBe("⌘⇧P");
    expect(formatShortcut("Escape", false)).toBe("Esc");
  });
});

describe("matchesShortcut", () => {
  it("matches Mod to Ctrl on Windows and Meta on macOS", () => {
    expect(matchesShortcut(key({ key: "k", ctrlKey: true }), "Mod+K", false)).toBe(true);
    expect(matchesShortcut(key({ key: "k", metaKey: true }), "Mod+K", false)).toBe(false);
    expect(matchesShortcut(key({ key: "k", metaKey: true }), "Mod+K", true)).toBe(true);
  });

  it("requires exact modifiers for letters", () => {
    expect(matchesShortcut(key({ key: "K", ctrlKey: true, shiftKey: true }), "Mod+K", false)).toBe(false);
    expect(matchesShortcut(key({ key: "k" }), "Mod+K", false)).toBe(false);
    expect(matchesShortcut(key({ key: "F5" }), "F5", false)).toBe(true);
  });

  it("ignores Shift for symbol keys", () => {
    expect(matchesShortcut(key({ key: "?", shiftKey: true }), "?", false)).toBe(true);
  });
});

describe("isTextInput", () => {
  it("treats text fields as inputs and buttons as not", () => {
    const text: HTMLInputElement = document.createElement("input");
    const checkbox: HTMLInputElement = document.createElement("input");
    checkbox.type = "checkbox";
    expect(isTextInput(text)).toBe(true);
    expect(isTextInput(checkbox)).toBe(false);
    expect(isTextInput(document.createElement("textarea"))).toBe(true);
    expect(isTextInput(document.createElement("button"))).toBe(false);
  });
});
