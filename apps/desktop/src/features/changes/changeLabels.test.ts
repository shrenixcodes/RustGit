import { describe, expect, it } from "vitest";
import type { FileStatus } from "../../services/types";
import { countChanges, isPartiallyStaged, matchesFilter, splitChanges, splitPath } from "./changeLabels";

function file(
  path: string,
  staged: FileStatus["staged"],
  unstaged: FileStatus["unstaged"],
  conflicted = false,
  originalPath: string | null = null,
): FileStatus {
  return { path, originalPath, staged, unstaged, conflicted };
}

const files: FileStatus[] = [
  file("both.rs", "modified", "modified"),
  file("staged.rs", "added", null),
  file("new.txt", null, "untracked"),
  file("conflict.txt", null, "unmerged", true),
  file("edited.rs", null, "deleted"),
];

describe("splitChanges", () => {
  it("separates conflicted, staged, unstaged and untracked files", () => {
    const groups = splitChanges(files);
    expect(groups.staged.map((item) => item.path)).toEqual(["both.rs", "staged.rs"]);
    expect(groups.unstaged.map((item) => item.path)).toEqual(["both.rs", "edited.rs"]);
    expect(groups.untracked.map((item) => item.path)).toEqual(["new.txt"]);
    expect(groups.conflicted.map((item) => item.path)).toEqual(["conflict.txt"]);
  });
});

describe("countChanges", () => {
  it("counts each category", () => {
    expect(countChanges(files)).toEqual({ staged: 2, unstaged: 2, untracked: 1, conflicted: 1 });
  });
});

describe("isPartiallyStaged", () => {
  it("is true only when both the index and the working tree have changes", () => {
    expect(isPartiallyStaged(files[0] as FileStatus)).toBe(true);
    expect(isPartiallyStaged(files[1] as FileStatus)).toBe(false);
    expect(isPartiallyStaged(files[2] as FileStatus)).toBe(false);
    expect(isPartiallyStaged(files[3] as FileStatus)).toBe(false);
    // Added to the index, then deleted from the working tree: still partial.
    expect(isPartiallyStaged(file("gone.rs", "added", "deleted"))).toBe(true);
  });
});

describe("splitPath", () => {
  it("splits name and directory", () => {
    expect(splitPath("src/app/main.rs")).toEqual({ name: "main.rs", directory: "src/app" });
    expect(splitPath("README.md")).toEqual({ name: "README.md", directory: "" });
    expect(splitPath("vendor/lib/")).toEqual({ name: "lib", directory: "vendor" });
  });
});

describe("matchesFilter", () => {
  it("matches every term against the path and the original path", () => {
    const renamed: FileStatus = file("src/new_name.rs", "renamed", null, false, "src/old_name.rs");
    expect(matchesFilter(renamed, "old")).toBe(true);
    expect(matchesFilter(renamed, "SRC new")).toBe(true);
    expect(matchesFilter(renamed, "src missing")).toBe(false);
    expect(matchesFilter(renamed, "  ")).toBe(true);
  });
});
