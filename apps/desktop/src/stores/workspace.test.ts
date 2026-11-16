import { beforeEach, describe, expect, it } from "vitest";
import { LOOSE_END, commitNode, lastActiveRepositoryPath, mapNode, oidOf, useWorkspace } from "./workspace";

beforeEach(() => {
  localStorage.clear();
  useWorkspace.setState({ activeRepositoryId: null, activeRepositoryPath: null, focus: null, unfolded: null, selectedChange: null });
});

describe("workspace store", () => {
  it("opens a repository at its loose end with nothing unfolded", () => {
    useWorkspace.getState().openRepository(1, "D:/code/alpha");
    expect(useWorkspace.getState()).toMatchObject({ activeRepositoryId: 1, focus: LOOSE_END, unfolded: null });
  });

  it("keeps focus and unfolding when the same repository is opened again", () => {
    useWorkspace.getState().openRepository(1, "D:/code/alpha");
    useWorkspace.getState().toggleUnfold(commitNode("abc"));
    useWorkspace.getState().openRepository(1, "D:/code/alpha");
    expect(useWorkspace.getState().unfolded).toBe(commitNode("abc"));
  });

  it("unfolds one node at a time and folds it again", () => {
    const { toggleUnfold } = useWorkspace.getState();
    toggleUnfold(LOOSE_END);
    expect(useWorkspace.getState().unfolded).toBe(LOOSE_END);
    toggleUnfold(commitNode("abc"));
    expect(useWorkspace.getState()).toMatchObject({ unfolded: commitNode("abc"), focus: commitNode("abc") });
    toggleUnfold(commitNode("abc"));
    expect(useWorkspace.getState().unfolded).toBeNull();
  });

  it("resets the thread position when switching repositories", () => {
    useWorkspace.getState().openRepository(1, "D:/code/alpha");
    useWorkspace.getState().toggleUnfold(commitNode("abc"));
    useWorkspace.getState().selectChange({ path: "a.txt", side: "unstaged" });
    useWorkspace.getState().openRepository(2, "D:/code/beta");
    expect(useWorkspace.getState()).toMatchObject({ focus: LOOSE_END, unfolded: null, selectedChange: null });
  });

  it("persists the active path, never the id", () => {
    useWorkspace.getState().openRepository(5, "D:/code/alpha");
    expect(lastActiveRepositoryPath()).toBe("D:/code/alpha");
    expect(localStorage.getItem("rustgit.workspace")).not.toContain('"activeRepositoryId"');
  });

  it("reads node ids and ignores corrupted storage", () => {
    expect(oidOf(commitNode("abc"))).toBe("abc");
    expect(oidOf(mapNode("def"))).toBe("def");
    expect(oidOf(LOOSE_END)).toBeNull();
    localStorage.setItem("rustgit.workspace", "{not json");
    expect(lastActiveRepositoryPath()).toBeNull();
  });
});
