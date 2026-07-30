import type {
  FrameworkTemplateFile,
  FrameworkTemplatePreviewResponse,
  FrameworkTemplateRequest,
} from "@flawferret2/job-schemas";

type TemplateFileInput = Omit<FrameworkTemplateFile, "contentPreview" | "path" | "sizeBytes"> & {
  content: string;
  path: string;
};

const normalizeTargetDirectory = (value: string) => {
  const trimmed = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");

  return trimmed.length === 0 ? "." : trimmed;
};

const joinTargetPath = (targetDirectory: string, path: string) =>
  targetDirectory === "." ? path : `${targetDirectory}/${path}`;

const previewContent = (content: string) => {
  const normalized = content.trimStart();

  return normalized.length <= 260 ? normalized : `${normalized.slice(0, 260)}...`;
};

const template = (content: string, values: FrameworkTemplateRequest) =>
  content
    .replaceAll("{{projectName}}", values.projectName)
    .replaceAll("{{packageName}}", values.packageName)
    .replaceAll("{{baseUrl}}", values.baseUrl);

const coreFiles = (values: FrameworkTemplateRequest): TemplateFileInput[] => [
  {
    category: "config",
    description: "NPM manifest with Cucumber, Playwright, TypeScript, lint-friendly scripts, and reporting commands.",
    path: "package.json",
    content: template(
      `{
  "name": "{{packageName}}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "cucumber-js",
    "test:smoke": "cucumber-js --tags @smoke",
    "test:headed": "PW_HEADED=true cucumber-js",
    "test:api": "cucumber-js --tags @api",
    "test:a11y": "cucumber-js --tags @a11y",
    "format:report": "multiple-cucumber-html-reporter",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@axe-core/playwright": "^4.11.0",
    "@cucumber/cucumber": "^12.2.0",
    "@playwright/test": "^1.56.0",
    "dotenv": "^17.4.0",
    "zod": "^4.4.0"
  },
  "devDependencies": {
    "@types/node": "^26.0.0",
    "multiple-cucumber-html-reporter": "^3.9.3",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0"
  }
}
`,
      values,
    ),
  },
  {
    category: "config",
    description: "Strict TypeScript settings for maintainable step definitions, support code, and page objects.",
    path: "tsconfig.json",
    content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
`,
  },
  {
    category: "config",
    description: "Cucumber configuration that loads TypeScript support files and emits machine-readable reports.",
    path: "cucumber.js",
    content: `export default {
  default: {
    format: [
      "progress",
      "json:reports/cucumber-report.json",
      "html:reports/cucumber-report.html"
    ],
    import: ["src/support/**/*.ts", "src/steps/**/*.ts"],
    paths: ["features/**/*.feature"],
    publishQuiet: true,
    requireModule: ["tsx"]
  }
};
`,
  },
  {
    category: "config",
    description: "Playwright defaults tuned for reliable local and CI runs without arbitrary waits.",
    path: "playwright.config.ts",
    content: `import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  reporter: [["html", { outputFolder: "reports/playwright", open: "never" }]],
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  use: {
    actionTimeout: 15_000,
    baseURL: process.env.BASE_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: devices["Desktop Chrome"]
    }
  ]
});
`,
  },
  {
    category: "config",
    description: "Documented environment variables for base URL, browser behavior, and diagnostics.",
    path: ".env.example",
    content: template(
      `BASE_URL={{baseUrl}}
PW_HEADLESS=true
PW_SLOW_MO=0
TRACE_ON_FAILURE=true
`,
      values,
    ),
  },
  {
    category: "config",
    description: "Keeps generated reports, traces, videos, and local environment files out of source control.",
    path: ".gitignore",
    content: `node_modules/
.env
reports/
test-results/
playwright-report/
dist/
`,
  },
  {
    category: "support",
    description: "Typed environment loader with validation and clear failure messages.",
    path: "src/support/env.ts",
    content: `import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  BASE_URL: z.string().url(),
  PW_HEADLESS: z.enum(["true", "false"]).default("true"),
  PW_SLOW_MO: z.coerce.number().int().nonnegative().default(0),
  TRACE_ON_FAILURE: z.enum(["true", "false"]).default("true")
});

export const env = envSchema.parse(process.env);
`,
  },
  {
    category: "support",
    description: "Custom Cucumber World carrying browser, context, page, and test attachments.",
    path: "src/support/world.ts",
    content: `import { setWorldConstructor, type IWorldOptions, World } from "@cucumber/cucumber";
import type { Browser, BrowserContext, Page } from "@playwright/test";

