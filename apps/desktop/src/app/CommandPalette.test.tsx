import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const { CommandPalette, fuzzyScore } = await import("./CommandPalette");
const { Seal } = await import("./Seal");
const { renderWithClient } = await import("../test/renderWithClient");
const { useWorkspace, mapNode } = await import("../stores/workspace");
const { usePreferences } = await import("../stores/preferences");
const { useUi } = await import("../stores/ui");

beforeEach(() => {
  usePreferences.setState({ zoom: "thread" });
  useUi.setState({ paletteOpen: true, sheet: null, switcherOpen: false });
  useWorkspace.setState({ activeRepositoryId: 1, activeRepositoryPath: "D:/a", focus: null, unfolded: null });
  invokeMock.mockImplementation(async (command: string) => {
    switch (command) {
      case "list_repositories":
        return [
          { id: 1, name: "alpha", path: "D:/a", pinned: false, addedAt: 1, lastOpenedAt: 1 },
          { id: 2, name: "beta", path: "D:/b", pinned: false, addedAt: 1, lastOpenedAt: 1 },
        ];
      case "list_refs":
        return {
          head: { kind: "branch", name: "main" },
          refs: [{ fullName: "refs/heads/feature", shortName: "feature", kind: "local", oid: "f".repeat(40), upstream: null, ahead: null, behind: null, upstreamGone: false, lastCommitTime: 0, lastCommitSummary: "" }],
        };
      case "repository_status":
        return { branch: { head: "main", oid: "abc", upstream: "origin/main", ahead: 2, behind: 0 }, files: [], inProgress: "rebasing" };
      default:
        throw { kind: "internal", message: command };
    }
  });
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("fuzzyScore", () => {
  it("matches subsequences and prefers word starts", () => {
    expect(fuzzyScore("Show the branch map", "bm")).not.toBeNull();
    expect(fuzzyScore("Show the branch map", "xyz")).toBeNull();
    expect(fuzzyScore("Settings", "set")).toBeGreaterThan(fuzzyScore("Reset view", "set") ?? Infinity);
  });
});

describe("CommandPalette", () => {
  it("filters commands and runs the chosen one with Enter", async () => {
    renderWithClient(<CommandPalette />);
    const dialog: HTMLElement = await screen.findByRole("dialog", { name: "Commands" });
    await userEvent.type(within(dialog).getByRole("combobox"), "branch map");
    await userEvent.keyboard("{Enter}");
    expect(usePreferences.getState().zoom).toBe("map");
    expect(useUi.getState().paletteOpen).toBe(false);
  });

  it("keeps the highlighted command scrolled into view", async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.textContent ?? "");
    };
    try {
      renderWithClient(<CommandPalette />);
      const dialog: HTMLElement = await screen.findByRole("dialog", { name: "Commands" });
      within(dialog).getByRole("combobox").focus();
      scrolled.length = 0;
      await userEvent.keyboard("{ArrowDown}{ArrowDown}");
      expect(scrolled).toHaveLength(2);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("offers repositories and branches by name", async () => {
    renderWithClient(<CommandPalette />);
    const dialog: HTMLElement = await screen.findByRole("dialog", { name: "Commands" });
    expect(await within(dialog).findByRole("option", { name: /Open beta/ })).toBeTruthy();
    await userEvent.click(await within(dialog).findByRole("option", { name: /Show feature on the map/ }));
    expect(useWorkspace.getState().unfolded).toBe(mapNode("f".repeat(40)));
  });
});

describe("Seal", () => {
  it("names the repository, its branch path and an operation in progress", async () => {
    useUi.setState({ paletteOpen: false });
    renderWithClient(<Seal />);
    const seal: HTMLElement = screen.getByRole("banner", { name: "Repository" });
    expect(await within(seal).findByRole("button", { name: /Repository alpha/ })).toBeTruthy();
    expect(await within(seal).findByText("main")).toBeTruthy();
    expect(seal.textContent).toContain("2↑ ahead");
    expect(within(seal).getByText("rebase in progress")).toBeTruthy();
    await userEvent.click(within(seal).getByRole("radio", { name: "Map" }));
    await waitFor(() => expect(usePreferences.getState().zoom).toBe("map"));
  });
});
