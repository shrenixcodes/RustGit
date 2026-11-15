import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, isThemePreference, resolveTheme } from "./theme";

type ChangeListener = () => void;

function stubMatchMedia(initiallyDark: boolean): { setDark: (dark: boolean) => void; listenerCount: () => number } {
  const listeners: Set<ChangeListener> = new Set();
  const media = {
    matches: initiallyDark,
    addEventListener: (_type: string, listener: ChangeListener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: ChangeListener) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => media);
  return {
    setDark: (dark: boolean) => {
      media.matches = dark;
      listeners.forEach((listener: ChangeListener) => listener());
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveTheme", () => {
  it("follows the system for the system preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("uses explicit preferences regardless of the system", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("isThemePreference", () => {
  it("accepts only known values", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("blue")).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
  });
});

describe("applyTheme", () => {
  it("tracks OS changes for the system preference and cleans up", () => {
    const media = stubMatchMedia(false);
    const root: HTMLElement = document.createElement("html");

    const cleanup: () => void = applyTheme("system", root);
    expect(root.dataset.theme).toBe("light");

    media.setDark(true);
    expect(root.dataset.theme).toBe("dark");

    cleanup();
    expect(media.listenerCount()).toBe(0);
  });

  it("does not subscribe for explicit preferences", () => {
    const media = stubMatchMedia(true);
    const root: HTMLElement = document.createElement("html");

    applyTheme("light", root);
    expect(root.dataset.theme).toBe("light");
    expect(media.listenerCount()).toBe(0);
  });
});
