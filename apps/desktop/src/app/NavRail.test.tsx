import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RepositoryEntry, StatusSnapshot } from "../services/types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const { NavRail } = await import("./NavRail");
const { OperationShelf } = await import("./OperationShelf");
const { renderWithClient } = await import("../test/renderWithClient");
const { useWorkspace } = await import("../stores/workspace");
const { useUi } = await import("../stores/ui");
const { usePreferences } = await import("../stores/preferences");
const { useActivity } = await import("../stores/activity");

function entry(id: number, name: string, pinned = false): RepositoryEntry {
  return { id, name, path: `D:/code/${name}`, pinned, addedAt: 1, lastOpenedAt: 1 };
}

let status: StatusSnapshot;

beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 1440;
  useUi.setState({ switcherOpen: false, narrowRailExpanded: false, restoreFailure: null });
  usePreferences.setState({ railCollapsed: false, activityOpen: false });
  useActivity.setState({ operations: [], unseenFailures: 0 });
  status = {
    branch: { head: "main", oid: "abc1234", upstream: "origin/main", ahead: 2, behind: 1 },
    files: [{ path: "a.txt", originalPath: null, staged: null, unstaged: "modified", conflicted: false }],
  };
  invokeMock.mockImplementation(async (command: string, args?: { id?: number }) => {
    switch (command) {
      case "list_repositories":
        return [entry(1, "alpha", true), entry(2, "beta"), entry(3, "gone")];
      case "repository_status":
        return status;
      case "open_repository":
        if (args?.id === 3) {
          throw { kind: "not_a_repository", message: "'D:/code/gone' is not inside a Git repository." };
        }
        return entry(args?.id ?? 0, args?.id === 2 ? "beta" : "alpha");
      default:
        throw { kind: "internal", message: command };
    }
  });
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("NavRail", () => {
  it("disables repository sections until a repository is open", () => {
    useWorkspace.setState({ activeRepositoryId: null, section: "repositories" });
    renderWithClient(<NavRail />);
    expect(screen.getByRole("button", { name: /Overview/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /Settings/ }).hasAttribute("disabled")).toBe(false);
  });

  it("explains why unimplemented sections are unavailable", () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<NavRail />);
    const history: HTMLElement = screen.getByRole("button", { name: /History/ });
    expect(history.hasAttribute("disabled")).toBe(true);
    expect(history.getAttribute("title")).toContain("commit log");
  });

  it("navigates to an enabled section and marks it current", async () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<NavRail />);
    await userEvent.click(screen.getByRole("button", { name: /Changes/ }));
    expect(useWorkspace.getState().section).toBe("changes");
    expect(screen.getByRole("button", { name: /Changes/ }).getAttribute("aria-current")).toBe("page");
  });

  it("collapses to labelled icons and remembers the choice", async () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<NavRail />);
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(usePreferences.getState().railCollapsed).toBe(true);
    expect(screen.getByRole("button", { name: "Changes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });

  it("shows the active repository's real branch and change count", async () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<NavRail />);
    expect(await screen.findByText("main")).toBeTruthy();
    expect(screen.getByText("· 1 changed")).toBeTruthy();
  });
});

describe("RepositorySwitcher", () => {
  it("filters and opens a repository with the keyboard", async () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "changes", lastSectionByRepository: {} });
    renderWithClient(<NavRail />);
    await userEvent.click(await screen.findByRole("button", { name: /Switch repository/ }));
    const dialog: HTMLElement = screen.getByRole("dialog", { name: "Switch repository" });
    await within(dialog).findByRole("option", { name: /beta/ });

    await userEvent.type(within(dialog).getByRole("combobox"), "bet");
    expect(within(dialog).queryByRole("option", { name: /alpha/ })).toBeNull();
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("open_repository", { id: 2 }));
    await waitFor(() => expect(useWorkspace.getState().activeRepositoryId).toBe(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the switcher open and explains a repository that cannot be opened", async () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<NavRail />);
    await userEvent.click(await screen.findByRole("button", { name: /Switch repository/ }));
    await userEvent.click(await screen.findByRole("option", { name: /gone/ }));

    const alert: HTMLElement = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not open gone");
    expect(useWorkspace.getState().activeRepositoryId).toBe(1);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closes on Escape", async () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<NavRail />);
    await userEvent.click(await screen.findByRole("button", { name: /Switch repository/ }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("OperationShelf", () => {
  it("shows the branch, upstream counts and change summary from status", async () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<OperationShelf />);
    const shelf: HTMLElement = screen.getByRole("contentinfo", { name: "Status and operations" });
    expect(await within(shelf).findByText("main")).toBeTruthy();
    expect(shelf.textContent).toContain("ahead 2");
    expect(shelf.textContent).toContain("behind 1");
    expect(within(shelf).getByRole("button", { name: /1 changed/ })).toBeTruthy();
  });

  it("says when the working tree is clean and when there is no upstream", async () => {
    status = { branch: { head: "main", oid: "abc", upstream: null, ahead: 0, behind: 0 }, files: [] };
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<OperationShelf />);
    expect(await screen.findByText("Working tree clean")).toBeTruthy();
    expect(screen.getByText("no upstream")).toBeTruthy();
  });

  it("surfaces failed operations on the activity toggle", async () => {
    useWorkspace.setState({ activeRepositoryId: null, section: "repositories" });
    useActivity.getState().started(9, "Open repository", 3);
    useActivity.getState().finished(9, { kind: "not_a_repository", message: "gone" });
    renderWithClient(<OperationShelf />);
    const toggle: HTMLElement = screen.getByRole("button", { name: "Activity, 1 failed operation" });
    await userEvent.click(toggle);
    expect(usePreferences.getState().activityOpen).toBe(true);
  });
});
