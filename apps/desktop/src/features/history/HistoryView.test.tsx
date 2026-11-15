import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommitDetails, LogCommit, LogPage, RefList } from "../../services/types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const { HistoryView } = await import("./HistoryView");
const { renderWithClient } = await import("../../test/renderWithClient");
const { useWorkspace } = await import("../../stores/workspace");
const { usePreferences } = await import("../../stores/preferences");

// Test fixtures only; production history comes from the backend.
function commit(oid: string, summary: string, ...parents: string[]): LogCommit {
  return { oid, parents, summary, authorName: "Ada", authorEmail: "ada@example.invalid", authorTime: 1_700_000_000, committerTime: 1_700_000_000 };
}

const OID = (name: string): string => name.padEnd(40, "0");
const history: LogCommit[] = [
  commit(OID("aa11"), "Merge feature", OID("bb22"), OID("cc33")),
  commit(OID("cc33"), "Add feature", OID("dd44")),
  commit(OID("bb22"), "Fix main", OID("dd44")),
  commit(OID("dd44"), "Initial commit"),
];

const refs: RefList = {
  head: { kind: "branch", name: "main" },
  refs: [
    { fullName: "refs/heads/main", shortName: "main", kind: "local", oid: OID("aa11"), upstream: "origin/main", ahead: 0, behind: 0, upstreamGone: false, lastCommitTime: 0, lastCommitSummary: "" },
    { fullName: "refs/remotes/origin/main", shortName: "origin/main", kind: "remote", oid: OID("bb22"), upstream: null, ahead: null, behind: null, upstreamGone: false, lastCommitTime: 0, lastCommitSummary: "" },
    { fullName: "refs/heads/feature", shortName: "feature", kind: "local", oid: OID("cc33"), upstream: null, ahead: null, behind: null, upstreamGone: false, lastCommitTime: 0, lastCommitSummary: "" },
    { fullName: "refs/tags/v1.0", shortName: "v1.0", kind: "tag", oid: OID("dd44"), upstream: null, ahead: null, behind: null, upstreamGone: false, lastCommitTime: 0, lastCommitSummary: "" },
  ],
};

let pages: (args: { skip: number; search: unknown; revisions: unknown }) => LogPage;

beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 1440;
  useWorkspace.setState({ activeRepositoryId: 1, section: "history", selectedCommit: null });
  pages = ({ skip }) => (skip === 0 ? { commits: history, hasMore: false } : { commits: [], hasMore: false });
  invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    switch (command) {
      case "repository_status":
        return { branch: { head: "main", oid: OID("aa11"), upstream: "origin/main", ahead: 1, behind: 0 }, files: [], inProgress: "none" };
      case "list_refs":
        return refs;
      case "log_page":
        return pages(args as { skip: number; search: unknown; revisions: unknown });
      case "commit_details": {
        const found: LogCommit | undefined = history.find((c) => c.oid === args.oid);
        const details: CommitDetails = {
          oid: String(args.oid),
          parents: found?.parents ?? [],
          authorName: "Ada",
          authorEmail: "ada@example.invalid",
          authorTime: 1_700_000_000,
          committerName: "Ada",
          committerEmail: "ada@example.invalid",
          committerTime: 1_700_000_000,
          message: `${found?.summary ?? "?"}\n\nLonger explanation.\n`,
          files: [{ path: "src/lib.rs", originalPath: null, kind: "modified", additions: 3, deletions: 1 }],
        };
        return details;
      }
      default:
        throw { kind: "internal", message: command };
    }
  });
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("HistoryView", () => {
  it("lists commits with the graph, merge marker and reference labels", async () => {
    renderWithClient(<HistoryView repositoryId={1} />);
    const list: HTMLElement = await screen.findByRole("listbox", { name: "Commits" });
    const merge: HTMLElement = within(list).getByRole("option", { name: /^Merge feature/ });
    expect(merge.getAttribute("aria-label")).toContain("merge commit");
    expect(merge.getAttribute("aria-label")).toContain("HEAD");
    expect(merge.getAttribute("aria-label")).toContain("current branch main");
    expect(within(list).getByRole("option", { name: /Fix main.*remote branch origin\/main/ })).toBeTruthy();
    expect(within(list).getByRole("option", { name: /Initial commit.*tag v1\.0/ })).toBeTruthy();
    // One graph cell per row.
    expect(list.querySelectorAll("svg[data-graph-cell]")).toHaveLength(4);
  });

  it("shows commit details in the inspector and navigates to a parent", async () => {
    renderWithClient(<HistoryView repositoryId={1} />);
    await userEvent.click(await screen.findByRole("option", { name: /^Merge feature/ }));

    const inspector: HTMLElement = await screen.findByRole("complementary", { name: "Inspector" });
    expect(await within(inspector).findByText("Longer explanation.")).toBeTruthy();
    expect(within(inspector).getByText(/compared with the first parent/)).toBeTruthy();
    expect(within(inspector).getByText("lib.rs")).toBeTruthy();

    await userEvent.click(within(inspector).getByRole("button", { name: OID("cc33").slice(0, 7) }));
    expect(useWorkspace.getState().selectedCommit).toBe(OID("cc33"));
  });

  it("moves with arrow keys: down, first parent, nearest child", async () => {
    renderWithClient(<HistoryView repositoryId={1} />);
    const list: HTMLElement = await screen.findByRole("listbox", { name: "Commits" });
    list.focus();
    await waitFor(() => expect(useWorkspace.getState().selectedCommit).toBe(OID("aa11")));
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(useWorkspace.getState().selectedCommit).toBe(OID("cc33"));
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(useWorkspace.getState().selectedCommit).toBe(OID("dd44"));
    fireEvent.keyDown(list, { key: "ArrowRight" });
    // Nearest loaded child of the root is the row directly above it.
    expect(useWorkspace.getState().selectedCommit).toBe(OID("bb22"));
  });

  it("searches through the backend and hides the graph for results", async () => {
    pages = ({ search }) =>
      search === null ? { commits: history, hasMore: false } : { commits: [history[1] as LogCommit], hasMore: false };
    renderWithClient(<HistoryView repositoryId={1} />);
    await screen.findByRole("listbox", { name: "Commits" });

    await userEvent.type(screen.getByRole("searchbox", { name: "Search commits" }), "feature");
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "log_page",
        expect.objectContaining({ search: { text: "feature", field: "message" } }),
      ),
    );
    const list: HTMLElement = await screen.findByRole("listbox", { name: "Commits" });
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(1));
    expect(list.querySelectorAll("svg[data-graph-cell]")).toHaveLength(0);
    expect(screen.getByText(/The graph is hidden because matches are not connected/)).toBeTruthy();

    await userEvent.click(within(list).getByRole("option"));
    await userEvent.click(await screen.findByRole("button", { name: /Show in graph/ }));
    await waitFor(() => expect(screen.getByRole("listbox", { name: "Commits" }).querySelectorAll("svg[data-graph-cell]")).toHaveLength(4));
    expect(useWorkspace.getState().selectedCommit).toBe(OID("cc33"));
  });

  it("filters the lineage by a branch chosen in the strand, and back to all", async () => {
    renderWithClient(<HistoryView repositoryId={1} />);
    await screen.findByRole("listbox", { name: "Commits" });
    const strand: HTMLElement = screen.getByRole("navigation", { name: "Branches" });
    await userEvent.click(within(strand).getByRole("button", { name: /^feature, no upstream/ }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("log_page", expect.objectContaining({ revisions: ["refs/heads/feature"] })),
    );
    expect(within(strand).getByRole("button", { name: /^feature/ }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(within(strand).getByRole("button", { name: "All branches and tags" }));
    await waitFor(() =>
      expect(within(strand).getByRole("button", { name: "All branches and tags" }).getAttribute("aria-pressed")).toBe("true"),
    );
  });

  it("shows the current branch and its upstream relationship in the strand", async () => {
    renderWithClient(<HistoryView repositoryId={1} />);
    const strand: HTMLElement = await screen.findByRole("navigation", { name: "Branches" });
    expect(await within(strand).findByRole("button", { name: "main, in sync, current branch" })).toBeTruthy();
    // Remotes and tags are folded until opened.
    expect(within(strand).queryByRole("button", { name: /origin\/main/ })).toBeNull();
    await userEvent.click(within(strand).getByRole("button", { name: /remotes 1/ }));
    expect(within(strand).getByRole("button", { name: "origin/main" })).toBeTruthy();
  });

  it("zooms the lineage with the toolbar and keyboard", async () => {
    usePreferences.setState({ historyZoom: 0 });
    renderWithClient(<HistoryView repositoryId={1} />);
    await screen.findByRole("listbox", { name: "Commits" });
    fireEvent.keyDown(window, { key: "=", ctrlKey: true });
    expect(usePreferences.getState().historyZoom).toBe(1);
    fireEvent.keyDown(window, { key: "0", ctrlKey: true });
    expect(usePreferences.getState().historyZoom).toBe(0);
  });

  it("requests the next page when the end of the loaded history is near", async () => {
    pages = ({ skip }) =>
      skip === 0 ? { commits: history.slice(0, 2), hasMore: true } : { commits: history.slice(2), hasMore: false };
    renderWithClient(<HistoryView repositoryId={1} />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("log_page", expect.objectContaining({ skip: 2 })));
    const list: HTMLElement = await screen.findByRole("listbox", { name: "Commits" });
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(4));
  });

  it("says when there are no commits", async () => {
    pages = () => ({ commits: [], hasMore: false });
    renderWithClient(<HistoryView repositoryId={1} />);
    expect(await screen.findByText("No commits yet.")).toBeTruthy();
  });
});