export class TestWorld extends World {
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;

  constructor(options: IWorldOptions) {
    super(options);
  }
}

setWorldConstructor(TestWorld);
`,
  },
  {
    category: "support",
    description: "Browser lifecycle hooks with traces/screenshots on failure and no brittle sleeps.",
    path: "src/support/hooks.ts",
    content: `import { After, Before, Status } from "@cucumber/cucumber";
import { chromium } from "@playwright/test";
import { env } from "./env.js";
import type { TestWorld } from "./world.js";

Before(async function (this: TestWorld) {
  this.browser = await chromium.launch({
    headless: env.PW_HEADLESS === "true",
    slowMo: env.PW_SLOW_MO
  });
  this.context = await this.browser.newContext({
    baseURL: env.BASE_URL
  });
  this.page = await this.context.newPage();
  await this.context.tracing.start({
    screenshots: true,
    snapshots: true
  });
});

After(async function (this: TestWorld, scenario) {
  if (this.page && scenario.result?.status === Status.FAILED) {
    const screenshot = await this.page.screenshot({ fullPage: true });
    await this.attach(screenshot, "image/png");
  }

  if (this.context) {
    const tracePath = \`reports/traces/\${scenario.pickle.name.replace(/[^a-z0-9]+/gi, "-")}.zip\`;
    await this.context.tracing.stop({ path: tracePath });
  }

  await this.context?.close();
  await this.browser?.close();
});
`,
  },
  {
    category: "support",
    description: "Small world guard helpers so missing browser state fails with useful messages.",
    path: "src/support/world-guards.ts",
    content: `import type { Page } from "@playwright/test";
import type { TestWorld } from "./world.js";

export const getPage = (world: TestWorld): Page => {
  if (!world.page) {
    throw new Error("Playwright page is not initialized. Check the Cucumber Before hook.");
  }

  return world.page;
};
`,
  },
  {
    category: "utility",
    description: "Shared assertion helper for visible, readable text expectations.",
    path: "src/utils/assertions.ts",
    content: `import { expect, type Locator } from "@playwright/test";

export const expectVisibleText = async (locator: Locator, expectedText: string) => {
  await expect(locator).toBeVisible();
  await expect(locator).toContainText(expectedText);
};
`,
  },
  {
    category: "docs",
    description: "Starter README with install, run, reporting, and maintenance guidance.",
    path: "README.md",
    content: template(
      `# {{projectName}}

Best-practices Playwright + TypeScript + Cucumber framework generated by FlawFerret 2.

## Principles

- Prefer explicit assertions over implicit behavior.
- Never introduce brittle waits or arbitrary sleeps.
- Reuse page objects and support helpers.
- Keep each scenario focused on one behavior.
- Capture traces, screenshots, and reports for failure analysis.
- Treat API helpers and UI page objects as first-class test architecture.

## Getting Started

\`\`\`bash
pnpm install
cp .env.example .env
pnpm test
\`\`\`

## Common Commands

- \`pnpm test\` runs all Cucumber scenarios.
- \`pnpm test:smoke\` runs smoke coverage.
- \`pnpm test:api\` runs API-tagged scenarios.
- \`pnpm test:a11y\` runs accessibility-tagged scenarios.
- \`pnpm typecheck\` validates TypeScript.

## Project Layout

- \`features/\` contains business-readable Cucumber scenarios.
- \`src/pages/\` contains Playwright page objects.
- \`src/steps/\` binds Gherkin to page objects and helpers.
- \`src/support/\` owns browser lifecycle, World state, and environment setup.
- \`src/api/\` contains reusable API clients.
- \`src/accessibility/\` contains accessibility scanning helpers.
`,
      values,
    ),
  },
];

const pageObjectFiles = (): TemplateFileInput[] => [
  {
    category: "page-object",
    description: "Base page object with navigation and title assertions shared by page-specific objects.",
    path: "src/pages/BasePage.ts",
    content: `import { expect, type Page } from "@playwright/test";

export abstract class BasePage {
  protected constructor(protected readonly page: Page) {}

  async goto(path: string) {
    await this.page.goto(path);
  }

  async expectTitleContains(text: string) {
    await expect(this.page).toHaveTitle(new RegExp(text, "i"));
  }
}
`,
  },
  {
    category: "page-object",
    description: "Example page object demonstrating semantic locators and focused assertions.",
    path: "src/pages/HomePage.ts",
    content: `import { expect, type Page } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class HomePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async open() {
    await this.goto("/");
  }

  async expectLoaded() {
    await expect(this.page.getByRole("main").or(this.page.locator("body"))).toBeVisible();
    await expect(this.page).toHaveTitle(/.+/);
  }
}
`,
  },
  {
    category: "step-definition",
    description: "Reusable navigation and page-load steps that delegate behavior to page objects.",
    path: "src/steps/navigation.steps.ts",
    content: `import { Given, Then } from "@cucumber/cucumber";
import { HomePage } from "../pages/HomePage.js";
import { getPage } from "../support/world-guards.js";
import type { TestWorld } from "../support/world.js";

Given("I am on the home page", async function (this: TestWorld) {
  await new HomePage(getPage(this)).open();
});

Then("the home page should load", async function (this: TestWorld) {
  await new HomePage(getPage(this)).expectLoaded();
});
`,
  },
];

const sampleFeatureFiles = (): TemplateFileInput[] => [
  {
    category: "feature",
    description: "Focused smoke feature demonstrating a concise load assertion scenario.",
    path: "features/smoke/home.feature",
    content: `@smoke @home
Feature: Home page

  Scenario: Home page loads with stable content
    Given I am on the home page
    Then the home page should load
`,
  },
];

const apiTestingFiles = (): TemplateFileInput[] => [
  {
    category: "utility",
    description: "Small API client wrapper with base URL handling and explicit response assertions.",
    path: "src/api/ApiClient.ts",
    content: `import { expect, request, type APIRequestContext } from "@playwright/test";
import { env } from "../support/env.js";

export class ApiClient {
  private context?: APIRequestContext;

  async init() {
    this.context = await request.newContext({
      baseURL: env.BASE_URL
    });
  }

  async get(path: string) {
    if (!this.context) {
      throw new Error("API client is not initialized.");
    }

    const response = await this.context.get(path);
    expect(response.ok(), \`GET \${path} should return a successful response\`).toBe(true);

    return response;
  }

  async dispose() {
    await this.context?.dispose();
  }
}
`,
  },
];

const accessibilityFiles = (): TemplateFileInput[] => [
  {
    category: "utility",
    description: "Axe-powered accessibility helper with violation summaries suitable for failure output.",
    path: "src/accessibility/scan.ts",
    content: `import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const expectNoAccessibilityViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).analyze();
  const summary = results.violations
    .map((violation) => \`\${violation.id}: \${violation.help}\`)
    .join("\\n");

  expect(results.violations, summary).toEqual([]);
};
`,
  },
];

const githubActionsFiles = (): TemplateFileInput[] => [
  {
    category: "ci",
    description: "GitHub Actions workflow for install, browser setup, typecheck, and Cucumber execution.",
    path: ".github/workflows/playwright-cucumber.yml",
    content: `name: Playwright Cucumber

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm typecheck
      - run: pnpm test
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-reports
          path: reports/
`,
  },
];

const selectedFiles = (values: FrameworkTemplateRequest) => {
  const enabled = new Set(values.features);
  const files = [...coreFiles(values)];

  if (enabled.has("pageObjects")) {
    files.push(...pageObjectFiles());
  }

  if (enabled.has("sampleFeature")) {
    files.push(...sampleFeatureFiles());
  }

  if (enabled.has("apiTesting")) {
    files.push(...apiTestingFiles());
  }

  if (enabled.has("accessibility")) {
    files.push(...accessibilityFiles());
  }

  if (enabled.has("githubActions")) {
    files.push(...githubActionsFiles());
  }

  return files;
};

const directoryNames = (files: FrameworkTemplateFile[]) =>
  Array.from(
    new Set(
      files.flatMap((file) => {
        const parts = file.path.split("/");
        const directories: string[] = [];

        for (let index = 1; index < parts.length; index += 1) {
          directories.push(parts.slice(0, index).join("/"));
        }

        return directories;
      }),
    ),
  ).sort();

export const buildFrameworkTemplatePreview = (
  request: FrameworkTemplateRequest,
): FrameworkTemplatePreviewResponse => {
  const targetDirectory = normalizeTargetDirectory(request.targetDirectory);
  const files = selectedFiles(request).map((file): FrameworkTemplateFile => ({
    category: file.category,
    contentPreview: previewContent(file.content),
    description: file.description,
    path: joinTargetPath(targetDirectory, file.path),
    sizeBytes: Buffer.byteLength(file.content, "utf8"),
  }));

  return {
    directories: directoryNames(files),
    files,
    installCommand: "pnpm install && pnpm exec playwright install chromium",
    packageName: request.packageName,
    projectName: request.projectName,
    runCommand: "pnpm test",
    targetDirectory,
    totalFiles: files.length,
  };
};
