import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import type { Comparison } from "../../services/types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const { CompareView } = await import("./CompareView");
const { renderWithClient } = await import("../../test/renderWithClient");
const { useWorkspace } = await import("../../stores/workspace");
const { useUi } = await import("../../stores/ui");
const userEvent = (await import("@testing-library/user-event")).default;

const comparison: Comparison = {
  base: "b".repeat(40),
  head: "h".repeat(40),
  mergeBase: "m".repeat(40),
  ahead: 2,
  behind: 1,
  files: [{ path: "src/a.ts", originalPath: null, kind: "modified", additions: 3, deletions: 1 }],
};

beforeEach(() => {
  useWorkspace.setState({ activeRepositoryId: 4, activeRepositoryPath: "D:/r" });
  useUi.setState({ compare: { base: "main", head: "topic" } });
  invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    switch (command) {
      case "list_refs":
        return { head: { kind: "branch", name: "main" }, refs: [] };
      case "compare_revisions":
        return { ...comparison, mergeBase: args.mergeBase === true ? comparison.mergeBase : null };
      case "log_page": {
        // Test fixtures only: one commit per side of the range.
        const range: string = (args.revisions as string[])[0] ?? "";
        const onHead: boolean = range.endsWith("h".repeat(40));
        return {
          commits: [{ oid: (onHead ? "c" : "d").repeat(40), parents: [], summary: onHead ? "Topic work" : "Main work", authorName: "Ada", authorEmail: "a@x", authorTime: 1_700_000_000, committerTime: 1_700_000_000 }],
          hasMore: false,
        };
      }
      case "compare_file_diff":
        return { path: "src/a.ts", originalPath: null, side: "commit", status: "modified", binary: false, tooLarge: false, hunks: [], added: 3, deleted: 1, header: "" };
      default:
        throw { kind: "internal", message: command };
    }
  });
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("CompareView", () => {
  it("shows commits on each side and the changed files", async () => {
    renderWithClient(<CompareView />);
    expect(await screen.findByText("2 commits in topic not in main; 1 commit in main not in topic.")).toBeTruthy();
    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("compare_revisions", { id: 4, base: "main", head: "topic", mergeBase: true });
  });

  it("switches to a tree-to-tree comparison and swaps sides", async () => {
    renderWithClient(<CompareView />);
    await screen.findByText(/commits in topic/);
    await userEvent.click(screen.getByRole("radio", { name: "Tree to tree" }));
    expect(invokeMock).toHaveBeenCalledWith("compare_revisions", { id: 4, base: "main", head: "topic", mergeBase: false });
    await userEvent.click(screen.getByRole("button", { name: "Swap base and head" }));
    expect(useUi.getState().compare).toEqual({ base: "topic", head: "main" });
  });

  it("swaps with a revision that was typed but not yet committed", async () => {
    renderWithClient(<CompareView />);
    await screen.findByText(/commits in topic/);
    const [base] = screen.getAllByPlaceholderText("branch, tag or commit") as HTMLInputElement[];
    await userEvent.clear(base as HTMLInputElement);
    await userEvent.type(base as HTMLInputElement, "v1.0");
    // The click blurs the field (committing "v1.0") and then swaps.
    await userEvent.click(screen.getByRole("button", { name: "Swap base and head" }));
    expect(useUi.getState().compare).toEqual({ base: "topic", head: "v1.0" });
  });

  it("lists the commits on each side of the comparison", async () => {
    renderWithClient(<CompareView />);
    const ahead: HTMLElement = await screen.findByRole("region", { name: "In topic, not in main" });
    expect(await within(ahead).findByText("Topic work")).toBeTruthy();
    expect(within(ahead).getByText("and 1 more not listed here")).toBeTruthy();
    const behind: HTMLElement = screen.getByRole("region", { name: "In main, not in topic" });
    expect(await within(behind).findByText("Main work")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("log_page", expect.objectContaining({ revisions: [`${"b".repeat(40)}..${"h".repeat(40)}`] }));
  });

  it("loads a file's diff when unfolded", async () => {
    renderWithClient(<CompareView />);
    await userEvent.click(await screen.findByRole("button", { name: /a\.ts/ }));
    expect(invokeMock).toHaveBeenCalledWith("compare_file_diff", expect.objectContaining({ id: 4, path: "src/a.ts", mergeBase: true }));
  });
});
