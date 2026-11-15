import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RepositoryEntry } from "../../services/types";

const invokeMock = vi.fn();
const dialogOpenMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => dialogOpenMock(...args) }));

const { RepositoriesView } = await import("./RepositoriesView");
const { renderWithClient } = await import("../../test/renderWithClient");
const { useWorkspace } = await import("../../stores/workspace");

function entry(id: number, name: string, overrides: Partial<RepositoryEntry> = {}): RepositoryEntry {
  return { id, name, path: `D:/code/${name}`, pinned: false, addedAt: 1, lastOpenedAt: null, ...overrides };
}

let repositories: RepositoryEntry[] = [];

beforeEach(() => {
  repositories = [];
  useWorkspace.setState({ activeRepositoryId: null, focus: null, unfolded: null });
  invokeMock.mockImplementation(async (command: string, args?: { id?: number; path?: string }) => {
    switch (command) {
      case "list_repositories":
        return repositories;
      case "add_repository": {
        const added: RepositoryEntry = entry(10, "added", { path: args?.path ?? "" });
        repositories = [...repositories, added];
        return added;
      }
      case "open_repository":
        throw { kind: "not_a_repository", message: "'D:/code/gone' is not inside a Git repository." };
      case "remove_repository":
        repositories = repositories.filter((item: RepositoryEntry) => item.id !== args?.id);
        return null;
      default:
        throw { kind: "internal", message: `unexpected command ${command}` };
    }
  });
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
  dialogOpenMock.mockReset();
});

describe("RepositoriesView", () => {
  it("shows an empty state when no repositories are registered", async () => {
    renderWithClient(<RepositoriesView />);
    expect(await screen.findByText("No repositories yet")).toBeTruthy();
  });

  it("adds the folder picked in the dialog and opens it", async () => {
    dialogOpenMock.mockResolvedValue("D:/code/added");
    renderWithClient(<RepositoriesView />);
    await screen.findByText("No repositories yet");

    await userEvent.click(screen.getByRole("button", { name: /Add existing/ }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("add_repository", { path: "D:/code/added" }));
    expect(useWorkspace.getState().activeRepositoryId).toBe(10);
    expect(useWorkspace.getState().focus).toBe("now");
  });

  it("does nothing when the folder dialog is cancelled", async () => {
    dialogOpenMock.mockResolvedValue(null);
    renderWithClient(<RepositoriesView />);
    await screen.findByText("No repositories yet");

    await userEvent.click(screen.getByRole("button", { name: /Add existing/ }));

    await waitFor(() => expect(dialogOpenMock).toHaveBeenCalled());
    expect(invokeMock).not.toHaveBeenCalledWith("add_repository", expect.anything());
  });

  it("explains a missing repository and offers to remove it from the list", async () => {
    repositories = [entry(1, "gone")];
    renderWithClient(<RepositoriesView />);

    await userEvent.click(await screen.findByRole("button", { name: "Open gone" }));

    const alert: HTMLElement = await screen.findByRole("alert");
    expect(alert.textContent).toContain("no longer contains a Git repository");
    await userEvent.click(screen.getByRole("button", { name: "Remove from list" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("remove_repository", { id: 1 }));
    expect(await screen.findByText("No repositories yet")).toBeTruthy();
  });

  it("filters repositories by name or path", async () => {
    repositories = [entry(1, "alpha"), entry(2, "beta")];
    renderWithClient(<RepositoriesView />);
    await screen.findByRole("button", { name: "Open alpha" });

    await userEvent.type(screen.getByRole("searchbox"), "bet");

    expect(screen.queryByRole("button", { name: "Open alpha" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open beta" })).toBeTruthy();
  });
});
