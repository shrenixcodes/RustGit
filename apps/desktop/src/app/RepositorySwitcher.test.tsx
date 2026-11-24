import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RepositoryEntry } from "../services/types";

const invokeMock = vi.fn();
const dialogOpenMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => dialogOpenMock(...args) }));

const { SwitcherPopover } = await import("./RepositorySwitcher");
const { renderWithClient } = await import("../test/renderWithClient");
const { useWorkspace } = await import("../stores/workspace");
const { useUi } = await import("../stores/ui");

function makeEntry(id: number, name: string, overrides: Partial<RepositoryEntry> = {}): RepositoryEntry {
  return { id, name, path: `D:/projects/${name}`, pinned: false, addedAt: 1, lastOpenedAt: null, ...overrides };
}

let repos: RepositoryEntry[] = [];

beforeEach(() => {
  repos = [
    makeEntry(1, "RustGit", { pinned: true }),
    makeEntry(2, "Lilt", { pinned: false }),
    makeEntry(3, "shelfy", { pinned: false }),
  ];
  useWorkspace.setState({ activeRepositoryId: 1, focus: null, unfolded: null });
  invokeMock.mockImplementation(async (command: string, args?: { id?: number; path?: string }) => {
    switch (command) {
      case "list_repositories":
        return repos;
      case "open_repository": {
        const found = repos.find((r) => r.id === args?.id);
        if (found) return found;
        throw { kind: "not_a_repository", message: "Not found" };
      }
      case "add_repository": {
        const added = makeEntry(10, "new-repo", { path: args?.path ?? "" });
        repos = [...repos, added];
        return added;
      }
      case "set_repository_pinned":
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

describe("SwitcherPopover", () => {
  it("renders the action toolbar and all repositories categorized", async () => {
    const root = { current: document.createElement("div") };
    renderWithClient(<SwitcherPopover onClose={vi.fn()} root={root} />);

    await waitFor(() => {
      expect(screen.getByText("RustGit")).toBeTruthy();
      expect(screen.getByText("Lilt")).toBeTruthy();
      expect(screen.getByText("shelfy")).toBeTruthy();
    });

    // Check quick actions exist
    expect(screen.getByRole("button", { name: /Add Local/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /\+ New/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Clone/i })).toBeTruthy();

    // Check pinned group exists
    expect(screen.getByText(/Pinned Repositories/i)).toBeTruthy();
  });

  it("filters repositories when typing in the search box", async () => {
    const user = userEvent.setup();
    const root = { current: document.createElement("div") };
    renderWithClient(<SwitcherPopover onClose={vi.fn()} root={root} />);

    await waitFor(() => {
      expect(screen.getByText("RustGit")).toBeTruthy();
    });

    const searchInput = screen.getByRole("combobox");
    await user.type(searchInput, "Lilt");

    await waitFor(() => {
      expect(screen.queryByText("RustGit")).toBeNull();
      expect(screen.getByText("Lilt")).toBeTruthy();
    });
  });

  it("switches to the create repository view when clicking + New", async () => {
    const user = userEvent.setup();
    const root = { current: document.createElement("div") };
    renderWithClient(<SwitcherPopover onClose={vi.fn()} root={root} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /\+ New/i })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: /\+ New/i }));

    await waitFor(() => {
      expect(screen.getByText("Create New Repository")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Back to repositories/i })).toBeTruthy();
    });
  });

  it("keeps a create form open when clicking outside, but closes the list", async () => {
    const user = userEvent.setup();
    useUi.setState({ switcherView: "list" });
    const root: { current: HTMLElement | null } = { current: null };
    const onClose = vi.fn();
    const { container } = renderWithClient(<SwitcherPopover onClose={onClose} root={root as { current: HTMLDivElement | null }} />);
    root.current = container;
    const outside: HTMLElement = document.createElement("div");
    document.body.append(outside);

    await user.click(await screen.findByRole("button", { name: /\+ New/i }));
    await screen.findByText("Create New Repository");
    fireEvent.pointerDown(outside);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Back to repositories/i }));
    fireEvent.pointerDown(outside);
    expect(onClose).toHaveBeenCalledTimes(1);
    outside.remove();
  });
});
