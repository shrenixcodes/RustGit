import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { AUTO_FETCH_INTERVAL_MS, useAutoFetch } from "./network";
import { ipc } from "./ipc";
import { useOperations } from "../stores/operations";

vi.mock("./ipc", () => ({
  ipc: {
    startFetch: vi.fn().mockResolvedValue({ operationId: "op-fetch-1" }),
  },
  toIpcError: vi.fn((e: unknown) => ({ kind: "internal", message: String(e) })),
}));

describe("useAutoFetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useOperations.setState({ operations: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does nothing when repositoryId is null", () => {
    renderHook(() => useAutoFetch(null));

    vi.advanceTimersByTime(AUTO_FETCH_INTERVAL_MS * 2);
    expect(ipc.startFetch).not.toHaveBeenCalled();
  });

  it("triggers background fetch when active repository is present and not busy", () => {
    renderHook(() => useAutoFetch(42));
    expect(ipc.startFetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(AUTO_FETCH_INTERVAL_MS);
    // Background: no credential prompts, and failures are not flagged.
    expect(ipc.startFetch).toHaveBeenCalledWith(42, null, true, true);
  });

  it("skips auto-fetch when another sync operation is already running", () => {
    // Add a running push operation
    useOperations.getState().started({
      operationId: "op-push-1",
      kind: "push",
      label: "Push main",
      repositoryId: 42,
    });

    renderHook(() => useAutoFetch(42));

    vi.advanceTimersByTime(AUTO_FETCH_INTERVAL_MS);
    expect(ipc.startFetch).not.toHaveBeenCalled();
  });
});
