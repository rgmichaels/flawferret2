import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReadinessResponse } from "@flawferret2/job-schemas";
import { getReadinessNextAction } from "./view-model.js";

const baseReadiness: ReadinessResponse = {
  api: {
    databaseConnected: true,
  },
  cleanup: {
    latestFailure: null,
  },
  counts: {
    activeJobs: 0,
    blockedJobs: 0,
    cleanupFailures: 0,
    codexApprovalJobs: 0,
    completedJobs: 0,
    jobs: 0,
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
};

describe("readiness view model", () => {
  it("points operators at cleanup failures when no pipeline work is waiting", () => {
    const action = getReadinessNextAction({
      ...baseReadiness,
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
        ...baseReadiness.counts,
        cleanupFailures: 1,
      },
    });

    assert.equal(action.label, "Resolve local cleanup");
    assert.equal(action.href, "/jobs/job-1");
  });

  it("keeps blocked jobs ahead of cleanup failures", () => {
    const action = getReadinessNextAction({
      ...baseReadiness,
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
        ...baseReadiness.counts,
        blockedJobs: 1,
        cleanupFailures: 1,
      },
    });

    assert.equal(action.label, "Open a blocked job");
  });
});
