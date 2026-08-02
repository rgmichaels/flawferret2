import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import {
  buildFrameworkBrowserTemplate,
  buildFrameworkTemplatePreview,
  buildFrameworkTemplatePreviewWithFileStatus,
  createGithubRemoteForLocalFramework,
  createFrameworkFiles,
  createFrameworkPullRequest,
} from "./framework-template.js";

const execFileAsync = promisify(execFile);

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
      createGithubRepository: false,
      features: ["sampleFeature"],
      initializeGitRepository: false,
      overwriteExisting: false,
      packageName: "created-framework",
      projectName: "Created Framework",
      registerLocalRepository: false,
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
      createGithubRepository: false,
      features: [],
      initializeGitRepository: false,
      overwriteExisting: true,
      packageName: "overwritten-framework",
      projectName: "Overwritten Framework",
      registerLocalRepository: false,
      targetDirectory,
    });

    assert.ok(result.overwrittenFiles.some((file) => file.path.endsWith("/package.json")));
    assert.match(await readFile(join(targetDirectory, "package.json"), "utf8"), /"name": "overwritten-framework"/);
  });

  it("initializes a fresh local git repository when requested", async () => {
    const targetDirectory = await mkdtemp(join(tmpdir(), "ff2-framework-git-init-"));

    const result = await createFrameworkFiles({
      baseUrl: "https://example.test",
      ...localDestination,
      createGithubRepository: false,
      features: ["sampleFeature"],
      initializeGitRepository: true,
      overwriteExisting: false,
      packageName: "git-framework",
      projectName: "Git Framework",
      registerLocalRepository: false,
      targetDirectory,
    });

    await access(join(targetDirectory, ".git"));
    const { stdout } = await execFileAsync("git", ["rev-list", "--count", "HEAD"], {
      cwd: targetDirectory,
    });

    assert.equal(result.localGit?.status, "initialized");
    assert.equal(stdout.trim(), "1");
  });

  it("leaves an existing local git repository alone when git initialization is requested", async () => {
    const targetDirectory = await mkdtemp(join(tmpdir(), "ff2-framework-git-existing-"));
    await execFileAsync("git", ["init"], {
      cwd: targetDirectory,
    });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=FlawFerret Test",
        "-c",
        "user.email=flawferret-test@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "Existing commit",
      ],
      {
        cwd: targetDirectory,
      },
    );

    const result = await createFrameworkFiles({
      baseUrl: "https://example.test",
      ...localDestination,
      features: ["sampleFeature"],
      createGithubRepository: false,
      initializeGitRepository: true,
      overwriteExisting: false,
      packageName: "existing-git-framework",
      projectName: "Existing Git Framework",
      registerLocalRepository: false,
      targetDirectory,
    });
    const { stdout } = await execFileAsync("git", ["rev-list", "--count", "HEAD"], {
      cwd: targetDirectory,
    });

    assert.equal(result.localGit?.status, "already_repo");
    assert.equal(stdout.trim(), "1");
  });

  it("creates a GitHub pull request for generated framework files", async () => {
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ body, method, url: requestUrl });

      if (requestUrl.endsWith("/branches/main")) {
        return Response.json({
          sha: "base-commit-sha",
          commit: {
            tree: {
              sha: "base-tree-sha",
            },
          },
        });
      }

      if (requestUrl.endsWith("/git/trees/base-tree-sha?recursive=1")) {
        return Response.json({
          sha: "base-tree-sha",
          tree: [
            {
              path: "qa/e2e/package.json",
              type: "blob",
            },
          ],
        });
      }

      if (requestUrl.endsWith("/git/refs")) {
        return Response.json({
          object: {
            sha: "base-commit-sha",
          },
        });
      }

      if (requestUrl.endsWith("/git/trees")) {
        return Response.json({
          sha: "new-tree-sha",
        });
      }

      if (requestUrl.endsWith("/git/commits")) {
        return Response.json({
          sha: "new-commit-sha",
          commit: {
            tree: {
              sha: "new-tree-sha",
            },
          },
        });
      }

      if (requestUrl.includes("/git/refs/heads/flawferret/create-framework-")) {
        return Response.json({
          object: {
            sha: "new-commit-sha",
          },
        });
      }

      if (requestUrl.endsWith("/pulls")) {
        return Response.json({
          html_url: "https://github.com/rgmichaels/qa-framework/pull/12",
          number: 12,
        });
      }

      return new Response("unexpected request", { status: 500 });
    }) as typeof fetch;

    const result = await createFrameworkPullRequest(
      {
        baseUrl: "https://example.test",
        destinationType: "github",
        features: ["sampleFeature"],
        createGithubRepository: false,
        githubBranch: "main",
        githubOwner: "rgmichaels",
        githubRepository: "qa-framework",
        githubRepositoryId: "repo-1",
        initializeGitRepository: false,
        overwriteExisting: false,
        packageName: "qa-framework",
        projectName: "QA Framework",
        registerLocalRepository: false,
        targetDirectory: "qa/e2e",
      },
      {
        env: {
          GITHUB_TOKEN: "test-token",
        },
        fetcher,
        now: new Date("2026-08-01T12:34:56.000Z"),
      },
    );

    assert.equal(result.githubPullRequest?.prNumber, 12);
    assert.equal(result.githubPullRequest?.commitSha, "new-commit-sha");
    assert.ok(result.skippedFiles.some((file) => file.path === "qa/e2e/package.json"));
    assert.ok(result.createdFiles.some((file) => file.path === "qa/e2e/features/smoke/configured-base-url.feature"));
    assert.ok(
      calls.some(
        (call) =>
          call.method === "POST" &&
          call.url.endsWith("/git/refs") &&
          (call.body as { ref?: string }).ref === "refs/heads/flawferret/create-framework-qa-framework-20260801T123456Z",
      ),
    );
    assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/pulls")));
  });

  it("explains which GitHub branch lookup failed", async () => {
    const fetcher = (async () =>
      new Response('{"message":"Branch not found"}', {
        status: 404,
      })) as typeof fetch;

    await assert.rejects(
      () =>
        createFrameworkPullRequest(
          {
            baseUrl: "https://example.test",
            destinationType: "github",
            features: ["sampleFeature"],
            createGithubRepository: false,
            githubBranch: "release/candidate",
            githubOwner: "rgmichaels",
            githubRepository: "qa-framework",
            githubRepositoryId: "repo-1",
            initializeGitRepository: false,
            overwriteExisting: false,
            packageName: "qa-framework",
            projectName: "QA Framework",
            registerLocalRepository: false,
            targetDirectory: "qa/e2e",
          },
          {
            env: {
              GITHUB_TOKEN: "test-token",
            },
            fetcher,
          },
        ),
      /Unable to read GitHub branch release\/candidate in rgmichaels\/qa-framework failed with 404/,
    );
  });

  it("creates a GitHub repo and pushes an initialized local framework", async () => {
    const targetDirectory = await mkdtemp(join(tmpdir(), "ff2-framework-github-remote-"));
    await execFileAsync("git", ["init"], {
      cwd: targetDirectory,
    });
    await writeFile(join(targetDirectory, "README.md"), "Generated framework", "utf8");
    await execFileAsync("git", ["add", "-A"], {
      cwd: targetDirectory,
    });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=FlawFerret",
        "-c",
        "user.email=flawferret@example.invalid",
        "commit",
        "-m",
        "Initial test framework",
      ],
      {
        cwd: targetDirectory,
      },
    );
    const fetchCalls: Array<{ body: unknown; method: string; url: string }> = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      fetchCalls.push({ body, method, url: requestUrl });

      if (requestUrl.endsWith("/user")) {
        return Response.json({
          login: "rgmichaels",
        });
      }

      if (requestUrl.endsWith("/user/repos")) {
        return Response.json({
          clone_url: "https://github.com/rgmichaels/qa-framework.git",
          default_branch: "main",
          full_name: "rgmichaels/qa-framework",
          html_url: "https://github.com/rgmichaels/qa-framework",
        });
      }

      return new Response("unexpected request", { status: 500 });
    }) as typeof fetch;
    const gitCalls: Array<{ args: string[]; command: string; cwd: string }> = [];
    const runner = async (command: string, args: string[], options: { cwd: string }) => {
      gitCalls.push({ args, command, cwd: options.cwd });

      if (args.join(" ") === "remote get-url origin") {
        throw new Error("No origin configured");
      }

      return {
        stdout: "",
      };
    };

    const result = await createGithubRemoteForLocalFramework(
      {
        baseUrl: "https://example.test",
        ...localDestination,
        createGithubRepository: true,
        features: ["sampleFeature"],
        githubOwner: "rgmichaels",
        githubRepository: "qa-framework",
        initializeGitRepository: true,
        overwriteExisting: false,
        packageName: "qa-framework",
        projectName: "QA Framework",
        registerLocalRepository: false,
        targetDirectory,
      },
      targetDirectory,
      {
        env: {
          GITHUB_TOKEN: "test-token",
        },
        fetcher,
        runner,
      },
    );

    assert.equal(result.status, "created");
    assert.equal(result.repository, "rgmichaels/qa-framework");
    assert.equal(result.webUrl, "https://github.com/rgmichaels/qa-framework");
    assert.ok(fetchCalls.some((call) => call.method === "POST" && call.url.endsWith("/user/repos")));
    assert.ok(gitCalls.some((call) => call.args.join(" ") === "remote add origin https://github.com/rgmichaels/qa-framework.git"));
    assert.ok(gitCalls.some((call) => call.args.join(" ") === "push -u origin main"));
  });

});
