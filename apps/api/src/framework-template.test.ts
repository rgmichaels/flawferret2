import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFrameworkBrowserTemplate,
  buildFrameworkTemplatePreview,
  buildFrameworkTemplatePreviewWithFileStatus,
  createFrameworkFiles,
} from "./framework-template.js";

const localDestination = {
  destinationType: "local" as const,
  githubBranch: "main",
  githubOwner: "",
  githubRepositoryId: "",
  githubRepository: "",
};

describe("framework template preview", () => {
  it("builds a best-practices Playwright Cucumber TypeScript framework preview", () => {
    const preview = buildFrameworkTemplatePreview({
      baseUrl: "https://example.test",
      ...localDestination,
      features: ["pageObjects", "apiTesting", "accessibility", "githubActions", "sampleFeature"],
      packageName: "@example/qa-framework",
      projectName: "Example QA Framework",
      targetDirectory: "qa/e2e",
    });

    assert.equal(preview.projectName, "Example QA Framework");
    assert.equal(preview.packageName, "@example/qa-framework");
    assert.equal(preview.runCommand, "pnpm test");
    assert.ok(preview.totalFiles >= 15);
    assert.ok(preview.directories.includes("qa/e2e/src/pages"));
    assert.ok(preview.directories.includes("qa/e2e/features/smoke"));
    assert.ok(preview.files.some((file) => file.path === "qa/e2e/src/support/hooks.ts"));
    assert.ok(preview.files.some((file) => file.path === "qa/e2e/src/pages/ApplicationPage.ts"));
    assert.ok(preview.files.some((file) => file.path === "qa/e2e/src/api/ApiClient.ts"));
    assert.ok(preview.files.some((file) => file.path === "qa/e2e/src/accessibility/scan.ts"));
    assert.ok(preview.files.some((file) => file.path === "qa/e2e/.github/workflows/playwright-cucumber.yml"));
    assert.match(
      preview.files.find((file) => file.path === "qa/e2e/package.json")?.contentPreview ?? "",
      /"name": "@example\/qa-framework"/,
    );
  });

  it("omits optional framework areas when they are not selected", () => {
    const preview = buildFrameworkTemplatePreview({
      baseUrl: "https://example.test",
      ...localDestination,
      features: [],
      packageName: "minimal-framework",
      projectName: "Minimal Framework",
      targetDirectory: ".",
    });

    assert.equal(preview.targetDirectory, ".");
    assert.ok(preview.files.some((file) => file.path === "src/support/hooks.ts"));
    assert.ok(!preview.files.some((file) => file.path.startsWith("src/pages/")));
    assert.ok(!preview.files.some((file) => file.path.startsWith("features/")));
    assert.ok(!preview.files.some((file) => file.path.startsWith(".github/")));
  });

  it("builds browser-writable framework files without target-directory prefixes", () => {
    const template = buildFrameworkBrowserTemplate({
      baseUrl: "https://example.test",
      ...localDestination,
      features: ["sampleFeature"],
      packageName: "browser-framework",
      projectName: "Browser Framework",
      targetDirectory: "qa/e2e",
    });

    assert.ok(template.files.some((file) => file.path === "package.json"));
    assert.ok(template.files.some((file) => file.path === "features/smoke/configured-base-url.feature"));
    assert.match(template.files.find((file) => file.path === "package.json")?.content ?? "", /browser-framework/);
    assert.ok(template.files.some((file) => file.path === "src/pages/ApplicationPage.ts"));
    assert.ok(template.files.some((file) => file.path === "src/steps/navigation.steps.ts"));
    assert.ok(!template.files.some((file) => file.path.startsWith("qa/e2e/")));
  });

  it("makes the base URL first-class in generated framework files", () => {
    const template = buildFrameworkBrowserTemplate({
      baseUrl: "https://app.example.test",
      ...localDestination,
      features: ["pageObjects", "sampleFeature"],
      packageName: "base-url-framework",
      projectName: "Base URL Framework",
      targetDirectory: "qa/e2e",
    });
    const envExample = template.files.find((file) => file.path === ".env.example")?.content ?? "";
    const readme = template.files.find((file) => file.path === "README.md")?.content ?? "";
    const feature = template.files.find((file) => file.path === "features/smoke/configured-base-url.feature")?.content ?? "";
    const applicationPage = template.files.find((file) => file.path === "src/pages/ApplicationPage.ts")?.content ?? "";
    const steps = template.files.find((file) => file.path === "src/steps/navigation.steps.ts")?.content ?? "";

    assert.match(envExample, /BASE_URL=https:\/\/app\.example\.test/);
    assert.match(readme, /The framework targets `https:\/\/app\.example\.test` by default/);
    assert.match(feature, /Given I open the configured base URL/);
    assert.match(feature, /Then the configured page should load successfully/);
    assert.match(feature, /And the page should be served from the configured base URL/);
    assert.match(applicationPage, /Configured base URL should return a successful document response/);
    assert.match(steps, /new URL\(env\.BASE_URL\)\.origin/);
  });

  it("marks existing files in preview before writing", async () => {
    const targetDirectory = await mkdtemp(join(tmpdir(), "ff2-framework-preview-"));
    await writeFile(join(targetDirectory, "package.json"), "existing package", "utf8");

    const preview = await buildFrameworkTemplatePreviewWithFileStatus({
      baseUrl: "https://example.test",
      ...localDestination,
      features: [],
      packageName: "minimal-framework",
      projectName: "Minimal Framework",
      targetDirectory,
    });

    assert.equal(preview.files.find((file) => file.path.endsWith("/package.json"))?.status, "exists");
    assert.equal(preview.files.find((file) => file.path.endsWith("/cucumber.js"))?.status, "create");
  });

  it("previews GitHub destinations without checking local file status", async () => {
    const preview = await buildFrameworkTemplatePreviewWithFileStatus({
      baseUrl: "https://example.test",
      destinationType: "github",
      features: ["sampleFeature"],
      githubBranch: "feature/framework",
      githubOwner: "rgmichaels",
      githubRepositoryId: "repo-1",
      githubRepository: "qa-framework",
      packageName: "github-framework",
      projectName: "GitHub Framework",
      targetDirectory: ".",
    });

    assert.equal(preview.targetDirectory, ".");
    assert.ok(preview.files.some((file) => file.path === "package.json"));
    assert.equal(preview.files.find((file) => file.path === "package.json")?.status, "create");
  });

  it("creates files and skips existing files by default", async () => {
    const targetDirectory = await mkdtemp(join(tmpdir(), "ff2-framework-create-"));
    await writeFile(join(targetDirectory, "package.json"), "existing package", "utf8");

    const result = await createFrameworkFiles({
      baseUrl: "https://example.test",
      ...localDestination,
      features: ["sampleFeature"],
      overwriteExisting: false,
      packageName: "created-framework",
      projectName: "Created Framework",
      targetDirectory,
    });

    assert.ok(result.createdFiles.some((file) => file.path.endsWith("/cucumber.js")));
    assert.ok(result.skippedFiles.some((file) => file.path.endsWith("/package.json")));
    assert.equal(await readFile(join(targetDirectory, "package.json"), "utf8"), "existing package");
    assert.match(
      await readFile(join(targetDirectory, "features/smoke/configured-base-url.feature"), "utf8"),
      /Feature: Configured application availability/,
    );
  });

  it("overwrites existing files only when requested", async () => {
    const targetDirectory = await mkdtemp(join(tmpdir(), "ff2-framework-overwrite-"));
    await writeFile(join(targetDirectory, "package.json"), "existing package", "utf8");

    const result = await createFrameworkFiles({
      baseUrl: "https://example.test",
      ...localDestination,
      features: [],
      overwriteExisting: true,
      packageName: "overwritten-framework",
      projectName: "Overwritten Framework",
      targetDirectory,
    });

    assert.ok(result.overwrittenFiles.some((file) => file.path.endsWith("/package.json")));
    assert.match(await readFile(join(targetDirectory, "package.json"), "utf8"), /"name": "overwritten-framework"/);
  });

});
