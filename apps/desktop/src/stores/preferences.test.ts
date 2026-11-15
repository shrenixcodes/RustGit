import { beforeEach, describe, expect, it } from "vitest";
import { PANEL_LIMITS, applyPreferences, clampSize, rowHeightFor, usePreferences } from "./preferences";

beforeEach(() => {
  localStorage.clear();
  usePreferences.setState({ personality: "quiet", historyZoom: 0 });
});

describe("preferences", () => {
  it("clamps panel sizes to their limits", () => {
    expect(clampSize("inspector", 10)).toBe(PANEL_LIMITS.inspector.min);
    expect(clampSize("inspector", 9999)).toBe(PANEL_LIMITS.inspector.max);
    expect(clampSize("inspector", 301.6)).toBe(302);
  });

  it("persists layout and personality to localStorage", () => {
    usePreferences.getState().setSize("fileList", 400);
    usePreferences.getState().togglePersonality();
    const stored = JSON.parse(localStorage.getItem("rustgit.preferences") ?? "{}") as {
      state: { sizes: { fileList: number }; personality: string };
    };
    expect(stored.state.sizes.fileList).toBe(400);
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
      JSON.stringify({ state: { sizes: { inspector: 5, strand: "wide" }, personality: "loud", historyZoom: 9 }, version: 2 }),
    );
    await usePreferences.persist.rehydrate();
    const state = usePreferences.getState();
    expect(state.sizes.inspector).toBe(PANEL_LIMITS.inspector.min);
    expect(state.sizes.strand).toBe(PANEL_LIMITS.strand.initial);
    expect(state.personality).toBe("quiet");
    expect(state.historyZoom).toBe(1);
  });

  it("zooms history within three steps and resets", () => {
    const { zoomHistory } = usePreferences.getState();
    zoomHistory(1);
    zoomHistory(1);
    expect(usePreferences.getState().historyZoom).toBe(1);
    zoomHistory(-1);
    zoomHistory(-1);
    zoomHistory(-1);
    expect(usePreferences.getState().historyZoom).toBe(-1);
    zoomHistory(0);
    expect(usePreferences.getState().historyZoom).toBe(0);
  });

  it("maps personality to row height and mirrors it onto the root element", () => {
    expect(rowHeightFor("quiet")).toBe(30);
    expect(rowHeightFor("deep")).toBe(24);
    const root: HTMLElement = document.createElement("html");
    applyPreferences({ personality: "deep", motion: "reduce" }, root);
    expect(root.dataset.workspace).toBe("deep");
    expect(root.dataset.motion).toBe("reduce");
  });
});
