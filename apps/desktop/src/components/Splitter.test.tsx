import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Splitter } from "./Splitter";
import { PANEL_LIMITS, usePreferences } from "../stores/preferences";

beforeEach(() => {
  localStorage.clear();
  usePreferences.getState().resetSize("activity");
});

afterEach(cleanup);

describe("Splitter", () => {
  it("exposes the window-splitter semantics", () => {
    render(<Splitter panel="activity" label="Resize activity panel" grows="up" />);
    const separator: HTMLElement = screen.getByRole("separator", { name: "Resize activity panel" });
    expect(separator.getAttribute("aria-valuenow")).toBe(String(PANEL_LIMITS.activity.initial));
    expect(separator.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("resizes with arrow keys in the panel's growth direction and jumps with Home/End", () => {
    render(<Splitter panel="activity" label="Resize activity panel" grows="up" />);
    const separator: HTMLElement = screen.getByRole("separator");
    fireEvent.keyDown(separator, { key: "ArrowUp" });
    expect(usePreferences.getState().sizes.activity).toBe(PANEL_LIMITS.activity.initial + 16);
    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(usePreferences.getState().sizes.activity).toBe(PANEL_LIMITS.activity.initial);
    fireEvent.keyDown(separator, { key: "End" });
    expect(usePreferences.getState().sizes.activity).toBe(PANEL_LIMITS.activity.max);
    fireEvent.keyDown(separator, { key: "Home" });
    expect(usePreferences.getState().sizes.activity).toBe(PANEL_LIMITS.activity.min);
  });

  it("resets on double-click", () => {
    usePreferences.getState().setSize("activity", 400);
    render(<Splitter panel="activity" label="Resize activity panel" grows="up" />);
    fireEvent.doubleClick(screen.getByRole("separator"));
    expect(usePreferences.getState().sizes.activity).toBe(PANEL_LIMITS.activity.initial);
  });
});
