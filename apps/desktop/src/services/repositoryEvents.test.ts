import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateForChange } from "./repositoryEvents";

function invalidatedKeys(scopes: Parameters<typeof invalidateForChange>[1]["scopes"]): unknown[] {
  const client: QueryClient = new QueryClient();
  const spy = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  invalidateForChange(client, { repositoryId: 4, scopes });
  return spy.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);
}

describe("invalidateForChange", () => {
  it("refreshes status, diffs and totals for working tree changes", () => {
    expect(invalidatedKeys(["worktree"])).toEqual([
      ["repositories", 4, "status"],
      ["repositories", 4, "diff"],
      ["repositories", 4, "totals"],
    ]);
  });

  it("refreshes refs and history for reference changes", () => {
    expect(invalidatedKeys(["refs"])).toEqual([
      ["repositories", 4, "refs"],
      ["repositories", 4, "log"],
      ["repositories", 4, "stashes"],
      ["repositories", 4, "worktrees"],
    ]);
  });

  it("refreshes everything affected when HEAD moves", () => {
    expect(invalidatedKeys(["head"])).toEqual([
      ["repositories", 4, "status"],
      ["repositories", 4, "diff"],
      ["repositories", 4, "totals"],
      ["repositories", 4, "commit-context"],
      ["repositories", 4, "refs"],
      ["repositories", 4, "log"],
      ["repositories", 4, "stashes"],
      ["repositories", 4, "worktrees"],
    ]);
  });

  it("refreshes commit identity, refs and remotes for config changes", () => {
    expect(invalidatedKeys(["config"])).toEqual([
      ["repositories", 4, "commit-context"],
      ["repositories", 4, "refs"],
      ["repositories", 4, "remotes"],
    ]);
  });

  it("refreshes commit context only once when HEAD and config change together", () => {
    expect(invalidatedKeys(["head", "config"]).filter(
      (key) => JSON.stringify(key) === JSON.stringify(["repositories", 4, "commit-context"]),
    )).toHaveLength(1);
  });
});
