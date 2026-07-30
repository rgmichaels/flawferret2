import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFrameworkTemplatePreview } from "./framework-template.js";

describe("framework template preview", () => {
  it("builds a best-practices Playwright Cucumber TypeScript framework preview", () => {
    const preview = buildFrameworkTemplatePreview({
      baseUrl: "https://example.test",
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
    assert.ok(preview.files.some((file) => file.path === "qa/e2e/src/pages/HomePage.ts"));
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
});
