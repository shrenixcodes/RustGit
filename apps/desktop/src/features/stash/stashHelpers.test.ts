import { describe, expect, it } from "vitest";
import { outcomeMessage, stashLabel } from "./StashesView";
import { worktreeTitle } from "../worktrees/WorktreesView";
import type { StatusSnapshot, Worktree } from "../../services/types";

const status = {} as StatusSnapshot;
const base: Worktree = { path: "/w", head: "abcdef1234", branch: "refs/heads/topic", isMain: false, detached: false, bare: false, locked: null, prunable: null };

describe("stash helpers", () => {
  it("labels stashes by position", () => {
    expect(stashLabel({ index: 2, oid: "x", message: "m", createdAt: 0 })).toBe("stash@{2}");
  });

  it("reports conflicts after applying", () => {
    expect(outcomeMessage({ kind: "integration", result: { outcome: "conflicts", conflicted: ["a", "b"], status } })).toContain("2 file(s)");
    expect(outcomeMessage({ kind: "integration", result: { outcome: "completed", conflicted: [], status } })).toBe("Applied to the working tree.");
    expect(outcomeMessage({ kind: "stashes", stashes: [] })).toBeNull();
  });
});

describe("worktreeTitle", () => {
  it("names the branch, detached HEAD or bare repository", () => {
    expect(worktreeTitle(base)).toBe("topic");
    expect(worktreeTitle({ ...base, detached: true, branch: null })).toBe("detached at abcdef1");
    expect(worktreeTitle({ ...base, bare: true })).toBe("bare");
  });
});
