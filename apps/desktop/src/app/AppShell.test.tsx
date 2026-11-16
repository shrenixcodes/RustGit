import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import type { RepositoryEntry } from "../services/types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const { AppShell } = await import("./AppShell");
const { renderWithClient } = await import("../test/renderWithClient");
const { useWorkspace } = await import("../stores/workspace");
const { useUi } = await import("../stores/ui");
const userEvent = (await import("@testing-library/user-event")).default;

const alpha: RepositoryEntry = { id: 7, name: "alpha", path: "D:/code/alpha", pinned: false, addedAt: 1, lastOpenedAt: 1 };
let openFails = false;

function rememberPath(path: string): void {
  localStorage.setItem(
    "rustgit.workspace",
    JSON.stringify({ state: { lastRepositoryPath: path }, version: 3 }),
  );
}

beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 1440;
  openFails = false;
  useWorkspace.setState({ activeRepositoryId: null, activeRepositoryPath: null, focus: null, unfolded: null });
  useUi.setState({ sheet: null, paletteOpen: false });
  useUi.setState({ restoreFailure: null });
  invokeMock.mockImplementation(async (command: string) => {
    switch (command) {
      case "list_repositories":
        return [alpha];
      case "open_repository":
        if (openFails) {
          throw { kind: "not_a_repository", message: "'D:/code/alpha' is not inside a Git repository." };
        }
        return alpha;
      case "repository_status":
        return { branch: { head: "main", oid: "abc", upstream: null, ahead: 0, behind: 0 }, files: [] };
      default:
        throw { kind: "internal", message: command };
    }
  });
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("AppShell", () => {
  it("restores the last repository by path through open_repository", async () => {
    rememberPath("D:/code/alpha");
    renderWithClient(<AppShell />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("open_repository", { id: 7 }));
    await waitFor(() => expect(useWorkspace.getState().activeRepositoryId).toBe(7));
    expect(useWorkspace.getState().activeRepositoryPath).toBe("D:/code/alpha");
  });

  it("does not open anything when the remembered path is not registered", async () => {
    rememberPath("D:/elsewhere/other");
    renderWithClient(<AppShell />);
    // Generous timeout: under full-suite load the first render can exceed the 1 s default.
    await screen.findByRole("button", { name: "Open alpha" }, { timeout: 5000 });
    expect(invokeMock).not.toHaveBeenCalledWith("open_repository", expect.anything());
    expect(useWorkspace.getState().activeRepositoryId).toBeNull();
  });

  it("explains when the remembered repository can no longer be opened", async () => {
    rememberPath("D:/code/alpha");
    openFails = true;
    renderWithClient(<AppShell />);
    const alert: HTMLElement = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not reopen the last repository");
    expect(screen.getByRole("button", { name: "Remove from list" })).toBeTruthy();
    expect(useWorkspace.getState().activeRepositoryId).toBeNull();
  });

  it("opens settings from the seal and commands with Ctrl+K", async () => {
    renderWithClient(<AppShell />);
    await screen.findByRole("button", { name: "Open alpha" }, { timeout: 5000 });
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(useUi.getState().sheet).toBe("settings");
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    useUi.setState({ sheet: null });
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(useUi.getState().paletteOpen).toBe(true);
    expect(await screen.findByRole("dialog", { name: "Commands" })).toBeTruthy();
  });
});
