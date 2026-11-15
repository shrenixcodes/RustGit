import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RepositoryEntry, StatusSnapshot } from "../services/types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const { Rail } = await import("./Rail");
const { Ridge } = await import("./Ridge");
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
  useUi.setState({ switcherOpen: false, restoreFailure: null });
  usePreferences.setState({ activityOpen: false, personality: "quiet" });
  useActivity.setState({ operations: [], unseenFailures: 0 });
  status = {
    branch: { head: "main", oid: "abc1234", upstream: "origin/main", ahead: 2, behind: 1 },
    files: [{ path: "a.txt", originalPath: null, staged: null, unstaged: "modified", conflicted: false }],
    inProgress: "none",
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

describe("Rail", () => {
  it("disables repository workspaces until a repository is open", () => {
    useWorkspace.setState({ activeRepositoryId: null, section: "repositories" });
    renderWithClient(<Rail />);
    expect(screen.getByRole("button", { name: "Overview" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Settings" }).hasAttribute("disabled")).toBe(false);
  });

  it("explains why unbuilt workspaces are unavailable", () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<Rail />);
    const branches: HTMLElement = screen.getByRole("button", { name: "Branches" });
    expect(branches.hasAttribute("disabled")).toBe(true);
    expect(branches.getAttribute("title")).toContain("not built yet");
  });

  it("navigates and marks the current workspace", async () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<Rail />);
    await userEvent.click(screen.getByRole("button", { name: "History" }));
    expect(useWorkspace.getState().section).toBe("history");
    expect(screen.getByRole("button", { name: "History" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "History" }).getAttribute("title")).toContain("Ctrl+3");
  });

  it("toggles the deep workspace", async () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<Rail />);
    const toggle: HTMLElement = screen.getByRole("button", { name: "Deep workspace" });
    await userEvent.click(toggle);
    expect(usePreferences.getState().personality).toBe("deep");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Ridge", () => {
  it("shows the repository, its branch path and working tree state from real status", async () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<Ridge />);
    const ridge: HTMLElement = screen.getByRole("banner", { name: "Repository" });
    expect(await within(ridge).findByText("alpha")).toBeTruthy();
    expect(await within(ridge).findByText("main")).toBeTruthy();
    expect(ridge.textContent).toContain("2↑ ahead");
    expect(ridge.textContent).toContain("1↓ behind");
    expect(within(ridge).getByRole("button", { name: "1 changed" })).toBeTruthy();
  });

  it("names a detached HEAD and an operation in progress", async () => {
    status = { branch: { head: null, oid: "abcdef1234", upstream: null, ahead: 0, behind: 0 }, files: [], inProgress: "rebasing" };
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<Ridge />);
    expect(await screen.findByText("detached at abcdef1")).toBeTruthy();
    expect(screen.getByText("rebase in progress")).toBeTruthy();
    expect(screen.getByText("no upstream")).toBeTruthy();
    expect(screen.getByText("clean")).toBeTruthy();
  });

  it("switches repository from the name with the keyboard", async () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "changes", lastSectionByRepository: {} });
    renderWithClient(<Ridge />);
    await userEvent.click(await screen.findByRole("button", { name: /Switch repository/ }));
    const dialog: HTMLElement = screen.getByRole("dialog", { name: "Switch repository" });
    await within(dialog).findByRole("option", { name: /beta/ });
    await userEvent.type(within(dialog).getByRole("combobox"), "bet");
    expect(within(dialog).queryByRole("option", { name: /alpha/ })).toBeNull();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(useWorkspace.getState().activeRepositoryId).toBe(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the switcher open and explains a repository that cannot be opened", async () => {
    useWorkspace.setState({ activeRepositoryId: 1, section: "overview" });
    renderWithClient(<Ridge />);
    await userEvent.click(await screen.findByRole("button", { name: /Switch repository/ }));
    await userEvent.click(await screen.findByRole("option", { name: /gone/ }));
    const alert: HTMLElement = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not open gone");
    expect(useWorkspace.getState().activeRepositoryId).toBe(1);
  });
});

describe("OperationShelf", () => {
  it("is idle until something runs, then shows the last outcome", () => {
    renderWithClient(<OperationShelf />);
    expect(screen.getByText("idle")).toBeTruthy();
    cleanup();
    useActivity.getState().started(1, "Open repository", 1, 1000);
    useActivity.getState().finished(1, null, 1177);
    renderWithClient(<OperationShelf />);
    expect(screen.getByRole("contentinfo", { name: "Operations" }).textContent).toContain("open repository · done 177 ms");
  });

  it("surfaces failed operations on the activity toggle", async () => {
    useActivity.getState().started(9, "Open repository", 3);
    useActivity.getState().finished(9, { kind: "not_a_repository", message: "gone" });
    renderWithClient(<OperationShelf />);
    await userEvent.click(screen.getByRole("button", { name: "Activity, 1 failed operation" }));
    expect(usePreferences.getState().activityOpen).toBe(true);
  });
});
