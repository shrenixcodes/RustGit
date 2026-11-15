import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import type { StatusSnapshot } from "../../services/types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const { OverviewView } = await import("./OverviewView");
const { renderWithClient } = await import("../../test/renderWithClient");

let status: StatusSnapshot;

beforeEach(() => {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "list_repositories") {
      return [{ id: 1, name: "demo", path: "D:/demo", pinned: false, addedAt: 1, lastOpenedAt: 1 }];
    }
    if (command === "repository_status") {
      return status;
    }
    throw { kind: "internal", message: command };
  });
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("OverviewView", () => {
  it("reports a clean tree on a tracking branch without attention notes", async () => {
    status = { branch: { head: "main", oid: "0123456789abcdef", upstream: "origin/main", ahead: 0, behind: 0 }, files: [] };
    renderWithClient(<OverviewView repositoryId={1} />);
    expect(await screen.findByText("Working tree clean. Nothing to commit.")).toBeTruthy();
    expect(screen.getByText("0123456789ab")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Attention" })).toBeNull();
  });

  it("explains conflicts, a detached HEAD and a diverged branch from real status", async () => {
    status = {
      branch: { head: null, oid: "abc", upstream: "origin/main", ahead: 2, behind: 3 },
      files: [{ path: "x.txt", originalPath: null, staged: null, unstaged: "unmerged", conflicted: true }],
    };
    renderWithClient(<OverviewView repositoryId={1} />);
    const attention: HTMLElement = await screen.findByRole("region", { name: "Attention" });
    expect(attention.textContent).toContain("1 file has merge conflicts");
    expect(attention.textContent).toContain("HEAD is detached");
    expect(attention.textContent).toContain("diverged");
    expect(within(screen.getByRole("region", { name: "Head" })).getByText("Detached HEAD")).toBeTruthy();
  });

  it("does not call an unborn branch detached", async () => {
    status = { branch: { head: "main", oid: null, upstream: null, ahead: 0, behind: 0 }, files: [] };
    renderWithClient(<OverviewView repositoryId={1} />);
    expect(await screen.findByText("No commits yet")).toBeTruthy();
    expect(screen.queryByText(/HEAD is detached/)).toBeNull();
  });
});
