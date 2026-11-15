import { beforeEach, describe, expect, it } from "vitest";
import { PANEL_LIMITS, applyPreferences, clampSize, usePreferences } from "./preferences";

beforeEach(() => {
  localStorage.clear();
});

describe("preferences", () => {
  it("clamps panel sizes to their limits", () => {
    expect(clampSize("inspector", 10)).toBe(PANEL_LIMITS.inspector.min);
    expect(clampSize("inspector", 9999)).toBe(PANEL_LIMITS.inspector.max);
    expect(clampSize("inspector", 301.6)).toBe(302);
  });

  it("persists layout changes to localStorage", () => {
    usePreferences.getState().setSize("fileList", 400);
    usePreferences.getState().setDensity("comfortable");
    const stored = JSON.parse(localStorage.getItem("rustgit.preferences") ?? "{}") as {
      state: { sizes: { fileList: number }; density: string };
    };
    expect(stored.state.sizes.fileList).toBe(400);
    expect(stored.state.density).toBe("comfortable");
  });

  it("re-clamps corrupted stored sizes on rehydration", async () => {
    localStorage.setItem(
      "rustgit.preferences",
      JSON.stringify({ state: { sizes: { inspector: 5, rail: "wide" }, density: "huge" }, version: 1 }),
    );
    await usePreferences.persist.rehydrate();
    const state = usePreferences.getState();
    expect(state.sizes.inspector).toBe(PANEL_LIMITS.inspector.min);
    expect(state.sizes.rail).toBe(PANEL_LIMITS.rail.initial);
    expect(state.density).toBe("compact");
  });

  it("mirrors density and motion onto the root element", () => {
    const root: HTMLElement = document.createElement("html");
    applyPreferences({ density: "comfortable", motion: "reduce" }, root);
    expect(root.dataset.density).toBe("comfortable");
    expect(root.dataset.motion).toBe("reduce");
  });
});
