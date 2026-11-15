import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FileStatus, StatusSnapshot } from "../../services/types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const { ChangesView } = await import("./ChangesView");
const { buildRows } = await import("./ChangeTree");
const { renderWithClient } = await import("../../test/renderWithClient");
const { useWorkspace } = await import("../../stores/workspace");

function file(path: string, staged: FileStatus["staged"], unstaged: FileStatus["unstaged"], conflicted = false): FileStatus {
  return { path, originalPath: null, staged, unstaged, conflicted };
}

let files: FileStatus[];

beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 1440;
  useWorkspace.setState({ activeRepositoryId: 1, section: "changes", selectedChange: null });
  files = [
    file("src/both.rs", "modified", "modified"),
    file("src/staged.rs", "added", null),
    file("docs/new.md", null, "untracked"),
    file("conflict.txt", null, "unmerged", true),
  ];
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "repository_status") {
      const snapshot: StatusSnapshot = {
        branch: { head: "main", oid: "abc", upstream: null, ahead: 0, behind: 0 },
        files,
      };
      return snapshot;
    }
    throw { kind: "internal", message: command };
  });
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("ChangesView", () => {
  it("groups files and marks partially staged files in both groups", async () => {
    renderWithClient(<ChangesView repositoryId={1} />);
    const tree: HTMLElement = await screen.findByRole("tree", { name: "Changed files" });
    const groups: string[] = within(tree)
      .getAllByRole("treeitem")
      .filter((item: HTMLElement) => item.getAttribute("aria-level") === "1")
      .map((item: HTMLElement) => item.getAttribute("aria-label") ?? "");
    expect(groups).toEqual(["Conflicted, 1 file", "Staged, 2 files", "Unstaged, 1 file", "Untracked, 1 file"]);
    expect(within(tree).getAllByRole("treeitem", { name: /src\/both\.rs.*partially staged/ })).toHaveLength(2);
    expect(within(tree).getByRole("treeitem", { name: "src/staged.rs, Added" })).toBeTruthy();
  });

  it("selects files with the keyboard and shows their real state in the inspector", async () => {
    renderWithClient(<ChangesView repositoryId={1} />);
    const tree: HTMLElement = await screen.findByRole("tree");
    tree.focus();
    // Focus lands on the first file (conflict.txt); move down past the Staged header.
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await waitFor(() => expect(useWorkspace.getState().selectedChange).toEqual({ path: "src/both.rs", side: "staged" }));

    const inspector: HTMLElement = screen.getByRole("complementary", { name: "Inspector" });
    expect(within(inspector).getByText("Partially staged.")).toBeTruthy();
    // Index and working tree both report a modification for this file.
    expect(within(inspector).getAllByText("Modified")).toHaveLength(2);
    expect(within(inspector).queryByText("Matches the index")).toBeNull();
  });

  it("collapses a group with ArrowLeft on its header", async () => {
    renderWithClient(<ChangesView repositoryId={1} />);
    const tree: HTMLElement = await screen.findByRole("tree");
    tree.focus();
    await userEvent.keyboard("{ArrowUp}{ArrowLeft}");
    const header: HTMLElement = within(tree).getByRole("treeitem", { name: "Conflicted, 1 file" });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(within(tree).queryByRole("treeitem", { name: /conflict\.txt/ })).toBeNull();
  });

  it("filters by path", async () => {
    renderWithClient(<ChangesView repositoryId={1} />);
    await screen.findByRole("tree");
    await userEvent.type(screen.getByRole("searchbox"), "docs");
    await waitFor(() => expect(screen.queryByRole("treeitem", { name: /src\/staged\.rs/ })).toBeNull());
    expect(screen.getByRole("treeitem", { name: "docs/new.md, Untracked" })).toBeTruthy();
  });

  it("says the working tree is clean when there are no changes", async () => {
    files = [];
    renderWithClient(<ChangesView repositoryId={1} />);
    expect(await screen.findByText("No changes. The working tree is clean.")).toBeTruthy();
    expect(screen.getByText("Nothing to review.")).toBeTruthy();
  });

  it("does not offer staging or diff actions that the backend cannot perform", async () => {
    useWorkspace.setState({ selectedChange: { path: "src/staged.rs", side: "staged" } });
    renderWithClient(<ChangesView repositoryId={1} />);
    expect(await screen.findByText("The diff for this file cannot be shown yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /stage/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /discard/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /commit/i })).toBeNull();
  });
});

describe("buildRows", () => {
  it("stays bounded in rendered rows for thousands of files", async () => {
    files = Array.from({ length: 5000 }, (_, index: number) => file(`pkg/file-${index}.ts`, null, "modified"));
    expect(buildRows(files, "", new Set())).toHaveLength(5001);
    renderWithClient(<ChangesView repositoryId={1} />);
    const tree: HTMLElement = await screen.findByRole("tree");
    expect(within(tree).getAllByRole("treeitem").length).toBeLessThan(80);
  });
});
