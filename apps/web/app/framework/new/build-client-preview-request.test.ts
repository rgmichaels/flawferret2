import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildClientPreviewRequest } from "./build-client-preview-request.js";

describe("buildClientPreviewRequest", () => {
  it("applies the same defaults as the server for an empty form", () => {
    const formData = new FormData();
    const request = buildClientPreviewRequest(formData);

    assert.deepEqual(request, {
      baseUrl: "https://example.com",
      destinationType: "local",
      features: [],
      githubBranch: "main",
      githubOwner: "",
      githubRepositoryId: "",
      githubRepository: "",
      packageName: "playwright-cucumber-tests",
      projectName: "Playwright Cucumber Tests",
      targetDirectory: "qa/e2e",
    });
  });

  it("reads live values out of the form instead of falling back to defaults", () => {
    const formData = new FormData();
    formData.set("projectName", "My New Framework");
    formData.set("packageName", "my-new-framework");
    formData.set("baseUrl", "https://staging.example.com");
    formData.set("targetDirectory", "custom/dir");
    formData.append("features", "pageObjects");
    formData.append("features", "apiTesting");

    const request = buildClientPreviewRequest(formData);

    assert.equal(request.projectName, "My New Framework");
    assert.equal(request.packageName, "my-new-framework");
    assert.equal(request.baseUrl, "https://staging.example.com");
    assert.equal(request.targetDirectory, "custom/dir");
    assert.deepEqual(request.features, ["pageObjects", "apiTesting"]);
  });

  it("drops unknown feature values", () => {
    const formData = new FormData();
    formData.append("features", "pageObjects");
    formData.append("features", "notARealFeature");

    const request = buildClientPreviewRequest(formData);

    assert.deepEqual(request.features, ["pageObjects"]);
  });

  it("defaults targetDirectory to '.' for the github destination instead of qa/e2e", () => {
    const formData = new FormData();
    formData.set("destinationType", "github");

    const request = buildClientPreviewRequest(formData);

    assert.equal(request.destinationType, "github");
    assert.equal(request.targetDirectory, ".");
  });

  it("respects an explicit targetDirectory even for the github destination", () => {
    const formData = new FormData();
    formData.set("destinationType", "github");
    formData.set("targetDirectory", "qa/e2e");

    const request = buildClientPreviewRequest(formData);

    assert.equal(request.targetDirectory, "qa/e2e");
  });

  it("reads the live github fields when the destination is github", () => {
    const formData = new FormData();
    formData.set("destinationType", "github");
    formData.set("githubOwner", "rgmichaels");
    formData.set("githubRepository", "playwright-cucumber-tests");
    formData.set("githubBranch", "develop");
    formData.set("githubRepositoryId", "repo-123");

    const request = buildClientPreviewRequest(formData);

    assert.equal(request.githubOwner, "rgmichaels");
    assert.equal(request.githubRepository, "playwright-cucumber-tests");
    assert.equal(request.githubBranch, "develop");
    assert.equal(request.githubRepositoryId, "repo-123");
  });

  it("falls back to the project name for the package name when packageName is blank", () => {
    const formData = new FormData();
    formData.set("projectName", "My App!");

    const request = buildClientPreviewRequest(formData);

    assert.equal(request.packageName, "my-app");
  });
});
