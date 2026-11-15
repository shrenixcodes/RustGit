import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_DRAFT, useUi } from "./ui";

beforeEach(() => {
  useUi.setState({ commitDrafts: {} });
});

describe("commit drafts", () => {
  it("merges consecutive field updates without losing earlier ones", () => {
    // Two updates issued before any re-render, as when fields change in quick succession.
    useUi.getState().updateCommitDraft(1, { summary: "Title" });
    useUi.getState().updateCommitDraft(1, { description: "Body" });
    expect(useUi.getState().commitDrafts[1]).toEqual({ ...EMPTY_DRAFT, summary: "Title", description: "Body" });
  });

  it("keeps drafts per repository", () => {
    useUi.getState().updateCommitDraft(1, { summary: "one" });
    useUi.getState().updateCommitDraft(2, { summary: "two" });
    expect(useUi.getState().commitDrafts[1]?.summary).toBe("one");
    expect(useUi.getState().commitDrafts[2]?.summary).toBe("two");
  });
});
