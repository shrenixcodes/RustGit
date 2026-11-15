import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const { Sidebar } = await import("./Sidebar");
const { renderWithClient } = await import("../test/renderWithClient");
const { useWorkspace } = await import("../stores/workspace");

beforeEach(() => {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "list_repositories") {
      return [{ id: 1, name: "demo", path: "D:/demo", pinned: false, addedAt: 1, lastOpenedAt: 1 }];
    }
    if (command === "repository_status") {
      return { branch: { head: "main", oid: "abc", upstream: null, ahead: 0, behind: 0 }, files: [] };
    }
    throw { kind: "internal", message: command };
  });
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("Sidebar", () => {
  it("disables repository sections until a repository is open", () => {
    useWorkspace.setState({ activeRepositoryId: null, section: "repositories" });
    renderWithClient(<Sidebar />);
    expect(screen.getByRole("button", { name: /Overview/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /Settings/ }).hasAttribute("disabled")).toBe(false);
  });

  it("marks unimplemented sections unavailable even with a repository open", async () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<Sidebar />);
    const history: HTMLElement = screen.getByRole("button", { name: /History/ });
    expect(history.hasAttribute("disabled")).toBe(true);
    expect(history.getAttribute("title")).toBe("History is not available yet");
    expect(await screen.findByText("main")).toBeTruthy();
  });

  it("navigates to an enabled section", async () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<Sidebar />);
    await userEvent.click(screen.getByRole("button", { name: /Changes/ }));
    expect(useWorkspace.getState().section).toBe("changes");
    expect(screen.getByRole("button", { name: /Changes/ }).getAttribute("aria-current")).toBe("page");
  });
});
