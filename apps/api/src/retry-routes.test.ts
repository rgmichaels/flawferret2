import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import { prisma, type Prisma } from "@flawferret2/db";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";

let server: FastifyInstance;
const jobIds: string[] = [];
const repositoryIds: string[] = [];

const createRepository = async () => {
  const suffix = randomUUID().slice(0, 8);
  const repository = await prisma.repository.create({
    data: {
      cloneUrl: `https://github.com/rgmichaels/test-${suffix}.git`,
      defaultBranch: "main",
      localPath: `/tmp/flawferret-test-${suffix}`,
      name: `test-${suffix}`,
      owner: "rgmichaels",
      validationCommand: "pnpm test",
      webUrl: `https://github.com/rgmichaels/test-${suffix}`,
    },
  });

  repositoryIds.push(repository.id);

  return repository;
};

const createJob = async ({
  metadata,
  runStatus = "FAILED",
  status,
}: {
  metadata?: Prisma.InputJsonValue;
  runStatus?: "FAILED" | "SUCCEEDED";
  status: "BLOCKED" | "COMPLETED" | "FAILED" | "PR_APPROVED" | "REVIEW" | "RETRY";
}) => {
  const repository = await createRepository();
  const job = await prisma.job.create({
    data: {
      jobType: "ADD_PLAYWRIGHT_TEST",
      payload: {
        acceptanceCriteria: "Adds useful coverage.",
        createDraftPr: true,
        featureArea: "Retry routes",
        goal: "Exercise retry route behavior.",
        repositoryId: repository.id,
        runAffectedTests: true,
        targetBranch: "main",
      },
      priority: "NORMAL",
      repositoryId: repository.id,
      runs: metadata
        ? {
            create: {
              metadata,
              status: runStatus,
              workerId: "test-worker",
            },
          }
        : undefined,
      status,
    },
  });

  jobIds.push(job.id);

  return job;
};

describe("retry routes", () => {
  before(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await prisma.job.deleteMany({
      where: {
        id: {
          in: jobIds.splice(0),
        },
      },
    });
    await prisma.repository.deleteMany({
      where: {
        id: {
          in: repositoryIds.splice(0),
        },
      },
    });
  });

  after(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  it("requeues blocked jobs for setup retry", async () => {
    const job = await createJob({
      status: "BLOCKED",
    });

    const response = await server.inject({
      method: "POST",
      url: `/jobs/${job.id}/requeue`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "QUEUED");

    const resetEvent = await prisma.jobEvent.findFirstOrThrow({
      where: {
        eventType: "JOB_RESET",
        jobId: job.id,
      },
    });

    assert.equal(resetEvent.message, "Job was requeued for setup retry.");
  });

  it("rejects requeue requests for non-retryable statuses", async () => {
    const job = await createJob({
      status: "COMPLETED",
    });

    const response = await server.inject({
      method: "POST",
      url: `/jobs/${job.id}/requeue`,
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().message, "Only blocked, failed, or retry jobs can be requeued.");
  });

  it("returns validation-attempt jobs to validation retry", async () => {
    const job = await createJob({
      metadata: {
        validation: {
          command: "pnpm test",
          error: "validation failed",
        },
      },
      status: "BLOCKED",
    });

    const response = await server.inject({
      method: "POST",
      url: `/jobs/${job.id}/retry-stage`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "VALIDATING");

    const run = await prisma.run.findFirstOrThrow({
      where: {
        jobId: job.id,
      },
    });

    assert.equal(run.status, "VALIDATING");
  });

  it("returns Codex-attempt jobs to Codex approval when retry feedback is supplied", async () => {
    const job = await createJob({
      metadata: {
        codex: {
          finalResponse: "Needs a more focused assertion.",
        },
        pullRequest: {
          prUrl: "https://github.com/rgmichaels/test/pull/1",
        },
        validation: {
          command: "pnpm test",
        },
      },
      status: "REVIEW",
    });

    const response = await server.inject({
      body: {
        feedback: "Assert the empty state text.",
      },
      method: "POST",
      url: `/jobs/${job.id}/retry-stage`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "READY_FOR_CODEX");

    const run = await prisma.run.findFirstOrThrow({
      where: {
        jobId: job.id,
      },
    });
    const metadata = run.metadata as Record<string, unknown>;

    assert.equal(run.status, "READY_FOR_CODEX");
    assert.equal("pullRequest" in metadata, false);
    assert.equal("validation" in metadata, false);
    assert.deepEqual((metadata.retryFeedback as Record<string, unknown>).feedback, "Assert the empty state text.");
  });

  it("reports local checkout cleanup failures in readiness", async () => {
    const job = await createJob({
      status: "COMPLETED",
    });
    await prisma.jobEvent.create({
      data: {
        eventType: "LOCAL_CHECKOUT_CLEANUP_FAILED",
        jobId: job.id,
        message: "Local checkout cleanup failed after PR merge.",
        metadata: {
          baseBranch: "main",
          error: "branch delete failed",
          headBranch: "flawferret/job-abc123",
          localPath: "/tmp/flawferret-test",
        },
      },
    });

    const response = await server.inject({
      method: "GET",
      url: "/readiness",
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.cleanup.latestFailure.jobId, job.id);
    assert.equal(body.cleanup.latestFailure.error, "branch delete failed");
    assert.equal(body.cleanup.latestFailure.href, `/jobs/${job.id}`);
    assert.equal(body.counts.cleanupFailures >= 1, true);
  });
});
