import { beforeEach, describe, expect, it } from "vitest";
import { PANEL_LIMITS, applyPreferences, clampSize, rowHeightFor, usePreferences } from "./preferences";

beforeEach(() => {
  localStorage.clear();
  usePreferences.setState({ personality: "quiet", zoom: "thread" });
});

describe("preferences", () => {
  it("clamps panel sizes to their limits", () => {
    expect(clampSize("activity", 10)).toBe(PANEL_LIMITS.activity.min);
    expect(clampSize("activity", 9999)).toBe(PANEL_LIMITS.activity.max);
    expect(clampSize("activity", 300.6)).toBe(301);
  });

  it("persists the distance and personality", () => {
    usePreferences.getState().setZoom("map");
    usePreferences.getState().togglePersonality();
    const stored = JSON.parse(localStorage.getItem("rustgit.preferences") ?? "{}") as {
      state: { zoom: string; personality: string };
    };
    expect(stored.state.zoom).toBe("map");
    expect(stored.state.personality).toBe("deep");
  });

  it("migrates the old density setting to a personality", async () => {
    localStorage.setItem("rustgit.preferences", JSON.stringify({ state: { density: "compact" }, version: 1 }));
    await usePreferences.persist.rehydrate();
    expect(usePreferences.getState().personality).toBe("deep");
  });

  it("re-validates corrupted stored values on rehydration", async () => {
    localStorage.setItem(
      "rustgit.preferences",
      JSON.stringify({ state: { sizes: { activity: "tall" }, personality: "loud", zoom: "galaxy" }, version: 3 }),
    );
    await usePreferences.persist.rehydrate();
    const state = usePreferences.getState();
    expect(state.sizes.activity).toBe(PANEL_LIMITS.activity.initial);
    expect(state.personality).toBe("quiet");
    expect(state.zoom).toBe("thread");
  });

  it("maps personality to row height and mirrors it onto the root element", () => {
    expect(rowHeightFor("quiet")).toBe(32);
    expect(rowHeightFor("deep")).toBe(26);
    const root: HTMLElement = document.createElement("html");
    applyPreferences({ personality: "deep", motion: "reduce" }, root);
    expect(root.dataset.workspace).toBe("deep");
    expect(root.dataset.motion).toBe("reduce");
  });
});
