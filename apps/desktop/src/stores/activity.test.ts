import { beforeEach, describe, expect, it } from "vitest";
import { ACTIVITY_CAPACITY, runningCount, useActivity } from "./activity";

beforeEach(() => {
  useActivity.setState({ operations: [], unseenFailures: 0 });
});

describe("activity store", () => {
  it("records start and success with real timestamps", () => {
    useActivity.getState().started(1, "Open repository", 4, 1000);
    expect(runningCount(useActivity.getState().operations)).toBe(1);
    useActivity.getState().finished(1, null, 1250);
    const [record] = useActivity.getState().operations;
    expect(record).toMatchObject({ outcome: "succeeded", startedAt: 1000, finishedAt: 1250, repositoryId: 4 });
    expect(useActivity.getState().unseenFailures).toBe(0);
  });

  it("counts failures until marked seen", () => {
    useActivity.getState().started(1, "Add repository", null);
    useActivity.getState().finished(1, { kind: "not_a_repository", message: "nope" });
    expect(useActivity.getState().operations[0]?.outcome).toBe("failed");
    expect(useActivity.getState().unseenFailures).toBe(1);
    useActivity.getState().markSeen();
    expect(useActivity.getState().unseenFailures).toBe(0);
  });

  it("logs background failures without flagging them", () => {
    useActivity.getState().started(1, "Fetch all remotes (automatic)", 4, 1000, true);
    useActivity.getState().finished(1, { kind: "authentication_failed", message: "no credentials" });
    expect(useActivity.getState().operations[0]?.outcome).toBe("failed");
    expect(useActivity.getState().unseenFailures).toBe(0);
  });

  it("ignores a second finish for the same operation", () => {
    useActivity.getState().started(1, "Pin", null);
    useActivity.getState().finished(1, null);
    useActivity.getState().finished(1, { kind: "internal", message: "late" });
    expect(useActivity.getState().operations[0]?.outcome).toBe("succeeded");
    expect(useActivity.getState().unseenFailures).toBe(0);
  });

  it("keeps at most the configured number of records, newest first", () => {
    for (let id = 0; id < ACTIVITY_CAPACITY + 5; id += 1) {
      useActivity.getState().started(id, `op ${id}`, null);
    }
    const { operations } = useActivity.getState();
    expect(operations).toHaveLength(ACTIVITY_CAPACITY);
    expect(operations[0]?.label).toBe(`op ${ACTIVITY_CAPACITY + 4}`);
  });

  it("clear keeps running operations", () => {
    useActivity.getState().started(1, "done", null);
    useActivity.getState().finished(1, null);
    useActivity.getState().started(2, "running", null);
    useActivity.getState().clear();
    expect(useActivity.getState().operations.map((record) => record.id)).toEqual([2]);
  });
});
