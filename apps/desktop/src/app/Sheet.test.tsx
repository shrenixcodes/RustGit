import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

const invokeMock = vi.fn(async () => {
  throw { kind: "internal", message: "not under test" };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...(args as [])) }));

const { Sheet } = await import("./Sheet");
const { renderWithClient } = await import("../test/renderWithClient");
const { useUi } = await import("../stores/ui");

afterEach(() => {
  cleanup();
  act(() => useUi.getState().setSheet(null));
});

describe("the sheet", () => {
  it("keeps its dialog open while switching tabs", () => {
    act(() => useUi.getState().setSheet("settings"));
    renderWithClient(<Sheet />);
    const dialog = screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;
    const close = vi.fn();
    dialog.close = close;
    fireEvent.click(screen.getByRole("button", { name: "Shortcuts", hidden: true }));
    expect(useUi.getState().sheet).toBe("shortcuts");
    expect(close).not.toHaveBeenCalled();
  });

  it("closes when the backdrop is clicked, not when a click starts inside", () => {
    act(() => useUi.getState().setSheet("settings"));
    renderWithClient(<Sheet />);
    const dialog = screen.getByRole("dialog", { hidden: true });
    const tab = screen.getByRole("button", { name: "Shortcuts", hidden: true });
    fireEvent.pointerDown(tab);
    fireEvent.click(dialog);
    expect(useUi.getState().sheet).toBe("settings");
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(useUi.getState().sheet).toBeNull();
  });
});
