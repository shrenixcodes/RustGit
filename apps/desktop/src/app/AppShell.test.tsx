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

const alpha: RepositoryEntry = { id: 7, name: "alpha", path: "D:/code/alpha", pinned: false, addedAt: 1, lastOpenedAt: 1 };
let openFails = false;

function rememberPath(path: string): void {
  localStorage.setItem(
    "rustgit.workspace",
    JSON.stringify({ state: { lastRepositoryPath: path, lastSectionByRepository: {} }, version: 1 }),
  );
}

beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 1440;
  openFails = false;
  useWorkspace.setState({ activeRepositoryId: null, activeRepositoryPath: null, section: "repositories" });
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
    await screen.findByRole("button", { name: "Open alpha" });
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

  it("gives rail buttons exact accessible names without shortcut hints", async () => {
    useWorkspace.setState({ activeRepositoryId: 7, activeRepositoryPath: alpha.path, section: "overview" });
    renderWithClient(<AppShell />);
    expect(screen.getByRole("button", { name: "Changes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });
});
