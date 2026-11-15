import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CommitContext, FileDiff, FileStatus, StatusSnapshot } from "../../services/types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const { ChangesView } = await import("./ChangesView");
const { buildRows } = await import("./ChangeTree");
const { composeMessage, splitMessage } = await import("./CommitComposer");
const { renderWithClient } = await import("../../test/renderWithClient");
const { useWorkspace } = await import("../../stores/workspace");
const { useUi } = await import("../../stores/ui");

// Test fixtures only; production data comes from the backend.
function file(path: string, staged: FileStatus["staged"], unstaged: FileStatus["unstaged"], conflicted = false): FileStatus {
  return { path, originalPath: null, staged, unstaged, conflicted };
}

function fileDiff(side: "staged" | "unstaged", header: string): FileDiff {
  return {
    path: "src/both.rs",
    originalPath: null,
    side,
    status: "modified",
    binary: false,
    tooLarge: false,
    hunks: [
      {
        header,
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 3,
        lines: [
          { kind: "context", content: "fn a() {}", oldLine: 1, newLine: 1, noNewlineAtEnd: false },
          { kind: "delete", content: "let x = 1;", oldLine: 2, newLine: null, noNewlineAtEnd: false },
          { kind: "add", content: "let x = 2;", oldLine: null, newLine: 2, noNewlineAtEnd: false },
          { kind: "add", content: "let y = 3;", oldLine: null, newLine: 3, noNewlineAtEnd: false },
        ],
      },
    ],
    added: 2,
    deleted: 1,
  };
}

let files: FileStatus[];
let context: CommitContext;
let applyError: unknown;

function snapshot(): StatusSnapshot {
  return { branch: { head: "main", oid: "abc", upstream: null, ahead: 0, behind: 0 }, files, inProgress: "none" };
}

beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 1440;
  useWorkspace.setState({ activeRepositoryId: 1, section: "changes", selectedChange: null });
  useUi.setState({ commitDrafts: {} });
  applyError = null;
  files = [
    file("src/both.rs", "modified", "modified"),
    file("src/staged.rs", "added", null),
    file("docs/new.md", null, "untracked"),
    file("conflict.txt", null, "unmerged", true),
  ];
  context = { authorName: "Ada", authorEmail: "ada@example.invalid", signing: "off", head: { oid: "abc", summary: "Previous", message: "Previous\n\nBody of previous.\n", onUpstream: true }, inProgress: "none" };
  invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    switch (command) {
      case "repository_status":
        return snapshot();
      case "file_diff":
        return fileDiff(args.side as "staged" | "unstaged", args.side === "staged" ? "@@ -1,2 +1,2 @@ staged" : "@@ -1,2 +1,3 @@ worktree");
      case "change_totals":
        return { files: [], added: 7, deleted: 2 };
      case "commit_context":
        return context;
      case "stage_paths":
      case "unstage_paths":
      case "stage_all":
      case "unstage_all":
      case "discard_paths":
        return snapshot();
      case "apply_hunk":
        if (applyError !== null) throw applyError;
        return snapshot();
      case "create_commit":
        return { oid: "f00dcafe", summary: String(args.message).split("\n")[0], status: snapshot() };
      default:
        throw { kind: "internal", message: command };
    }
  });
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("Changes navigator", () => {
  it("lists every file once, with partial staging in its accessible name", async () => {
    renderWithClient(<ChangesView repositoryId={1} />);
    const tree: HTMLElement = await screen.findByRole("tree", { name: "Changed files" });
    const groups: string[] = within(tree)
      .getAllByRole("treeitem")
      .filter((item) => item.getAttribute("aria-level") === "1")
      .map((item) => item.getAttribute("aria-label") ?? "");
    expect(groups).toEqual(["conflicts, 1 file", "changes, 2 files", "untracked, 1 file"]);
    expect(within(tree).getAllByRole("treeitem", { name: /src\/both\.rs/ })).toHaveLength(1);
    expect(within(tree).getByRole("treeitem", { name: "src/both.rs, Modified, partially staged" })).toBeTruthy();
    expect(within(tree).getByRole("treeitem", { name: "src/staged.rs, Added, staged" })).toBeTruthy();
  });

  it("stages the selected file with Space and unstages with u", async () => {
    renderWithClient(<ChangesView repositoryId={1} />);
    const tree: HTMLElement = await screen.findByRole("tree");
    tree.focus();
    // Focus selects the first file (conflict.txt); move past the "changes" header to src/both.rs.
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await waitFor(() => expect(useWorkspace.getState().selectedChange?.path).toBe("src/both.rs"));
    await userEvent.keyboard(" ");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("stage_paths", { id: 1, paths: ["src/both.rs"] }));
    await userEvent.keyboard("u");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("unstage_paths", { id: 1, paths: ["src/both.rs"] }));
  });

  it("stays bounded in rendered rows for thousands of files", async () => {
    files = Array.from({ length: 5000 }, (_, index: number) => file(`pkg/file-${index}.ts`, null, "modified"));
    expect(buildRows(files, "", new Set())).toHaveLength(5001);
    renderWithClient(<ChangesView repositoryId={1} />);
    const tree: HTMLElement = await screen.findByRole("tree");
    expect(within(tree).getAllByRole("treeitem").length).toBeLessThan(80);
  });
});

