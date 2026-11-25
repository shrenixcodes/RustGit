import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UseQueryResult } from "@tanstack/react-query";
import type { IpcError } from "../services/ipc";
import type { DiffLine, FileDiff } from "../services/types";
import { ReadOnlyDiff } from "./CommitFold";
import { renderWithClient } from "../test/renderWithClient";

function makeDiff(lineCount: number): UseQueryResult<FileDiff, IpcError> {
  const lines: DiffLine[] = Array.from({ length: lineCount }, (_, index) => ({
    kind: "add",
    content: `line-${index + 1}`,
    oldLine: null,
    newLine: index + 1,
    noNewlineAtEnd: false,
  }));
  return {
    data: {
      path: "big.ts",
      originalPath: null,
      side: "commit",
      status: "modified",
      binary: false,
      tooLarge: false,
      added: lineCount,
      deleted: 0,
      hunks: [{ header: `@@ -0,0 +1,${lineCount} @@`, oldStart: 0, oldLines: 0, newStart: 1, newLines: lineCount, lines }],
    },
    isPending: false,
    isError: false,
  } as unknown as UseQueryResult<FileDiff, IpcError>;
}

describe("ReadOnlyDiff", () => {
  afterEach(() => cleanup());

  it("renders small diffs completely without a disclosure button", () => {
    renderWithClient(<ReadOnlyDiff diff={makeDiff(10)} />);
    expect(screen.getByText("line-1")).toBeTruthy();
    expect(screen.getByText("line-10")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /more lines/i })).toBeNull();
  });

  it("reveals oversized inline diffs progressively to avoid synchronous DOM stalls", async () => {
    renderWithClient(<ReadOnlyDiff diff={makeDiff(650)} />);
    expect(screen.getByText("line-1")).toBeTruthy();
    expect(screen.queryByText("line-600")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Show 401 more lines/i }));
    expect(screen.getByText("line-600")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /more lines/i })).toBeNull();
  });
});
