import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ConflictVersions, FileStatus, StatusSnapshot } from "../services/types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const { ThreadView } = await import("./ThreadView");
const { renderWithClient } = await import("../test/renderWithClient");
const { useWorkspace, LOOSE_END } = await import("../stores/workspace");
const { usePreferences } = await import("../stores/preferences");
const { useUi } = await import("../stores/ui");

// Test fixtures only; production data comes from the backend.
const working = "fn a() {}\n<<<<<<< HEAD\nlet x = 1;\n=======\nlet x = 2;\n>>>>>>> feature\nfn b() {}\n";
const versions: ConflictVersions = {
  base: "fn a() {}\nlet x = 0;\nfn b() {}\n",
  ours: "fn a() {}\nlet x = 1;\nfn b() {}\n",
  theirs: "fn a() {}\nlet x = 2;\nfn b() {}\n",
  working,
  oursLabel: "HEAD (main)",
  theirsLabel: "feature",
  binary: false,
};

let conflicted: boolean;
let resolveKeepsConflict: boolean;

function status(): StatusSnapshot {
  const files: FileStatus[] = [{ path: "src/lib.rs", originalPath: null, staged: null, unstaged: "unmerged", conflicted }];
  return { branch: { head: "main", oid: "a".repeat(40), upstream: null, ahead: 0, behind: 0 }, files: conflicted ? files : [], inProgress: "merging" };
}

beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 1440;
  usePreferences.setState({ zoom: "thread" });
  useUi.setState({ search: "", commitDrafts: {} });
  useWorkspace.setState({ activeRepositoryId: 1, activeRepositoryPath: "D:/x", focus: LOOSE_END, unfolded: LOOSE_END, selectedChange: null });
  conflicted = true;
  resolveKeepsConflict = false;
  invokeMock.mockImplementation(async (command: string) => {
    switch (command) {
      case "repository_status":
        return status();
      case "list_refs":
        return { head: { kind: "branch", name: "main" }, refs: [] };
      case "log_page":
        return { commits: [], hasMore: false };
      case "change_totals":
        return { files: [], added: 0, deleted: 0 };
      case "commit_context":
        return { authorName: "Ada", authorEmail: "a@x", signing: "off", head: null, inProgress: "merging" };
      case "conflict_versions":
        return versions;
      case "resolve_conflict":
        if (!resolveKeepsConflict) conflicted = false;
        return status();
      case "abort_operation":
        return { ...status(), inProgress: "none" };
      default:
        throw { kind: "internal", message: command };
    }
  });
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

async function openResolver(): Promise<HTMLElement> {
  renderWithClient(<ThreadView repositoryId={1} />);
  const fold: HTMLElement = await screen.findByRole("group", { name: "Uncommitted changes" });
  await userEvent.click(await within(fold).findByRole("button", { name: "Resolve…" }));
  await within(fold).findByText("HEAD (main)");
  return fold;
}

describe("conflict resolution", () => {
  it("names ours and theirs, and keeps continuing disabled while conflicts remain", async () => {
    const fold: HTMLElement = await openResolver();
    expect(within(fold).getAllByText("feature").length).toBeGreaterThan(0);
    expect(within(fold).getByText(/Ours is your current branch; theirs is the branch being merged in/)).toBeTruthy();
    expect(within(fold).getByText("1 of 1 conflict left")).toBeTruthy();
    expect(within(fold).getByRole("button", { name: "Continue the merge" }).hasAttribute("disabled")).toBe(true);
  });

  it("assembles the chosen side and verifies Git's answer before closing", async () => {
    const fold: HTMLElement = await openResolver();
    await userEvent.click(within(fold).getByRole("radio", { name: "Theirs" }));
    const result = within(fold).getByRole("textbox", { name: "Resolved file content" }) as HTMLTextAreaElement;
    expect(result.value).toBe("fn a() {}\nlet x = 2;\nfn b() {}\n");
    await userEvent.click(within(fold).getByRole("button", { name: "Mark resolved" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("resolve_conflict", { id: 1, path: "src/lib.rs", content: "fn a() {}\nlet x = 2;\nfn b() {}\n", take: null }),
    );
    // Git no longer reports the file as conflicted: the resolver closes and Continue is enabled.
    await waitFor(() => expect(within(fold).queryByRole("textbox", { name: "Resolved file content" })).toBeNull());
    expect(within(fold).getByRole("button", { name: "Continue the merge" }).hasAttribute("disabled")).toBe(false);
  });

  it("asks before marking a result that still contains conflict markers", async () => {
    const fold: HTMLElement = await openResolver();
    await userEvent.click(within(fold).getByRole("button", { name: "Mark resolved" }));
    const dialog: HTMLElement = await screen.findByRole("dialog", { name: "The result still contains conflict markers" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(invokeMock).not.toHaveBeenCalledWith("resolve_conflict", expect.anything());
  });

  it("does not claim success when Git still reports the conflict", async () => {
    resolveKeepsConflict = true;
    const fold: HTMLElement = await openResolver();
    await userEvent.click(within(fold).getByRole("radio", { name: "Ours" }));
    await userEvent.click(within(fold).getByRole("button", { name: "Mark resolved" }));
    expect((await within(fold).findByRole("alert")).textContent).toContain("Git still reports src/lib.rs as conflicted");
  });

  it("edits a block by hand and takes a whole side", async () => {
    const fold: HTMLElement = await openResolver();
    await userEvent.click(within(fold).getByRole("radio", { name: "Edit" }));
    const block = within(fold).getByRole("textbox", { name: "Edited text for conflict 1" }) as HTMLTextAreaElement;
    expect(block.value).toBe("let x = 1;\nlet x = 2;\n");
    await userEvent.clear(block);
    await userEvent.type(block, "let x = 3;");
    expect((within(fold).getByRole("textbox", { name: "Resolved file content" }) as HTMLTextAreaElement).value).toBe(
      "fn a() {}\nlet x = 3;fn b() {}\n",
    );
    await userEvent.click(within(fold).getByRole("button", { name: "Take ours for the whole file" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("resolve_conflict", { id: 1, path: "src/lib.rs", content: null, take: "ours" }));
  });

  it("aborts the merge only after confirmation", async () => {
    const fold: HTMLElement = await openResolver();
    await userEvent.click(within(fold).getByRole("button", { name: "Abort…" }));
    const dialog: HTMLElement = await screen.findByRole("dialog", { name: "Abort the merge?" });
    expect(dialog.textContent).toContain("Conflict resolutions made so far are discarded");
    await userEvent.click(within(dialog).getByRole("button", { name: "Abort the merge" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("abort_operation", { id: 1 }));
  });
});
