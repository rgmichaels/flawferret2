import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describePostBuildActions, formatPostBuildActions } from "./post-build-summary.js";

describe("formatPostBuildActions", () => {
  it("lists every selected action in build order", () => {
    assert.equal(
      formatPostBuildActions({
        createGithubRepository: true,
        initializeGitRepository: true,
        registerLocalRepository: true,
      }),
      "git init · push to GitHub · register",
    );
  });

  it("omits unselected actions", () => {
    assert.equal(
      formatPostBuildActions({
        createGithubRepository: false,
        initializeGitRepository: true,
        registerLocalRepository: false,
      }),
      "git init",
    );
  });

  it("falls back when nothing is selected", () => {
    assert.equal(
      formatPostBuildActions({
        createGithubRepository: false,
        initializeGitRepository: false,
        registerLocalRepository: false,
      }),
      "Nothing",
    );
  });
});

describe("describePostBuildActions", () => {
  it("reads the live checkbox value rather than the hidden false fallback", () => {
    const formData = new FormData();
    formData.append("initializeGitRepository", "false");
    formData.append("initializeGitRepository", "true");
    formData.append("registerLocalRepository", "false");

    assert.equal(describePostBuildActions(formData), "git init");
  });

  it("treats a checkbox submitted as \"on\" as selected", () => {
    const formData = new FormData();
    formData.append("registerLocalRepository", "on");

    assert.equal(describePostBuildActions(formData), "register");
  });

  it("returns the fallback for an empty form", () => {
    assert.equal(describePostBuildActions(new FormData()), "Nothing");
  });
});
