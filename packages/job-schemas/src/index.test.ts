import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  captureContextSchema,
  createDiscoverRunRequestSchema,
  cucumberFeatureCatalogResponseSchema,
  cucumberFeatureDetailResponseSchema,
  createJobRequestSchema,
  createTrackerIntegrationRequestSchema,
  discoverCoverageDecisionSchema,
  discoverRunResponseSchema,
  discoverTestRecommendationsRequestSchema,
  discoverTestRecommendationsResponseSchema,
  explainCucumberScenarioRequestSchema,
  explainCucumberScenarioResponseSchema,
  frameworkTemplatePreviewResponseSchema,
  frameworkTemplateRequestSchema,
  jobEventTypeSchema,
  localTestRunOutputResponseSchema,
  localTestRunResponseSchema,
  localTestRunStatsResponseSchema,
  paginatedJobsResponseSchema,
  readinessResponseSchema,
  retryStageRequestSchema,
  trackerIntegrationResponseSchema,
  updateDiscoverRunQueuedRequestSchema,
} from "./index.js";

describe("job schemas", () => {
  it("accepts local cleanup event types", () => {
    assert.equal(jobEventTypeSchema.parse("LOCAL_CHECKOUT_CLEANUP_FAILED"), "LOCAL_CHECKOUT_CLEANUP_FAILED");
    assert.equal(jobEventTypeSchema.parse("LOCAL_CHECKOUT_CLEANUP_COMPLETED"), "LOCAL_CHECKOUT_CLEANUP_COMPLETED");
  });

  it("trims retry feedback", () => {
    assert.deepEqual(retryStageRequestSchema.parse({ feedback: "  try the empty state  " }), {
      feedback: "try the empty state",
    });
  });

  it("parses browser capture context from the existing extension", () => {
    const captureContext = captureContextSchema.parse({
      url: " https://example.test/login ",
      title: " Login ",
      role: " button ",
      name: " Sign in ",
      outerHTML: " <button>Sign in</button> ",
      selectors: [" button[type='submit'] ", " text=Sign in "],
      selectedText: " Sign in ",
      snapshotUrl: "blob:https://example.test/snapshot",
      captureRect: {
        x: 10,
        y: 20,
        width: 120,
        height: 44,
      },
      viewport: {
        width: 1440,
        height: 900,
      },
      devicePixelRatio: 2,
      notes: " Add a focused assertion. ",
    });

    assert.equal(captureContext.url, "https://example.test/login");
    assert.equal(captureContext.role, "button");
    assert.equal(captureContext.name, "Sign in");
    assert.deepEqual(captureContext.selectors, ["button[type='submit']", "text=Sign in"]);
    assert.equal(captureContext.notes, "Add a focused assertion.");
    assert.deepEqual(captureContext.consoleErrors, []);
    assert.deepEqual(captureContext.networkEvents, []);
  });

  it("accepts capture context on new ADD_PLAYWRIGHT_TEST jobs", () => {
    const request = createJobRequestSchema.parse({
      jobType: "ADD_PLAYWRIGHT_TEST",
      priority: "NORMAL",
      payload: {
        repositoryId: "11111111-1111-4111-8111-111111111111",
        targetBranch: "main",
        featureArea: "Login",
        goal: "Add coverage for invalid login.",
        acceptanceCriteria: "Assert the error message is visible.",
        captureContext: {
          url: "https://example.test/login",
          accessibleRole: "button",
          accessibleName: "Sign in",
          domSnippet: "<button>Sign in</button>",
          locatorCandidates: [
            {
              strategy: "role",
              value: "button[name='Sign in']",
            },
          ],
        },
      },
    });

    assert.equal(request.payload.captureContext?.accessibleRole, "button");
    assert.equal(request.payload.captureContext?.locatorCandidates[0]?.strategy, "role");
    assert.equal(request.payload.runAffectedTests, true);
    assert.equal(request.payload.createDraftPr, true);
  });

  it("parses readiness cleanup attention data", () => {
    const readiness = readinessResponseSchema.parse({
      api: {
        databaseConnected: true,
      },
      cleanup: {
        latestFailure: {
          baseBranch: "main",
          error: "branch delete failed",
          headBranch: "flawferret/job-123",
          href: "/jobs/job-1",
          jobId: "job-1",
          localPath: "/tmp/repo",
          message: "Local checkout cleanup failed after PR merge.",
        },
      },
      counts: {
        activeJobs: 0,
        blockedJobs: 0,
        cleanupFailures: 1,
        codexApprovalJobs: 0,
        completedJobs: 1,
        jobs: 1,
        needsReviewJobs: 0,
        prApprovalJobs: 0,
        prCreatedJobs: 0,
        repositories: 1,
      },
      nextAction: null,
      queue: {
        paused: false,
        pausedAt: null,
        resumedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      runner: {
        codexCommand: "codex",
        codexEnabled: false,
        heartbeatAgeSeconds: null,
        health: "offline",
        healthText: "No runner heartbeat.",
        id: null,
        lastHeartbeat: null,
        prCreationEnabled: false,
        slackConfigured: false,
        startCommand: "pnpm --filter @flawferret2/ferret-runner dev",
        status: null,
        validationCommandConfigured: false,
      },
    });

    assert.equal(readiness.counts.cleanupFailures, 1);
    assert.equal(readiness.cleanup.latestFailure?.error, "branch delete failed");
  });

  it("parses cucumber feature catalog and detail responses", () => {
    const repository = {
      cloneUrl: "https://github.com/rgmichaels/example.git",
      createdAt: new Date().toISOString(),
      defaultBranch: "main",
      id: "repo-1",
      localPath: "/tmp/example",
      name: "example",
      owner: "rgmichaels",
      provider: "GITHUB" as const,
      trackerIntegration: null,
      trackerIntegrationId: null,
      updatedAt: new Date().toISOString(),
      validationCommand: "pnpm test",
      webUrl: "https://github.com/rgmichaels/example",
    };
    const feature = {
      description: "Users sign in.",
      feature: "Login",
      modifiedAt: new Date().toISOString(),
      path: "features/login.feature",
      scenarioCount: 1,
      scenarios: [
        {
          keyword: "Scenario",
          line: 5,
          steps: [
            {
              keyword: "Given",
              line: 6,
              matchedDefinition: {
                expression: "I am on the login page",
                line: 3,
                path: "src/steps/login.steps.ts",
              },
              text: "I am on the login page",
            },
          ],
          name: "Valid login",
          tags: ["@smoke"],
          unmatchedStepCount: 0,
        },
      ],
      tags: ["@smoke"],
    };

    const catalog = cucumberFeatureCatalogResponseSchema.parse({
      features: [feature],
      localPath: "/tmp/example",
      repository,
      root: "features",
      totalScenarios: 1,
    });
    const detail = cucumberFeatureDetailResponseSchema.parse({
      associatedFiles: [
        {
          kind: "feature",
          path: "features/login.feature",
        },
      ],
      content: "Feature: Login",
      feature,
      localPath: "/tmp/example",
      repository,
    });

    assert.equal(catalog.features[0].feature, "Login");
    assert.equal(detail.associatedFiles[0].kind, "feature");
  });

  it("parses local test run responses", () => {
    const now = new Date().toISOString();
    const repository = {
      cloneUrl: "https://github.com/rgmichaels/example.git",
      createdAt: now,
      defaultBranch: "main",
      id: "repo-1",
      localPath: "/tmp/example",
      name: "example",
      owner: "rgmichaels",
      provider: "GITHUB" as const,
      trackerIntegration: null,
      trackerIntegrationId: null,
      updatedAt: now,
      validationCommand: "pnpm test",
      webUrl: "https://github.com/rgmichaels/example",
    };

    const run = localTestRunResponseSchema.parse({
      command: "npx cucumber-js 'features/login.feature:5'",
      completedAt: null,
      createdAt: now,
      durationMs: null,
      error: null,
      exitCode: null,
      featurePath: "features/login.feature",
      id: "run-1",
      repository,
      repositoryId: "repo-1",
      scenarioLine: 5,
      scope: "SCENARIO",
      startedAt: null,
      status: "QUEUED",
      stderrPath: null,
      stdoutPath: null,
      updatedAt: now,
      workerId: null,
    });

    assert.equal(run.scope, "SCENARIO");
    assert.equal(run.status, "QUEUED");
  });

  it("parses local test run stats responses", () => {
    const stats = localTestRunStatsResponseSchema.parse({
      averageDurationMs: 1200,
      canceledRuns: 1,
      completedRuns: 4,
      failedRuns: 1,
      failureRate: 0.25,
      maxDurationMs: 1500,
      minDurationMs: 900,
      passedRuns: 3,
      passRate: 0.75,
      queuedRuns: 2,
      runningRuns: 1,
      totalRuns: 7,
    });

    assert.equal(stats.passRate, 0.75);
    assert.equal(stats.averageDurationMs, 1200);
  });

  it("parses local test run output responses", () => {
    const output = localTestRunOutputResponseSchema.parse({
      stderr: "",
      stderrPath: ".flawferret-runs/local-test-runs/run-1/stderr.log",
      stdout: "1 scenario passed",
      stdoutPath: ".flawferret-runs/local-test-runs/run-1/stdout.log",
      truncated: false,
    });

    assert.equal(output.stdout, "1 scenario passed");
    assert.equal(output.truncated, false);
  });

  it("parses cucumber scenario explanation requests and responses", () => {
    const request = explainCucumberScenarioRequestSchema.parse({
      path: "features/login.feature",
      scenarioLine: 12,
    });
    const response = explainCucumberScenarioResponseSchema.parse({
      explanation: "This test opens login and verifies the error state.",
      provider: "local",
      scenarioLine: 12,
    });

    assert.equal(request.path, "features/login.feature");
    assert.equal(response.provider, "local");
  });

  it("parses page discovery recommendation requests and responses", () => {
    const request = discoverTestRecommendationsRequestSchema.parse({
      existingCoverage: [
        {
          feature: " Login ",
          path: " features/login.feature ",
          scenario: " Invalid login ",
          steps: [" Given I am on the login page "],
          tags: [" @auth "],
        },
      ],
      notes: "Focus auth and keyboard behavior.",
      pageUrl: "https://example.com/login",
    });
    const defaultRequest = discoverTestRecommendationsRequestSchema.parse({
      pageUrl: "https://example.com/login",
    });
    const response = discoverTestRecommendationsResponseSchema.parse({
      message: null,
      provider: "openai",
      recommendations: [
        {
          acceptance: ["Assert invalid credentials show an error."],
          impact: "High",
          reason: "Authentication failures are critical regression paths.",
          scenario: ["Given I am on the login page", "When I submit invalid credentials", "Then I should see an error"],
          tags: ["@auth", "@negative"],
          title: "Invalid login is rejected",
        },
      ],
    });

    assert.equal(request.maxRecommendations, 12);
    assert.equal(request.existingCoverage[0].feature, "Login");
    assert.deepEqual(defaultRequest.existingCoverage, []);
    assert.equal(response.recommendations[0].tags[0], "@auth");
  });

  it("parses persisted page discovery runs", () => {
    const recommendation = {
      acceptance: ["Assert invalid credentials show an error."],
      impact: "High" as const,
      reason: "Authentication failures are critical regression paths.",
      scenario: ["Given I am on the login page", "When I submit invalid credentials", "Then I should see an error"],
      tags: ["@auth", "@negative"],
      title: "Invalid login is rejected",
    };
    const coverage = {
      feature: "Login",
      path: "features/login.feature",
      scenario: "Invalid login",
      steps: ["Given I am on the login page"],
      tags: ["@auth"],
    };
    const decision = discoverCoverageDecisionSchema.parse({
      matchedCoverage: coverage,
      recommendation,
      reason: "Existing coverage already checks this path.",
      score: 0.72,
      status: "hide",
    });
    const request = createDiscoverRunRequestSchema.parse({
      hiddenDecisions: [decision],
      notes: "Focus auth.",
      pageUrl: "https://example.com/login",
      provider: "AI gap analysis",
      relatedCoverage: [coverage],
      repositoryId: "11111111-1111-4111-8111-111111111111",
      targetBranch: "main",
      visibleDecisions: [
        {
          ...decision,
          matchedCoverage: null,
          reason: "Worth adding.",
          score: 0.2,
          status: "keep",
        },
      ],
    });
    const queued = updateDiscoverRunQueuedRequestSchema.parse({
      queuedTitles: ["Invalid login is rejected"],
    });
    const response = discoverRunResponseSchema.parse({
      ...request,
      createdAt: new Date().toISOString(),
      id: "run-1",
      queuedTitles: queued.queuedTitles,
      repository: {
        cloneUrl: "https://github.com/rgmichaels/example.git",
        createdAt: new Date().toISOString(),
        defaultBranch: "main",
        id: request.repositoryId,
        localPath: "/tmp/example",
        name: "example",
        owner: "rgmichaels",
        provider: "GITHUB",
        trackerIntegration: null,
        trackerIntegrationId: null,
        updatedAt: new Date().toISOString(),
        validationCommand: "pnpm test",
        webUrl: "https://github.com/rgmichaels/example",
      },
      updatedAt: new Date().toISOString(),
    });

    assert.equal(request.provider, "AI gap analysis");
    assert.equal(response.hiddenDecisions[0].status, "hide");
    assert.deepEqual(response.queuedTitles, ["Invalid login is rejected"]);
  });

  it("parses paginated job responses", () => {
    const job = {
      claimedAt: null,
      claimedBy: null,
      completedAt: null,
      createdAt: new Date().toISOString(),
      id: "job-1",
      jobType: "ADD_PLAYWRIGHT_TEST" as const,
      latestRun: null,
      payload: {
        acceptanceCriteria: "Focused coverage is added.",
        createDraftPr: true,
        featureArea: "Login",
        goal: "Add login coverage.",
        repositoryId: "11111111-1111-4111-8111-111111111111",
        runAffectedTests: true,
        targetBranch: "main",
      },
      priority: "NORMAL" as const,
      repository: null,
      status: "QUEUED" as const,
      updatedAt: new Date().toISOString(),
    };

    const response = paginatedJobsResponseSchema.parse({
      jobs: [job],
      page: 1,
      pageSize: 10,
      total: 1,
    });

    assert.equal(response.jobs[0].id, "job-1");
    assert.equal(response.total, 1);
  });

  it("parses tracker integration requests without exposing API tokens in responses", () => {
    const request = createTrackerIntegrationRequestSchema.parse({
      apiToken: " secret-token ",
      baseUrl: " https://example.atlassian.net/ ",
      email: "qa@example.com",
      issueType: "Task",
      name: " QA Jira ",
      projectKey: "IPCT",
    });

    assert.equal(request.baseUrl, "https://example.atlassian.net");
    assert.equal(request.name, "QA Jira");
    assert.equal(request.apiToken, "secret-token");

    const response = trackerIntegrationResponseSchema.parse({
      baseUrl: request.baseUrl,
      createdAt: new Date().toISOString(),
      email: request.email,
      hasApiToken: true,
      id: "tracker-1",
      issueType: request.issueType,
      name: request.name,
      projectKey: request.projectKey,
      provider: "JIRA",
      updatedAt: new Date().toISOString(),
    });

    assert.equal("apiToken" in response, false);
  });

  it("parses framework template preview requests and responses", () => {
    const request = frameworkTemplateRequestSchema.parse({
      baseUrl: " https://example.test/app ",
      features: ["pageObjects", "apiTesting", "accessibility", "githubActions", "sampleFeature"],
      packageName: "@example/qa-framework",
      projectName: " Example QA Framework ",
      targetDirectory: " qa/e2e ",
    });

    assert.equal(request.baseUrl, "https://example.test/app");
    assert.equal(request.projectName, "Example QA Framework");
    assert.deepEqual(request.features, [
      "pageObjects",
      "apiTesting",
      "accessibility",
      "githubActions",
      "sampleFeature",
    ]);

    const response = frameworkTemplatePreviewResponseSchema.parse({
      directories: ["qa/e2e/src"],
      files: [
        {
          category: "config",
          contentPreview: "{",
          description: "Package manifest",
          path: "qa/e2e/package.json",
          sizeBytes: 10,
        },
      ],
      installCommand: "pnpm install",
      packageName: request.packageName,
      projectName: request.projectName,
      runCommand: "pnpm test",
      targetDirectory: request.targetDirectory,
      totalFiles: 1,
    });

    assert.equal(response.files[0].path, "qa/e2e/package.json");
    assert.equal(response.totalFiles, 1);
  });
});
