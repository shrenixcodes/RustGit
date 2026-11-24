import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FileDiff, StashEntry } from "../../services/types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const { StashesView } = await import("./StashesView");
const { renderWithClient } = await import("../../test/renderWithClient");
const { useWorkspace } = await import("../../stores/workspace");

// Test fixtures only; production data comes from the backend.
const stash: StashEntry = { index: 0, oid: "5".repeat(40), message: "WIP on main: tweak", createdAt: 1_700_000_000 };
const diff: FileDiff = {
  path: "src/lib.rs", originalPath: null, side: "unstaged", status: "modified", binary: false, tooLarge: false, added: 1, deleted: 1,
  hunks: [{ header: "@@ -1 +1 @@ stashed", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [
    { kind: "delete", content: "old line", oldLine: 1, newLine: null, noNewlineAtEnd: false },
    { kind: "add", content: "new line", oldLine: null, newLine: 1, noNewlineAtEnd: false },
  ] }],
};

beforeEach(() => {
  useWorkspace.setState({ activeRepositoryId: 1, activeRepositoryPath: "D:/x" });
  invokeMock.mockImplementation(async (command: string) => {
    switch (command) {
      case "list_stashes":
        return [stash];
      case "stash_details":
        return { files: [{ path: "src/lib.rs", kind: "modified", untracked: false }] };
      case "stash_file_diff":
        return diff;
      case "repository_status":
        return { branch: { head: "main", oid: "a".repeat(40), upstream: null, ahead: 0, behind: 0 }, files: [], inProgress: "none" };
      default:
        throw { kind: "internal", message: command };
    }
  });
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("the stash list", () => {
  it("shows a stashed file's diff only when it is opened", async () => {
    renderWithClient(<StashesView />);
    await userEvent.click(await screen.findByRole("button", { name: /WIP on main: tweak/, expanded: false }));
    const file: HTMLElement = await screen.findByRole("button", { name: /src\/lib\.rs/ });
    expect(invokeMock).not.toHaveBeenCalledWith("stash_file_diff", expect.anything());
    await userEvent.click(file);
    expect(await screen.findByText("@@ -1 +1 @@ stashed")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("stash_file_diff", { id: 1, oid: stash.oid, path: "src/lib.rs", contextLines: 3 });
  });
});
