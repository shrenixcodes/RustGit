import { beforeEach, describe, expect, it } from "vitest";
import { lastActiveRepositoryPath, useWorkspace } from "./workspace";

beforeEach(() => {
  localStorage.clear();
  useWorkspace.setState({
    activeRepositoryId: null,
    activeRepositoryPath: null,
    section: "repositories",
    lastSectionByRepository: {},
    selectedChange: null,
  });
});

describe("workspace store", () => {
  it("remembers the last section per repository path", () => {
    const { openRepository, showSection } = useWorkspace.getState();
    openRepository(1, "D:/code/alpha");
    showSection("changes");
    openRepository(2, "D:/code/beta");
    expect(useWorkspace.getState().section).toBe("overview");
    openRepository(1, "D:/code/alpha");
    expect(useWorkspace.getState().section).toBe("changes");
  });

  it("does not apply a remembered section to a different repository with the same id", () => {
    // Another data directory can reuse id 1 for an unrelated repository.
    useWorkspace.getState().openRepository(1, "D:/code/alpha");
    useWorkspace.getState().showSection("changes");
    useWorkspace.getState().openRepository(1, "C:/tmp/other");
    expect(useWorkspace.getState().section).toBe("overview");
  });

  it("persists the active path, not the id, for restoring at startup", () => {
    useWorkspace.getState().openRepository(5, "D:/code/alpha");
    expect(lastActiveRepositoryPath()).toBe("D:/code/alpha");
    const stored: string = localStorage.getItem("rustgit.workspace") ?? "";
    expect(stored).not.toContain('"lastRepositoryId"');
  });

  it("clears the selection when switching repositories", () => {
    useWorkspace.getState().openRepository(1, "D:/code/alpha");
    useWorkspace.getState().selectChange({ path: "a.txt", side: "unstaged" });
    useWorkspace.getState().openRepository(2, "D:/code/beta");
    expect(useWorkspace.getState().selectedChange).toBeNull();
  });

  it("ignores corrupted stored data", () => {
    localStorage.setItem("rustgit.workspace", "{not json");
    expect(lastActiveRepositoryPath()).toBeNull();
  });
});
