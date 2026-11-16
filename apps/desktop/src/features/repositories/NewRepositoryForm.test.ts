import { describe, expect, it } from "vitest";
import { folderNameProblem, newRepositoryPath } from "./NewRepositoryForm";

describe("new repository helpers", () => {
  it("accepts ordinary names and rejects unusable ones", () => {
    expect(folderNameProblem("my-project")).toBeNull();
    expect(folderNameProblem("")).toBeNull();
    expect(folderNameProblem("..")).not.toBeNull();
    expect(folderNameProblem("a/b")).not.toBeNull();
    expect(folderNameProblem("a\\b")).not.toBeNull();
    expect(folderNameProblem("name.")).not.toBeNull();
  });

  it("joins the parent folder and name with the parent's separator", () => {
    expect(newRepositoryPath("C:\\code\\", " app ")).toBe("C:\\code\\app");
    expect(newRepositoryPath("/home/me", "app")).toBe("/home/me/app");
  });
});
