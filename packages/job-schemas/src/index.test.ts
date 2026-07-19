import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  captureContextSchema,
  createJobRequestSchema,
  jobEventTypeSchema,
  readinessResponseSchema,
  retryStageRequestSchema,
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
});
