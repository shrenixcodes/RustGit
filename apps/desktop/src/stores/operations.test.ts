import { beforeEach, describe, expect, it } from "vitest";
import { describeProgress, runningOperations, useOperations } from "./operations";

beforeEach(() => useOperations.setState({ operations: {} }));

describe("operations store", () => {
  it("tracks an operation from start to finish with real progress only", () => {
    const store = useOperations.getState();
    store.started({ operationId: "op1", kind: "fetch", label: "Fetch origin", repositoryId: 2 }, 1000);
    let op = useOperations.getState().operations.op1;
    expect(op && describeProgress(op)).toBe("starting…");
    expect(op?.cancellable).toBe(true);
    useOperations.getState().progressed("op1", "Receiving objects", { current: 412, total: 1024 });
    op = useOperations.getState().operations.op1;
    expect(op && describeProgress(op)).toBe(`Receiving objects 412/${(1024).toLocaleString()}`);
    useOperations.getState().progressed("op1", "Resolving deltas", null);
    op = useOperations.getState().operations.op1;
    expect(op && describeProgress(op)).toBe("Resolving deltas");
    useOperations.getState().finished("op1", "succeeded", null, 1500);
    op = useOperations.getState().operations.op1;
    expect(op).toMatchObject({ outcome: "succeeded", finishedAt: 1500, cancellable: false });
  });

  it("ignores events after an operation finished", () => {
    useOperations.getState().started({ operationId: "op1", kind: "push", label: "Push", repositoryId: 1 });
    expect(useOperations.getState().operations.op1?.cancellable).toBe(false);
    useOperations.getState().finished("op1", "failed", { kind: "authentication_failed", message: "denied" });
    useOperations.getState().progressed("op1", "late", null);
    useOperations.getState().finished("op1", "succeeded", null);
    expect(useOperations.getState().operations.op1).toMatchObject({ outcome: "failed", phase: null });
  });

  it("lists running operations for a repository, oldest first", () => {
    const store = useOperations.getState();
    store.started({ operationId: "b", kind: "fetch", label: "b", repositoryId: 1 }, 2);
    store.started({ operationId: "a", kind: "pull", label: "a", repositoryId: 1 }, 1);
    store.started({ operationId: "c", kind: "fetch", label: "c", repositoryId: 2 }, 3);
    expect(runningOperations(useOperations.getState().operations, 1).map((op) => op.operationId)).toEqual(["a", "b"]);
  });
});
