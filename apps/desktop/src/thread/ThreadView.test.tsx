import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommitContext, CommitDetails, FileDiff, FileStatus, LogCommit, RefList, StatusSnapshot } from "../services/types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const { ThreadView } = await import("./ThreadView");
const { renderWithClient } = await import("../test/renderWithClient");
const { useWorkspace, LOOSE_END, commitNode, mapNode } = await import("../stores/workspace");
const { usePreferences } = await import("../stores/preferences");
const { useUi } = await import("../stores/ui");

// Test fixtures only; production data comes from the backend.
const OID = (name: string): string => name.padEnd(40, "0");
function commit(oid: string, summary: string, ...parents: string[]): LogCommit {
  return { oid, parents, summary, authorName: "Ada", authorEmail: "ada@example.invalid", authorTime: 1_700_000_000, committerTime: 1_700_000_000 };
}
const history: LogCommit[] = [
  commit(OID("aa11"), "Merge feature", OID("bb22"), OID("cc33")),
  commit(OID("cc33"), "Add feature", OID("dd44")),
  commit(OID("bb22"), "Fix main", OID("dd44")),
  commit(OID("ee55"), "Middle of main", OID("dd44")),
  commit(OID("dd44"), "Initial commit"),
];
const ref = (fullName: string, shortName: string, kind: "local" | "remote" | "tag", oid: string) => ({
  fullName, shortName, kind, oid, upstream: null, ahead: null, behind: null, upstreamGone: false, lastCommitTime: 1_700_000_000, lastCommitSummary: "",
});
const refs: RefList = {
  head: { kind: "branch", name: "main" },
  refs: [ref("refs/heads/main", "main", "local", OID("aa11")), ref("refs/heads/feature", "feature", "local", OID("cc33")), ref("refs/tags/v1", "v1", "tag", OID("dd44"))],
};
function file(path: string, staged: FileStatus["staged"], unstaged: FileStatus["unstaged"]): FileStatus {
  return { path, originalPath: null, staged, unstaged, conflicted: false };
}
function diff(side: "staged" | "unstaged", path: string): FileDiff {
  return {
    path, originalPath: null, side, status: "modified", binary: false, tooLarge: false, added: 1, deleted: 1,
    hunks: [{ header: `@@ -1 +1 @@ ${side} ${path}`, oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [
      { kind: "delete", content: "let x = 1;", oldLine: 1, newLine: null, noNewlineAtEnd: false },
      { kind: "add", content: "let x = 2;", oldLine: null, newLine: 1, noNewlineAtEnd: false },
    ] }],
  };
}

let files: FileStatus[];
let branchError: unknown;

beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 1440;
  usePreferences.setState({ zoom: "thread", personality: "quiet" });
  useUi.setState({ search: "", commitDrafts: {} });
  useWorkspace.setState({ activeRepositoryId: 1, activeRepositoryPath: "D:/x", focus: LOOSE_END, unfolded: null, selectedChange: null });
  files = [file("src/lib.rs", "modified", "modified"), file("notes.md", null, "untracked")];
  branchError = null;
  const context: CommitContext = { authorName: "Ada", authorEmail: "ada@example.invalid", signing: "off", head: { oid: OID("aa11"), summary: "Merge feature", message: "Merge feature\n", onUpstream: null }, inProgress: "none" };
  invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    const status: StatusSnapshot = { branch: { head: "main", oid: OID("aa11"), upstream: null, ahead: 0, behind: 0 }, files, inProgress: "none" };
    switch (command) {
      case "repository_status":
      case "stage_paths":
      case "unstage_paths":
      case "apply_hunk":
        return status;
      case "list_refs":
        return refs;
      case "log_page":
        if (args.search !== null) return { commits: history.filter((c) => c.summary.toLowerCase().includes(String((args.search as { text: string }).text).toLowerCase())), hasMore: false };
        return args.skip === 0 ? { commits: history, hasMore: false } : { commits: [], hasMore: false };
      case "file_diff":
        return diff(args.side as "staged" | "unstaged", String(args.path));
      case "change_totals":
        return { files: [], added: 1, deleted: 1 };
      case "commit_context":
        return context;
      case "create_commit":
        return { oid: OID("ff66"), summary: String(args.message).split("\n")[0], status };
      case "commit_details": {
        const found = history.find((c) => c.oid === args.oid);
        const details: CommitDetails = { oid: String(args.oid), parents: found?.parents ?? [], authorName: "Ada", authorEmail: "ada@example.invalid", authorTime: 1, committerName: "Ada", committerEmail: "ada@example.invalid", committerTime: 1, message: `${found?.summary ?? ""}\n\nWhy it changed.`, files: [{ path: "src/lib.rs", originalPath: null, kind: "modified", additions: 1, deletions: 0 }] };
        return details;
      }
      case "checkout_branch":
      case "delete_branch":
      case "merge_branch":
        if (branchError !== null) throw branchError;
        return command === "merge_branch" ? { outcome: "fast_forward", conflicted: [], status } : command === "delete_branch" ? refs : status;
      default:
        throw { kind: "internal", message: command };
    }
  });
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("the thread", () => {
  it("starts with the loose end, then commits newest first, with the uncommitted link to HEAD", async () => {
    renderWithClient(<ThreadView repositoryId={1} />);
    const tree: HTMLElement = await screen.findByRole("tree", { name: "Thread" });
    await waitFor(() => expect(within(tree).getAllByRole("treeitem")).toHaveLength(6));
    const items: HTMLElement[] = within(tree).getAllByRole("treeitem");
    expect(items[0]?.getAttribute("aria-label")).toBe("Uncommitted changes: 1 staged · 1 unstaged · 1 untracked");
    expect(items[1]?.getAttribute("aria-label")).toContain("Merge feature");
    expect(items[1]?.getAttribute("aria-label")).toContain("merge commit");
    expect(items[1]?.getAttribute("aria-label")).toContain("branch main");
  });

  it("unfolds the loose end into the review stream with each file once", async () => {
    renderWithClient(<ThreadView repositoryId={1} />);
    const tree: HTMLElement = await screen.findByRole("tree", { name: "Thread" });
    tree.focus();
    fireEvent.keyDown(tree, { key: "Enter" });
    const fold: HTMLElement = await screen.findByRole("group", { name: "Uncommitted changes" });
    const stream: HTMLElement = within(fold).getByRole("tree", { name: "Changed files" });
    expect(within(stream).getAllByRole("treeitem", { name: /src\/lib\.rs/ })).toHaveLength(1);
    expect(within(stream).getByRole("treeitem", { name: "src/lib.rs, Modified, partially staged" })).toBeTruthy();
    // Small change sets start expanded: both sections of the partly staged file are shown.
    expect(await within(fold).findByText("@@ -1 +1 @@ staged src/lib.rs")).toBeTruthy();
    expect(within(fold).getByText("@@ -1 +1 @@ unstaged src/lib.rs")).toBeTruthy();
    // The first "Stage hunk" belongs to src/lib.rs, listed before the untracked file.
    await userEvent.click(within(fold).getAllByRole("button", { name: "Stage hunk" })[0] as HTMLElement);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("apply_hunk", expect.objectContaining({ path: "src/lib.rs", action: "stage", hunkHeader: "@@ -1 +1 @@ unstaged src/lib.rs", contextLines: 3 })),
    );
  });

  it("commits from the loose end's own row, with the description from its fold", async () => {
    useWorkspace.setState({ unfolded: LOOSE_END });
    renderWithClient(<ThreadView repositoryId={1} />);
    const summary: HTMLElement = await screen.findByRole("textbox", { name: "Summary of the next commit" });
    await userEvent.type(summary, "Change x");
    await userEvent.type(screen.getByPlaceholderText("Description (optional)"), "Because y.");
    summary.focus();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("create_commit", { id: 1, message: "Change x\n\nBecause y.", amend: false }));
    expect(await screen.findByText(`committed ${OID("ff66").slice(0, 7)}`)).toBeTruthy();
  });

  it("unfolds a commit in place and walks to its parent", async () => {
    renderWithClient(<ThreadView repositoryId={1} />);
    await userEvent.click(await screen.findByRole("treeitem", { name: /^Add feature/ }));
    const fold: HTMLElement = await screen.findByRole("group", { name: `Commit ${OID("cc33").slice(0, 7)} unfolded` });
    expect(await within(fold).findByText("Why it changed.")).toBeTruthy();
    await userEvent.click(within(fold).getByRole("button", { name: OID("dd44").slice(0, 7) }));
    await waitFor(() => expect(useWorkspace.getState().focus).toBe(commitNode(OID("dd44"))));
  });

  it("moves along the thread with the keyboard and folds with Escape", async () => {
    renderWithClient(<ThreadView repositoryId={1} />);
    const tree: HTMLElement = await screen.findByRole("tree", { name: "Thread" });
    await within(tree).findAllByRole("treeitem");
    tree.focus();
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(useWorkspace.getState().focus).toBe(commitNode(OID("aa11")));
    fireEvent.keyDown(tree, { key: "Enter" });
    expect(useWorkspace.getState().unfolded).toBe(commitNode(OID("aa11")));
    fireEvent.keyDown(tree, { key: "Escape" });
    expect(useWorkspace.getState().unfolded).toBeNull();
  });

  it("searches through the backend and drops the lines for non-connected matches", async () => {
    useUi.setState({ search: "feature" });
    renderWithClient(<ThreadView repositoryId={1} />);
    expect(await screen.findByText(/match “feature”/)).toBeTruthy();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("log_page", expect.objectContaining({ search: { text: "feature", field: "message" } })));
    const tree: HTMLElement = screen.getByRole("tree");
    await waitFor(() => expect(within(tree).getAllByRole("treeitem")).toHaveLength(3));
    expect(tree.querySelectorAll("svg[data-graph-cell]")).toHaveLength(0);
  });
});