describe("Diff canvas", () => {
  async function openBoth(): Promise<HTMLElement> {
    useWorkspace.setState({ selectedChange: { path: "src/both.rs", side: "unstaged" } });
    renderWithClient(<ChangesView repositoryId={1} />);
    return screen.findByRole("region", { name: "Diff of src/both.rs" });
  }

  it("shows staged and not-staged sections of a partially staged file", async () => {
    const canvas: HTMLElement = await openBoth();
    expect(await within(canvas).findByText("@@ -1,2 +1,2 @@ staged")).toBeTruthy();
    expect(within(canvas).getByText("@@ -1,2 +1,3 @@ worktree")).toBeTruthy();
    expect(within(canvas).getByRole("button", { name: "Unstage hunk" })).toBeTruthy();
    expect(within(canvas).getByRole("button", { name: "Stage hunk" })).toBeTruthy();
  });

  it("stages a whole hunk by its header with the diff's context lines", async () => {
    const canvas: HTMLElement = await openBoth();
    await userEvent.click(await within(canvas).findByRole("button", { name: "Stage hunk" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "apply_hunk",
        expect.objectContaining({ path: "src/both.rs", side: "unstaged", action: "stage", hunkHeader: "@@ -1,2 +1,3 @@ worktree", lineIndices: null, contextLines: 3 }),
      ),
    );
  });

  it("stages selected lines only", async () => {
    const canvas: HTMLElement = await openBoth();
    await within(canvas).findByText("@@ -1,2 +1,3 @@ worktree");
    // The not-staged section's "let y = 3;" line (index 3 in its hunk).
    const lines: HTMLElement[] = within(canvas).getAllByText("let y = 3;");
    await userEvent.click(lines[lines.length - 1] as HTMLElement);
    await userEvent.click(within(canvas).getByRole("button", { name: "Stage 1 line" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("apply_hunk", expect.objectContaining({ action: "stage", lineIndices: [3] })),
    );
  });

  it("asks before discarding and does nothing on cancel", async () => {
    const canvas: HTMLElement = await openBoth();
    await userEvent.click(await within(canvas).findByRole("button", { name: "Discard hunk" }));
    const dialog: HTMLElement = await screen.findByRole("dialog", { name: "Discard this hunk?" });
    expect(dialog.textContent).toContain("cannot be undone");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(invokeMock).not.toHaveBeenCalledWith("apply_hunk", expect.objectContaining({ action: "discard" }));

    await userEvent.click(within(canvas).getByRole("button", { name: "Discard hunk" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Discard hunk" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("apply_hunk", expect.objectContaining({ action: "discard" })));
  });

  it("explains a stale diff instead of pretending the change was applied", async () => {
    applyError = { kind: "stale_diff", message: "hunk changed" };
    const canvas: HTMLElement = await openBoth();
    await userEvent.click(await within(canvas).findByRole("button", { name: "Stage hunk" }));
    expect((await screen.findByRole("alert")).textContent).toContain("nothing was applied");
  });

  it("disables staging while whitespace is ignored", async () => {
    const canvas: HTMLElement = await openBoth();
    await within(canvas).findByText("@@ -1,2 +1,3 @@ worktree");
    await userEvent.click(within(canvas).getByRole("checkbox", { name: /ignore whitespace/ }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("file_diff", expect.objectContaining({ ignoreWhitespace: true })),
    );
    await waitFor(() => expect(within(canvas).getByRole("button", { name: "Stage hunk" }).hasAttribute("disabled")).toBe(true));
  });
});

describe("Commit composer", () => {
  it("commits the staged changes with a composed message and clears the draft", async () => {
    renderWithClient(<ChangesView repositoryId={1} />);
    const form: HTMLElement = await screen.findByRole("form", { name: "Next commit" });
    expect(await within(form).findByText("+7")).toBeTruthy();
    await userEvent.type(within(form).getByPlaceholderText("Summary"), "Add feature");
    await userEvent.type(within(form).getByPlaceholderText("Description (optional)"), "Explains why.");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("create_commit", { id: 1, message: "Add feature\n\nExplains why.", amend: false }),
    );
    expect(await within(form).findByText("f00dcaf")).toBeTruthy();
    expect((within(form).getByPlaceholderText("Summary") as HTMLInputElement).value).toBe("");
  });

  it("explains why it cannot commit when nothing is staged", async () => {
    files = [file("docs/new.md", null, "untracked")];
    renderWithClient(<ChangesView repositoryId={1} />);
    const form: HTMLElement = await screen.findByRole("form", { name: "Next commit" });
    expect(await within(form).findByText("Stage changes to commit them.")).toBeTruthy();
    expect(within(form).getByRole("button", { name: "Commit" }).hasAttribute("disabled")).toBe(true);
  });

  it("prefills amend from HEAD and warns when HEAD is already pushed", async () => {
    renderWithClient(<ChangesView repositoryId={1} />);
    const form: HTMLElement = await screen.findByRole("form", { name: "Next commit" });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("commit_context", { id: 1 }));
    await userEvent.click(within(form).getByRole("checkbox", { name: "Amend the last commit" }));
    expect((within(form).getByPlaceholderText("Summary") as HTMLInputElement).value).toBe("Previous");
    expect(within(form).getByText(/rewrites published history/)).toBeTruthy();
    expect(within(form).getByRole("button", { name: "Amend commit" })).toBeTruthy();
  });

  it("blocks committing without a Git identity", async () => {
    context = { ...context, authorName: null };
    renderWithClient(<ChangesView repositoryId={1} />);
    const form: HTMLElement = await screen.findByRole("form", { name: "Next commit" });
    expect(await within(form).findByText("Set your name and email in Git first.")).toBeTruthy();
  });

  it("composes and splits messages", () => {
    expect(composeMessage("  Title ", "\n")).toBe("Title");
    expect(splitMessage("Title\n\nBody line\n")).toEqual({ summary: "Title", description: "Body line" });
  });
});
