import { describe, expect, it } from "vitest";
import type { FileStatus } from "../../services/types";
import { countChanges, splitChanges } from "./changeLabels";

function file(path: string, staged: FileStatus["staged"], unstaged: FileStatus["unstaged"], conflicted = false): FileStatus {
  return { path, originalPath: null, staged, unstaged, conflicted };
}

const files: FileStatus[] = [
  file("both.rs", "modified", "modified"),
  file("staged.rs", "added", null),
  file("new.txt", null, "untracked"),
  file("conflict.txt", null, "unmerged", true),
  file("edited.rs", null, "deleted"),
];

describe("splitChanges", () => {
  it("places partially staged files in both lists and conflicts separately", () => {
    const groups = splitChanges(files);
    expect(groups.staged.map((item) => item.path)).toEqual(["both.rs", "staged.rs"]);
    expect(groups.unstaged.map((item) => item.path)).toEqual(["both.rs", "new.txt", "edited.rs"]);
    expect(groups.conflicted.map((item) => item.path)).toEqual(["conflict.txt"]);
  });
});

describe("countChanges", () => {
  it("counts each category", () => {
    expect(countChanges(files)).toEqual({ staged: 2, unstaged: 2, untracked: 1, conflicted: 1 });
  });
});
