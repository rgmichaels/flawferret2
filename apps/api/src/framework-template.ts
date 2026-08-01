import type {
  CreateFrameworkFileResult,
  CreateFrameworkRequest,
  CreateFrameworkResponse,
  FrameworkTemplateFile,
  FrameworkTemplatePreviewResponse,
  FrameworkTemplateRequest,
  GithubFrameworkPullRequest,
  RepositoryResponse,
  TrackerIntegrationResponse,
} from "@flawferret2/job-schemas";
import { prisma } from "@flawferret2/db";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

type TemplateFileInput = Omit<FrameworkTemplateFile, "contentPreview" | "path" | "sizeBytes"> & {
  content: string;
  path: string;
};

type GitHubFetch = typeof fetch;

type GitHubCommitResponse = {
  sha: string;
  commit: {
    tree: {
      sha: string;
    };
  };
};

type GitHubRefResponse = {
  object: {
    sha: string;
  };
};

type GitHubTreeResponse = {
  sha: string;
  tree?: Array<{
    path?: string;
    type?: string;
  }>;
};

type GitHubPullRequestResponse = {
  html_url: string;
  number: number;
};

type GitHubCreateFrameworkOptions = {
  env?: NodeJS.ProcessEnv;
  fetcher?: GitHubFetch;
  now?: Date;
};

const githubApiUrl = "https://api.github.com";

const toRepositoryResponse = (repository: {
  id: string;
  provider: RepositoryResponse["provider"];
  owner: string;
  name: string;
  defaultBranch: string;
  cloneUrl: string;
  webUrl: string;
  localPath: string | null;
  validationCommand: string | null;
  trackerIntegration:
    | {
        id: string;
        name: string;
        provider: TrackerIntegrationResponse["provider"];
        projectKey: string;
      }
    | null;
  trackerIntegrationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): RepositoryResponse => ({
  id: repository.id,
  provider: repository.provider,
  owner: repository.owner,
  name: repository.name,
  defaultBranch: repository.defaultBranch,
  cloneUrl: repository.cloneUrl,
  webUrl: repository.webUrl,
  localPath: repository.localPath,
  validationCommand: repository.validationCommand,
  trackerIntegration: repository.trackerIntegration
    ? {
        id: repository.trackerIntegration.id,
        name: repository.trackerIntegration.name,
        provider: repository.trackerIntegration.provider,
        projectKey: repository.trackerIntegration.projectKey,
      }
    : null,
  trackerIntegrationId: repository.trackerIntegrationId,
  createdAt: repository.createdAt.toISOString(),
  updatedAt: repository.updatedAt.toISOString(),
});

const normalizeTargetDirectory = (value: string) => {
  const trimmed = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");

  return trimmed.length === 0 ? "." : trimmed;
};

const joinTargetPath = (targetDirectory: string, path: string) =>
  targetDirectory === "." ? path : `${targetDirectory}/${path}`;

const resolveTargetRoot = (targetDirectory: string) =>
  isAbsolute(targetDirectory) ? resolve(targetDirectory) : resolve(process.cwd(), targetDirectory);

const assertPathInsideRoot = (root: string, path: string) => {
  const resolvedPath = resolve(path);
  const relativePath = relative(root, resolvedPath);

  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return resolvedPath;
  }

  throw new Error(`Unsafe framework path resolved outside the target directory: ${path}`);
};

const resolveFrameworkFilePath = (root: string, targetDirectory: string, path: string) =>
  assertPathInsideRoot(root, resolveTargetRoot(joinTargetPath(targetDirectory, path)));