describe("the map", () => {
  beforeEach(() => usePreferences.setState({ zoom: "map" }));

  it("shows only heads, forks and merges", async () => {
    renderWithClient(<ThreadView repositoryId={1} />);
    const tree: HTMLElement = await screen.findByRole("tree", { name: "Branch map" });
    await waitFor(() => expect(within(tree).getAllByRole("treeitem")).toHaveLength(4));
    // The plain commits "Fix main" and "Middle of main" are folded into edges.
    expect(within(tree).queryByRole("treeitem", { name: /^Fix main/ })).toBeNull();
    expect(within(tree).getByRole("treeitem", { name: /^Add feature/ })).toBeTruthy();
  });

  it("switches and merges from a branch head", async () => {
    useWorkspace.setState({ unfolded: mapNode(OID("cc33")) });
    renderWithClient(<ThreadView repositoryId={1} />);
    const fold: HTMLElement = await screen.findByRole("group", { name: `Commit ${OID("cc33").slice(0, 7)} unfolded` });
    await userEvent.click(within(fold).getByRole("button", { name: "Merge into main" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Merge feature into main?" })).getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("merge_branch", { id: 1, source: "feature", strategy: "default" }));
    expect(await within(fold).findByText(/Fast-forwarded/)).toBeTruthy();
  });

  it("lists the files a switch would overwrite and changes nothing", async () => {
    branchError = { kind: "would_overwrite_changes", message: "would be overwritten", details: { exitCode: 1, paths: ["src/lib.rs"] } };
    useWorkspace.setState({ unfolded: mapNode(OID("cc33")) });
    renderWithClient(<ThreadView repositoryId={1} />);
    const fold: HTMLElement = await screen.findByRole("group", { name: /unfolded/ });
    await userEvent.click(within(fold).getByRole("button", { name: "Switch" }));
    // The working tree is dirty, so switching asks first.
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Switch" }));
    const alert: HTMLElement = await within(fold).findByRole("alert");
    expect(alert.textContent).toContain("Nothing changed");
    expect(alert.textContent).toContain("src/lib.rs");
  });

  it("offers a confirmed force delete when a branch is not fully merged", async () => {
    branchError = { kind: "branch_not_fully_merged", message: "not fully merged" };
    useWorkspace.setState({ unfolded: mapNode(OID("cc33")) });
    renderWithClient(<ThreadView repositoryId={1} />);
    const fold: HTMLElement = await screen.findByRole("group", { name: /unfolded/ });
    await userEvent.click(within(fold).getByRole("button", { name: "Delete…" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete branch" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("delete_branch", { id: 1, name: "feature", force: false }));
    branchError = null;
    await userEvent.click(await within(fold).findByRole("button", { name: "Delete anyway…" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: /unmerged commits/ })).getByRole("button", { name: "Delete anyway" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("delete_branch", { id: 1, name: "feature", force: true }));
  });
});
