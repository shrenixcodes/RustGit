import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Splitter } from "./Splitter";
import { PANEL_LIMITS, usePreferences } from "../stores/preferences";

beforeEach(() => {
  localStorage.clear();
  usePreferences.getState().resetSize("inspector");
});

afterEach(cleanup);

describe("Splitter", () => {
  it("exposes the window-splitter semantics", () => {
    render(<Splitter panel="inspector" label="Resize inspector" grows="left" />);
    const separator: HTMLElement = screen.getByRole("separator", { name: "Resize inspector" });
    expect(separator.getAttribute("aria-valuenow")).toBe(String(PANEL_LIMITS.inspector.initial));
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
  });

  it("resizes with arrow keys in the panel's growth direction and jumps with Home/End", () => {
    render(<Splitter panel="inspector" label="Resize inspector" grows="left" />);
    const separator: HTMLElement = screen.getByRole("separator");
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(usePreferences.getState().sizes.inspector).toBe(PANEL_LIMITS.inspector.initial + 16);
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(usePreferences.getState().sizes.inspector).toBe(PANEL_LIMITS.inspector.initial);
    fireEvent.keyDown(separator, { key: "End" });
    expect(usePreferences.getState().sizes.inspector).toBe(PANEL_LIMITS.inspector.max);
    fireEvent.keyDown(separator, { key: "Home" });
    expect(usePreferences.getState().sizes.inspector).toBe(PANEL_LIMITS.inspector.min);
  });

  it("resets on double-click", () => {
    usePreferences.getState().setSize("inspector", 400);
    render(<Splitter panel="inspector" label="Resize inspector" grows="left" />);
    fireEvent.doubleClick(screen.getByRole("separator"));
    expect(usePreferences.getState().sizes.inspector).toBe(PANEL_LIMITS.inspector.initial);
  });
});
