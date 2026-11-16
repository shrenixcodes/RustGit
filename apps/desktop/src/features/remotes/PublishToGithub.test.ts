import { describe, expect, it } from "vitest";
import { filterGithubRepositories } from "../repositories/GithubRepositoryPicker";
import { githubNameProblem } from "./PublishToGithub";

describe("GitHub helpers", () => {
  it("validates repository names", () => {
    expect(githubNameProblem("my-repo_1.0")).toBeNull();
    expect(githubNameProblem("")).toBeNull();
    expect(githubNameProblem("has space")).not.toBeNull();
    expect(githubNameProblem("a/b")).not.toBeNull();
    expect(githubNameProblem("..")).not.toBeNull();
  });

  it("filters repositories by name and description", () => {
    const repositories = [
      { fullName: "me/rustgit", description: "A Git client", private: false, cloneUrl: "https://github.com/me/rustgit.git" },
      { fullName: "me/notes", description: null, private: true, cloneUrl: "https://github.com/me/notes.git" },
    ];
    expect(filterGithubRepositories(repositories, "")).toHaveLength(2);
    expect(filterGithubRepositories(repositories, "GIT").map((r) => r.fullName)).toEqual(["me/rustgit"]);
    expect(filterGithubRepositories(repositories, "notes").map((r) => r.fullName)).toEqual(["me/notes"]);
  });
});
