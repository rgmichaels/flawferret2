import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import type { RepositoryResponse } from "@flawferret2/job-schemas";
import {
  buildFeatureCatalog,
  buildFeatureDetail,
  markDuplicateScenarioIds,
  parseFeatureFile,
} from "./cucumber-features.js";

const tempRoots: string[] = [];

const createTempRepository = async () => {
  const root = await mkdtemp(join(tmpdir(), "ff2-features-"));
  tempRoots.push(root);
  await mkdir(join(root, "features", "step_definitions"), {
    recursive: true,
  });

  const repository: RepositoryResponse = {
    baseUrl: null,
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

  it("accumulates consecutive tag lines above a scenario", () => {
    const summary = parseFeatureFile({
      content: [
        "Feature: Login",
        "",
        "  @a",
        "  @b @c",
        "  Scenario: Valid password",
        "    Given I am on the login page",
      ].join("\n"),
      modifiedAt: new Date("2026-07-20T12:00:00Z"),
      relativePath: "features/login.feature",
    });

    assert.deepEqual(summary.scenarios[0].tags, ["@a", "@b", "@c"]);
  });

  it("does not leak tags above an Examples block onto the next scenario", () => {
    const summary = parseFeatureFile({
      content: [
        "Feature: Login",
        "",
        "  @outline",
        "  Scenario Outline: Locked account",
        "    Given <user> is locked",
        "",
        "    @example-tag",
        "    Examples:",
        "      | user  |",
        "      | alice |",
        "",
        "  Scenario: Valid password",
        "    Given I am on the login page",
      ].join("\n"),
      modifiedAt: new Date("2026-07-20T12:00:00Z"),
      relativePath: "features/login.feature",
    });

    assert.equal(summary.scenarioCount, 2);
    assert.deepEqual(summary.scenarios[0].tags, ["@outline"]);
    assert.deepEqual(summary.scenarios[1].tags, []);
  });

  it("does not leak tags above Rule or Background onto the next scenario", () => {
    const summary = parseFeatureFile({
      content: [
        "Feature: Login",
        "",
        "  @background-tag",
        "  Background:",
        "    Given the app is running",
        "",
        "  @rule-tag",
        "  Rule: Passwords",
        "",
        "    Scenario: Valid password",
        "      Given I am on the login page",
      ].join("\n"),
      modifiedAt: new Date("2026-07-20T12:00:00Z"),
      relativePath: "features/login.feature",
    });

    assert.equal(summary.scenarioCount, 1);
    assert.deepEqual(summary.scenarios[0].tags, []);
  });

  it("keeps single-line scenario tags and does not attach feature tags to scenarios", () => {
    const summary = parseFeatureFile({
      content: [
        "@smoke",
        "Feature: Login",
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

    assert.deepEqual(summary.scenarios[0].tags, ["@happy"]);
    assert.equal(summary.scenarios[1].keyword, "Scenario Outline");
    assert.deepEqual(summary.scenarios[1].tags, ["@locked"]);
    assert.deepEqual(summary.tags, ["@happy", "@locked", "@smoke"]);
  });

  it("does not attach feature-level tags to an untagged first scenario", () => {
    const summary = parseFeatureFile({
      content: ["@smoke", "Feature: Login", "", "  Scenario: Valid password", "    Given I am on the login page"].join(
        "\n",
      ),
      modifiedAt: new Date("2026-07-20T12:00:00Z"),
      relativePath: "features/login.feature",
    });

    assert.deepEqual(summary.scenarios[0].tags, []);
    assert.deepEqual(summary.tags, ["@smoke"]);
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

  it("uses step definitions when computing catalog unmatched counts", async () => {
    const { repository, root } = await createTempRepository();
    await writeFile(
      join(root, "features", "checkout.feature"),
      [
        "Feature: Checkout",
        "",
        "  Scenario: Pay by card",
        "    Given I have 2 items",
        "    And the \"Checkout\" example initially returns a transient server error",
        "    Then the Add/Remove Elements page should load",
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
        "Given(",
        "  'the {string} example initially returns a transient server error',",
        "  async () => {}",
        ");",
        "Then('the Add\\\\/Remove Elements page should load', async () => {});",
        "When(/I pay by card/, async () => {});",
      ].join("\n"),
    );

    const catalog = await buildFeatureCatalog({
      repository,
    });

    assert.equal(catalog.features[0].scenarios[0].unmatchedStepCount, 1);
    assert.equal(catalog.features[0].scenarios[0].steps[0].matchedDefinition?.path, "features/step_definitions/checkout.steps.ts");
    assert.equal(catalog.features[0].scenarios[0].steps[1].matchedDefinition?.path, "features/step_definitions/checkout.steps.ts");
    assert.equal(catalog.features[0].scenarios[0].steps[2].matchedDefinition?.path, "features/step_definitions/checkout.steps.ts");
    assert.equal(catalog.features[0].scenarios[0].steps[3].matchedDefinition?.path, "features/step_definitions/checkout.steps.ts");
    assert.equal(catalog.features[0].scenarios[0].steps[4].matchedDefinition, null);
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

const parse = (lines: string[], options: { relativePath?: string; scenarioIdPattern?: RegExp | string } = {}) =>
  parseFeatureFile({
    content: lines.join("\n"),
    modifiedAt: new Date("2026-07-20T12:00:00Z"),
    relativePath: options.relativePath ?? "features/login.feature",
    scenarioIdPattern: options.scenarioIdPattern,
  });

const sha1 = (value: string) => createHash("sha1").update(value).digest("hex");

describe("cucumber scenario identity", () => {
  it("reads the ID from a scenario's own tag without the leading @", () => {
    const summary = parse([
      "Feature: Login",
      "",
      "  @smoke",
      "  @ff-8f3a2c",
      "  Scenario: Valid password",
      "    Given I am on the login page",
    ]);
    const [scenario] = summary.scenarios;

    assert.equal(scenario.id, "ff-8f3a2c");
    assert.equal(scenario.idSource, "tag");
    assert.equal(scenario.idConflict, false);
    assert.deepEqual(scenario.tags, ["@smoke", "@ff-8f3a2c"]);
    assert.match(scenario.fingerprint, /^[0-9a-f]{40}$/);
  });

  it("accepts ID patterns written with or without the leading @", () => {
    const lines = ["Feature: Login", "", "  @ff-8f3a2c", "  Scenario: Valid password", "    Given I am on the login page"];

    assert.equal(parse(lines, { scenarioIdPattern: "^@ff-[0-9a-f]{6,8}$" }).scenarios[0].id, "ff-8f3a2c");
    assert.equal(parse(lines, { scenarioIdPattern: "ff-[0-9a-f]{6,8}" }).scenarios[0].id, "ff-8f3a2c");
    assert.equal(parse(lines, { scenarioIdPattern: /^ff-[0-9a-f]{6,8}$/ }).scenarios[0].id, "ff-8f3a2c");
  });

  it("falls back to a deterministic path + name fingerprint for untagged scenarios", () => {
    const lines = ["Feature: Login", "", "  @smoke", "  Scenario:  Valid   Password ", "    Given I am on the login page"];
    const first = parse(lines).scenarios[0];
    const second = parse(lines).scenarios[0];
    const renamedSteps = parse([
      "Feature: Login",
      "",
      "  Scenario: valid password",
      "    Given something else entirely",
    ]).scenarios[0];
    const otherFile = parse(lines, { relativePath: "features/other.feature" }).scenarios[0];

    assert.equal(first.id, null);
    assert.equal(first.idSource, "fingerprint");
    assert.equal(first.idConflict, false);
    assert.equal(first.fingerprint, sha1("features/login.feature\0valid password"));
    assert.equal(second.fingerprint, first.fingerprint);
    assert.equal(renamedSteps.fingerprint, first.fingerprint);
    assert.notEqual(otherFile.fingerprint, first.fingerprint);
  });

  it("disambiguates same-name scenarios in one file by steps, then by order", () => {
    const summary = parse([
      "Feature: Login",
      "",
      "  Scenario: Valid password",
      "    Given I am on the login page",
      "",
      "  Scenario: Valid password",
      "    Given I am on the signup page",
      "",
      "  Scenario: valid  password",
      "    Given I am on the signup page",
      "",
      "  Scenario: Unique",
      "    Given I am on the login page",
    ]);
    const fingerprints = summary.scenarios.map((scenario) => scenario.fingerprint);

    assert.equal(new Set(fingerprints).size, 4);
    assert.equal(fingerprints[3], sha1("features/login.feature\0unique"));
    assert.notEqual(fingerprints[0], sha1("features/login.feature\0valid password"));
    assert.deepEqual(
      parse([
        "Feature: Login",
        "",
        "  Scenario: Valid password",
        "    Given I am on the login page",
        "",
        "  Scenario: Valid password",
        "    Given I am on the signup page",
        "",
        "  Scenario: valid  password",
        "    Given I am on the signup page",
        "",
        "  Scenario: Unique",
        "    Given I am on the login page",
      ]).scenarios.map((scenario) => scenario.fingerprint),
      fingerprints,
    );
  });

  it("ignores malformed ID tags", () => {
    const summary = parse([
      "Feature: Login",
      "",
      "  @ff-XYZ123",
      "  Scenario: Uppercase",
      "    Given a step",
      "",
      "  @ff-12345",
      "  Scenario: Too short",
      "    Given a step",
      "",
      "  @ff-123456789",
      "  Scenario: Too long",
      "    Given a step",
    ]);

    summary.scenarios.forEach((scenario) => {
      assert.equal(scenario.id, null);
      assert.equal(scenario.idSource, "fingerprint");
      assert.equal(scenario.idConflict, false);
    });
  });

  it("flags a scenario with multiple ID tags as a conflict and uses none", () => {
    const summary = parse([
      "Feature: Login",
      "",
      "  @ff-aaaaaa",
      "  @ff-bbbbbb",
      "  Scenario: Two IDs",
      "    Given a step",
      "",
      "  @ff-cccccc @ff-cccccc",
      "  Scenario: Same ID repeated",
      "    Given a step",
    ]);

    assert.equal(summary.scenarios[0].id, null);
    assert.equal(summary.scenarios[0].idSource, "fingerprint");
    assert.equal(summary.scenarios[0].idConflict, true);
    assert.equal(summary.scenarios[1].id, "ff-cccccc");
    assert.equal(summary.scenarios[1].idConflict, false);
  });

  it("supports a custom ID pattern", () => {
    const lines = [
      "Feature: Login",
      "",
      "  @TC-123",
      "  Scenario: Custom",
      "    Given a step",
      "",
      "  @ff-8f3a2c",
      "  Scenario: Default style",
      "    Given a step",
    ];
    const summary = parse(lines, { scenarioIdPattern: /^@TC-\d+$/ });

    assert.equal(summary.scenarios[0].id, "TC-123");
    assert.equal(summary.scenarios[0].idSource, "tag");
    assert.equal(summary.scenarios[1].id, null);
    assert.equal(parse(lines).scenarios[0].id, null);
    assert.equal(parse(lines, { scenarioIdPattern: "@TC-\\d+" }).scenarios[0].id, "TC-123");
  });

  it("falls back to the default pattern when a string pattern is invalid", () => {
    const summary = parse(["Feature: Login", "", "  @ff-8f3a2c", "  Scenario: Valid", "    Given a step"], {
      scenarioIdPattern: "(",
    });

    assert.equal(summary.scenarios[0].id, "ff-8f3a2c");
  });

  it("ignores an ID tag on the Feature line", () => {
    const summary = parse([
      "@ff-8f3a2c",
      "Feature: Login",
      "",
      "  Scenario: Valid password",
      "    Given I am on the login page",
    ]);

    assert.equal(summary.scenarios[0].id, null);
    assert.equal(summary.scenarios[0].idSource, "fingerprint");
    assert.deepEqual(summary.tags, ["@ff-8f3a2c"]);
  });

  it("uses the outline's ID and ignores ID tags above Examples or Rule", () => {
    const summary = parse([
      "Feature: Login",
      "",
      "  @ff-aaaaaa",
      "  Scenario Outline: Locked account",
      "    Given <user> is locked",
      "",
      "    @ff-bbbbbb",
      "    Examples:",
      "      | user  |",
      "      | alice |",
      "",
      "  Scenario: Valid password",
      "    Given I am on the login page",
      "",
      "  @ff-cccccc",
      "  Rule: Passwords",
      "",
      "    Example: Strong password",
      "      Given a strong password",
    ]);

    assert.equal(summary.scenarios[0].id, "ff-aaaaaa");
    assert.equal(summary.scenarios[1].id, null);
    assert.equal(summary.scenarios[2].id, null);
  });

  it("does not report duplicates from parsing alone", () => {
    const summary = parse([
      "Feature: Login",
      "",
      "  @ff-aaaaaa",
      "  Scenario: One",
      "    Given a step",
    ]);

    assert.deepEqual(markDuplicateScenarioIds([summary]), []);
    assert.equal(summary.scenarios[0].idConflict, false);
  });

  it("reports duplicate IDs across files in the catalog without merging", async () => {
    const { repository, root } = await createTempRepository();
    await writeFile(
      join(root, "features", "a.feature"),
      ["Feature: A", "", "  @ff-8f3a2c", "  Scenario: Original", "    Given a step", "", "  @ff-111111", "  Scenario: Unique", "    Given a step"].join("\n"),
    );
    await writeFile(
      join(root, "features", "b.feature"),
      ["Feature: B", "", "", "  @ff-8f3a2c", "  Scenario: Copy", "    Given a step"].join("\n"),
    );

    const catalog = await buildFeatureCatalog({
      repository,
    });
    const [a, b] = catalog.features;

    assert.equal(catalog.totalScenarios, 3);
    assert.deepEqual(catalog.duplicateScenarioIds, [
      {
        id: "ff-8f3a2c",
        locations: [
          { line: 4, path: "features/a.feature" },
          { line: 5, path: "features/b.feature" },
        ],
      },
    ]);
    assert.equal(a.scenarios[0].id, "ff-8f3a2c");
    assert.equal(a.scenarios[0].idConflict, true);
    assert.equal(a.scenarios[1].idConflict, false);
    assert.equal(b.scenarios[0].id, "ff-8f3a2c");
    assert.equal(b.scenarios[0].idConflict, true);
  });

  it("passes a custom pattern through the catalog and reports no duplicates by default", async () => {
    const { repository, root } = await createTempRepository();
    await writeFile(
      join(root, "features", "a.feature"),
      ["Feature: A", "", "  @TC-7", "  Scenario: Custom", "    Given a step"].join("\n"),
    );

    const defaultCatalog = await buildFeatureCatalog({ repository });
    const customCatalog = await buildFeatureCatalog({ repository, scenarioIdPattern: "@TC-\\d+" });

    assert.deepEqual(defaultCatalog.duplicateScenarioIds, []);
    assert.equal(defaultCatalog.features[0].scenarios[0].id, null);
    assert.equal(customCatalog.features[0].scenarios[0].id, "TC-7");
  });

  it("reports duplicate IDs within a file in feature detail", async () => {
    const { repository, root } = await createTempRepository();
    await writeFile(
      join(root, "features", "a.feature"),
      ["Feature: A", "", "  @ff-8f3a2c", "  Scenario: One", "    Given a step", "", "  @ff-8f3a2c", "  Scenario: Two", "    Given a step"].join("\n"),
    );

    const detail = await buildFeatureDetail({
      featurePath: "features/a.feature",
      repository,
    });

    assert.ok(detail);
    assert.deepEqual(detail.duplicateScenarioIds, [
      {
        id: "ff-8f3a2c",
        locations: [
          { line: 4, path: "features/a.feature" },
          { line: 8, path: "features/a.feature" },
        ],
      },
    ]);
    assert.deepEqual(
      detail.feature.scenarios.map((scenario) => scenario.idConflict),
      [true, true],
    );
  });
});