const repositoryNameFromPackage = (packageName: string) =>
  packageName
    .replace(/^@/, "")
    .split("/")
    .at(-1)
    ?.replace(/[^A-Za-z0-9_.-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "playwright-cucumber-tests";

const registerGeneratedFrameworkRepository = async (
  request: CreateFrameworkRequest,
  targetDirectory: string,
): Promise<RepositoryResponse> => {
  const localPath = resolveTargetRoot(targetDirectory);
  const name = repositoryNameFromPackage(request.packageName);
  const fileUrl = `file://${localPath}`;

  const repository = await prisma.repository.upsert({
    where: {
      provider_owner_name: {
        provider: "GITHUB",
        owner: "local",
        name,
      },
    },
    create: {
      provider: "GITHUB",
      owner: "local",
      name,
      defaultBranch: "main",
      cloneUrl: fileUrl,
      webUrl: fileUrl,
      localPath,
      validationCommand: "pnpm test",
      trackerIntegrationId: null,
    },
    update: {
      defaultBranch: "main",
      cloneUrl: fileUrl,
      webUrl: fileUrl,
      localPath,
      validationCommand: "pnpm test",
    },
    include: {
      trackerIntegration: true,
    },
  });

  return toRepositoryResponse(repository);
};

const fileExists = async (path: string) => {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
};

export type FrameworkBrowserTemplateResponse = {
  files: Array<{
    category: string;
    content: string;
    description: string;
    path: string;
    sizeBytes: number;
  }>;
  packageName: string;
  projectName: string;
  totalFiles: number;
};

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
      `# Application root used by page objects, API clients, and smoke tests.
BASE_URL={{baseUrl}}

# Browser runtime controls for local debugging and CI.
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

## Base URL

The framework targets \`{{baseUrl}}\` by default. Update \`BASE_URL\` in \`.env\` when you need to point the same tests at another environment.

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
    description: "Sample application page object that verifies the configured base URL responds and renders.",
    path: "src/pages/ApplicationPage.ts",
    content: `import { expect, type Page } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class ApplicationPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async openConfiguredBaseUrl() {
    const response = await this.page.goto("/", {
      waitUntil: "domcontentloaded"
    });

    if (!response) {
      throw new Error("Expected the configured base URL to return a navigation response.");
    }

    expect(response.status(), "Configured base URL should return a successful document response").toBeLessThan(400);
  }

  async expectLoaded() {
    await expect(this.page.locator("body"), "The configured base URL should render a page body").toBeVisible();
    await expect(this.page, "The configured base URL should expose a populated page title").toHaveTitle(/\\S+/);
  }
}
`,
  },
  {
    category: "step-definition",
    description: "Reusable base URL smoke steps that delegate behavior to page objects.",
    path: "src/steps/navigation.steps.ts",
    content: `import { Given, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { ApplicationPage } from "../pages/ApplicationPage.js";
import { env } from "../support/env.js";
import { getPage } from "../support/world-guards.js";
import type { TestWorld } from "../support/world.js";

Given("I open the configured base URL", async function (this: TestWorld) {
  await new ApplicationPage(getPage(this)).openConfiguredBaseUrl();
});

Then("the configured page should load successfully", async function (this: TestWorld) {
  await new ApplicationPage(getPage(this)).expectLoaded();
});

Then("the page should be served from the configured base URL", async function (this: TestWorld) {
  const configuredOrigin = new URL(env.BASE_URL).origin;
  const currentOrigin = new URL(getPage(this).url()).origin;

  expect(currentOrigin).toBe(configuredOrigin);
});
`,
  },
];

const sampleFeatureFiles = (): TemplateFileInput[] => [
  {
    category: "feature",
    description: "Focused smoke feature that opens the configured base URL and verifies it loads.",
    path: "features/smoke/configured-base-url.feature",
    content: `@smoke @base-url
Feature: Configured application availability

  Scenario: Configured base URL loads successfully
    Given I open the configured base URL
    Then the configured page should load successfully
    And the page should be served from the configured base URL
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

  if (enabled.has("pageObjects") || enabled.has("sampleFeature")) {
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

const getTemplateFiles = (request: FrameworkTemplateRequest) => {
  const targetDirectory = normalizeTargetDirectory(request.targetDirectory);

  return {
    targetDirectory,
    files: selectedFiles(request),
  };
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
  const { files: templateFiles, targetDirectory } = getTemplateFiles(request);
  const files = templateFiles.map((file): FrameworkTemplateFile => ({
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

export const buildFrameworkBrowserTemplate = (
  request: FrameworkTemplateRequest,
): FrameworkBrowserTemplateResponse => {
  const files = selectedFiles(request).map((file) => ({
    category: file.category,
    content: file.content,
    description: file.description,
    path: file.path,
    sizeBytes: Buffer.byteLength(file.content, "utf8"),
  }));

  return {
    files,
    packageName: request.packageName,
    projectName: request.projectName,
    totalFiles: files.length,
  };
};

export const buildFrameworkTemplatePreviewWithFileStatus = async (
  request: FrameworkTemplateRequest,
  { overwriteExisting = false }: { overwriteExisting?: boolean } = {},
): Promise<FrameworkTemplatePreviewResponse> => {
  const preview = buildFrameworkTemplatePreview(request);
  if (request.destinationType === "github") {
    return {
      ...preview,
      files: preview.files.map((file) => ({
        ...file,
        status: "create",
      })),
    };
  }

  const targetRoot = resolveTargetRoot(preview.targetDirectory);
  const { files: templateFiles, targetDirectory } = getTemplateFiles(request);
  const files = await Promise.all(
    templateFiles.map(async (file): Promise<FrameworkTemplateFile> => {
      const absolutePath = resolveFrameworkFilePath(targetRoot, targetDirectory, file.path);
      const exists = await fileExists(absolutePath);

      return {
        category: file.category,
        contentPreview: previewContent(file.content),
        description: file.description,
        path: joinTargetPath(targetDirectory, file.path),
        sizeBytes: Buffer.byteLength(file.content, "utf8"),
        status: exists ? (overwriteExisting ? "overwrite" : "exists") : "create",
      };
    }),
  );

  return {
    ...preview,
    directories: directoryNames(files),
    files,
  };
};

const encodeGitHubPathPart = (value: string) => encodeURIComponent(value).replaceAll("%2F", "/");

const githubRequest = async <ResponseBody>(
  fetcher: GitHubFetch,
  token: string,
  path: string,
  init: RequestInit & { operation?: string } = {},
): Promise<ResponseBody> => {
  const { operation = "GitHub request", ...requestInit } = init;
  const response = await fetcher(`${githubApiUrl}${path}`, {
    ...requestInit,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...requestInit.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${operation} failed with ${response.status}: ${text || response.statusText}`);
  }

  return response.json() as Promise<ResponseBody>;
};

const getExistingGitHubPaths = async (
  fetcher: GitHubFetch,
  token: string,
  request: CreateFrameworkRequest,
  baseTreeSha: string,
) => {
  const tree = await githubRequest<GitHubTreeResponse>(
    fetcher,
    token,
    `/repos/${request.githubOwner}/${request.githubRepository}/git/trees/${baseTreeSha}?recursive=1`,
    {
      operation: `Unable to inspect GitHub repository tree for ${request.githubOwner}/${request.githubRepository}`,
    },
  );

  return new Set(tree.tree?.filter((item) => item.type === "blob" && item.path).map((item) => item.path as string) ?? []);
};

const frameworkBranchName = (request: CreateFrameworkRequest, now: Date) => {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const slug = request.packageName
    .replace(/^@/, "")
    .replace(/\//g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .slice(0, 48);

  return `flawferret/create-framework-${slug}-${timestamp}`;
};

export const createFrameworkPullRequest = async (
  request: CreateFrameworkRequest,
  { env = process.env, fetcher = fetch, now = new Date() }: GitHubCreateFrameworkOptions = {},
): Promise<CreateFrameworkResponse> => {
  const token = env.GITHUB_TOKEN?.trim();

  if (!token) {
    throw new Error("GitHub token is not configured. Add GITHUB_TOKEN to .env.");
  }

  const preview = await buildFrameworkTemplatePreviewWithFileStatus(request, {
    overwriteExisting: request.overwriteExisting,
  });
  const { files: templateFiles, targetDirectory } = getTemplateFiles(request);
  const branch = await githubRequest<GitHubCommitResponse>(
    fetcher,
    token,
    `/repos/${request.githubOwner}/${request.githubRepository}/branches/${encodeURIComponent(request.githubBranch)}`,
    {
      operation: `Unable to read GitHub branch ${request.githubBranch} in ${request.githubOwner}/${request.githubRepository}`,
    },
  );
  const existingPaths = await getExistingGitHubPaths(fetcher, token, request, branch.commit.tree.sha);
  const createdFiles: CreateFrameworkFileResult[] = [];
  const skippedFiles: CreateFrameworkFileResult[] = [];
  const overwrittenFiles: CreateFrameworkFileResult[] = [];
  const tree = templateFiles.flatMap((file) => {
    const path = joinTargetPath(targetDirectory, file.path);
    const exists = existingPaths.has(path);

    if (exists && !request.overwriteExisting) {
      skippedFiles.push({
        path,
        status: "skipped",
      });

      return [];
    }

    if (exists) {
      overwrittenFiles.push({
        path,
        status: "overwritten",
      });
    } else {
      createdFiles.push({
        path,
        status: "created",
      });
    }

    return [
      {
        content: file.content,
        mode: "100644",
        path,
        type: "blob",
      },
    ];
  });

  if (tree.length === 0) {
    throw new Error("No framework files are available to commit. Enable overwrite to replace existing files.");
  }

  const branchName = frameworkBranchName(request, now);
  await githubRequest<GitHubRefResponse>(fetcher, token, `/repos/${request.githubOwner}/${request.githubRepository}/git/refs`, {
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: branch.sha,
    }),
    method: "POST",
    operation: `Unable to create GitHub branch ${branchName}`,
  });

  const createdTree = await githubRequest<GitHubTreeResponse>(
    fetcher,
    token,
    `/repos/${request.githubOwner}/${request.githubRepository}/git/trees`,
    {
      body: JSON.stringify({
        base_tree: branch.commit.tree.sha,
        tree,
      }),
      method: "POST",
      operation: `Unable to create GitHub tree for ${branchName}`,
    },
  );
  const commit = await githubRequest<GitHubCommitResponse>(
    fetcher,
    token,
    `/repos/${request.githubOwner}/${request.githubRepository}/git/commits`,
    {
      body: JSON.stringify({
        message: `Create ${request.projectName} test framework`,
        parents: [branch.sha],
        tree: createdTree.sha,
      }),
      method: "POST",
      operation: `Unable to create GitHub commit for ${branchName}`,
    },
  );

  await githubRequest<GitHubRefResponse>(
    fetcher,
    token,
    `/repos/${request.githubOwner}/${request.githubRepository}/git/refs/heads/${encodeGitHubPathPart(branchName)}`,
    {
      body: JSON.stringify({
        sha: commit.sha,
      }),
      method: "PATCH",
      operation: `Unable to update GitHub branch ${branchName}`,
    },
  );

  const pullRequest = await githubRequest<GitHubPullRequestResponse>(
    fetcher,
    token,
    `/repos/${request.githubOwner}/${request.githubRepository}/pulls`,
    {
      body: JSON.stringify({
        base: request.githubBranch,
        body: [
          `FlawFerret generated a fresh Playwright, TypeScript, Cucumber framework for ${request.projectName}.`,
          "",
          `Base URL: ${request.baseUrl}`,
          `Target path: ${targetDirectory}`,
          `Files created: ${createdFiles.length}`,
          `Files overwritten: ${overwrittenFiles.length}`,
          `Files skipped: ${skippedFiles.length}`,
        ].join("\n"),
        head: branchName,
        title: `Create ${request.projectName} test framework`,
      }),
      method: "POST",
      operation: `Unable to create GitHub pull request for ${branchName}`,
    },
  );
  const githubPullRequest: GithubFrameworkPullRequest = {
    branchName,
    commitSha: commit.sha,
    prNumber: pullRequest.number,
    prUrl: pullRequest.html_url,
  };

  return {
    ...preview,
    createdFiles,
    githubPullRequest,
    overwrittenFiles,
    skippedFiles,
  };
};

export const createFrameworkFiles = async (request: CreateFrameworkRequest): Promise<CreateFrameworkResponse> => {
  if (request.destinationType === "github") {
    return createFrameworkPullRequest(request);
  }

  const preview = await buildFrameworkTemplatePreviewWithFileStatus(request, {
    overwriteExisting: request.overwriteExisting,
  });
  const targetRoot = resolveTargetRoot(preview.targetDirectory);
  const { files: templateFiles, targetDirectory } = getTemplateFiles(request);
  const createdFiles: CreateFrameworkFileResult[] = [];
  const skippedFiles: CreateFrameworkFileResult[] = [];
  const overwrittenFiles: CreateFrameworkFileResult[] = [];

  for (const file of templateFiles) {
    const path = joinTargetPath(targetDirectory, file.path);
    const absolutePath = resolveFrameworkFilePath(targetRoot, targetDirectory, file.path);
    const exists = await fileExists(absolutePath);

    if (exists && !request.overwriteExisting) {
      skippedFiles.push({
        path,
        status: "skipped",
      });
      continue;
    }

    await mkdir(dirname(absolutePath), {
      recursive: true,
    });
    await writeFile(absolutePath, file.content, "utf8");

    if (exists) {
      overwrittenFiles.push({
        path,
        status: "overwritten",
      });
    } else {
      createdFiles.push({
        path,
        status: "created",
      });
    }
  }

  return {
    ...preview,
    createdFiles,
    registeredRepository: request.registerLocalRepository
      ? await registerGeneratedFrameworkRepository(request, targetDirectory)
      : null,
    skippedFiles,
    overwrittenFiles,
  };
};
