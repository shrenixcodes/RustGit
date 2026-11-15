import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const { ipc, IpcError, toIpcError } = await import("./ipc");

beforeEach(() => {
  invokeMock.mockReset();
});

describe("ipc", () => {
  it("passes typed arguments to the matching command", async () => {
    invokeMock.mockResolvedValue({ id: 3 });
    await ipc.setRepositoryPinned(3, true);
    expect(invokeMock).toHaveBeenCalledWith("set_repository_pinned", { id: 3, pinned: true });
  });

  it("fills optional contract arguments with null", async () => {
    invokeMock.mockResolvedValue({});
    await ipc.applyHunk({ id: 1, path: "a.rs", side: "unstaged", action: "stage", hunkHeader: "@@ -1 +1 @@" });
    expect(invokeMock).toHaveBeenCalledWith("apply_hunk", {
      id: 1,
      path: "a.rs",
      side: "unstaged",
      action: "stage",
      hunkHeader: "@@ -1 +1 @@",
      lineIndices: null,
    });
    await ipc.fileDiff({ id: 1, path: "a.rs", side: "staged", ignoreWhitespace: false });
    expect(invokeMock).toHaveBeenLastCalledWith("file_diff", {
      id: 1,
      path: "a.rs",
      originalPath: null,
      side: "staged",
      ignoreWhitespace: false,
    });
  });

  it("converts backend command errors into IpcError with the same kind", async () => {
    invokeMock.mockRejectedValue({ kind: "not_a_repository", message: "'/x' is not inside a Git repository." });
    const error: unknown = await ipc.addRepository("/x").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IpcError);
    expect((error as InstanceType<typeof IpcError>).kind).toBe("not_a_repository");
  });

  it("maps unknown failures to the internal kind", () => {
    expect(toIpcError("boom").kind).toBe("internal");
    expect(toIpcError(new Error("bad")).message).toBe("bad");
  });
});
