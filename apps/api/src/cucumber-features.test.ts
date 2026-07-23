import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { RepositoryResponse } from "@flawferret2/job-schemas";
import { buildFeatureCatalog, buildFeatureDetail, parseFeatureFile } from "./cucumber-features.js";

const tempRoots: string[] = [];

const createTempRepository = async () => {
  const root = await mkdtemp(join(tmpdir(), "ff2-features-"));
  tempRoots.push(root);
  await mkdir(join(root, "features", "step_definitions"), {
    recursive: true,
  });

  const repository: RepositoryResponse = {
    cloneUrl: "https://github.com/rgmichaels/example.git",
    createdAt: new Date().toISOString(),
    defaultBranch: "main",
    id: "repo-1",
    localPath: root,
    name: "example",
    owner: "rgmichaels",
    provider: "GITHUB",
    trackerIntegration: null,
    trackerIntegrationId: null,
    updatedAt: new Date().toISOString(),
    validationCommand: "pnpm test",
    webUrl: "https://github.com/rgmichaels/example",
  };

  return {
    repository,
    root,
  };
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("cucumber feature catalog", () => {
  it("parses feature names, tags, and scenarios", () => {
    const summary = parseFeatureFile({
      content: [
        "@smoke @login",
        "Feature: Login",
        "  Users sign in.",
        "",
        "  @happy",
        "  Scenario: Valid password",
        "    Given I am on the login page",
        "",
        "  @locked",
        "  Scenario Outline: Locked account",
        "    Given <user> is locked",
      ].join("\n"),
      modifiedAt: new Date("2026-07-20T12:00:00Z"),
      relativePath: "features/login.feature",
    });

    assert.equal(summary.feature, "Login");
    assert.equal(summary.scenarioCount, 2);
    assert.deepEqual(summary.tags, ["@happy", "@locked", "@login", "@smoke"]);
    assert.deepEqual(summary.scenarios.map((scenario) => scenario.name), [
      "Valid password",
      "Locked account",
    ]);
    assert.deepEqual(summary.scenarios[0].steps.map((step) => step.text), ["I am on the login page"]);
  });

  it("builds a catalog from repository feature files", async () => {
    const { repository, root } = await createTempRepository();
    await writeFile(
      join(root, "features", "checkout.feature"),
      ["Feature: Checkout", "", "  Scenario: Pay by card", "    Given I have items"].join("\n"),
    );

    const catalog = await buildFeatureCatalog({
      repository,
    });

    assert.equal(catalog.features.length, 1);
    assert.equal(catalog.features[0].feature, "Checkout");
    assert.equal(catalog.features[0].path, "features/checkout.feature");
    assert.equal(catalog.totalScenarios, 1);
  });

  it("builds feature detail with associated support files", async () => {
    const { repository, root } = await createTempRepository();
    await writeFile(
      join(root, "features", "checkout.feature"),
      [
        "Feature: Checkout",
        "",
        "  Scenario: Pay by card",
        "    Given I have 2 items",
        "    When I pay by card",
        "    Then the order should be confirmed",
      ].join("\n"),
    );
    await writeFile(
      join(root, "features", "step_definitions", "checkout.steps.ts"),
      [
        "import { Given, When } from '@cucumber/cucumber';",
        "",
        "Given('I have {int} items', async () => {});",
        "When(/I pay by card/, async () => {});",
      ].join("\n"),
    );

    const detail = await buildFeatureDetail({
      featurePath: "features/checkout.feature",
      repository,
    });

    assert.ok(detail);
    assert.equal(detail.feature.feature, "Checkout");
    assert.deepEqual(
      detail.associatedFiles.map((file) => file.path),
      ["features/checkout.feature", "features/step_definitions/checkout.steps.ts"],
    );
    assert.equal(detail.feature.scenarios[0].steps[0].matchedDefinition?.path, "features/step_definitions/checkout.steps.ts");
    assert.equal(detail.feature.scenarios[0].steps[1].matchedDefinition?.expression, "/I pay by card/");
    assert.equal(detail.feature.scenarios[0].steps[2].matchedDefinition, null);
    assert.equal(detail.feature.scenarios[0].unmatchedStepCount, 1);
  });

  it("rejects traversal outside the repository", async () => {
    const { repository } = await createTempRepository();

    assert.equal(
      await buildFeatureDetail({
        featurePath: "../outside.feature",
        repository,
      }),
      null,
    );
  });
});
