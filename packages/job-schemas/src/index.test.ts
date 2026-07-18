import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jobEventTypeSchema, readinessResponseSchema, retryStageRequestSchema } from "./index.js";

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
