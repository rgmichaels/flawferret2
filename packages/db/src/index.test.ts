import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { config as loadEnv } from "dotenv";

loadEnv({
  path: resolve(process.cwd(), "../../.env"),
});

const { DEFAULT_QUEUE_CONTROL_ID, prisma, queueAutomaticCodexRetry } = await import("./index.js");

describe("db exports", () => {
  it("uses a stable default queue control id", () => {
    assert.equal(DEFAULT_QUEUE_CONTROL_ID, "default");
  });
});

describe("queueAutomaticCodexRetry", () => {
  const jobIds: string[] = [];
  const repositoryIds: string[] = [];

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

  const createPrCreatedJob = async (status: "PR_CREATED" | "BLOCKED" = "PR_CREATED") => {
    const suffix = randomUUID().slice(0, 8);
    const repository = await prisma.repository.create({
      data: {
        cloneUrl: `https://github.com/rgmichaels/test-${suffix}.git`,
        defaultBranch: "main",
        name: `test-${suffix}`,
        owner: "rgmichaels",
        webUrl: `https://github.com/rgmichaels/test-${suffix}`,
      },
    });
    repositoryIds.push(repository.id);

    const job = await prisma.job.create({
      data: {
        autoRetryCount: 0,
        jobType: "ADD_PLAYWRIGHT_TEST",
        payload: {
          acceptanceCriteria: "Adds useful coverage.",
          createDraftPr: true,
          featureArea: "Auto-retry race guard",
          goal: "Exercise the auto-retry status guard.",
          repositoryId: repository.id,
          runAffectedTests: true,
          targetBranch: "main",
        },
        repositoryId: repository.id,
        runs: {
          create: {
            status: "PR_CREATED",
            workerId: "test-worker",
          },
        },
        status,
      },
      include: {
        runs: true,
      },
    });
    jobIds.push(job.id);

    return job;
  };

  it("queues the retry and bumps autoRetryCount when the job is still PR_CREATED", async () => {
    const job = await createPrCreatedJob("PR_CREATED");
    const run = job.runs[0];

    const result = await queueAutomaticCodexRetry({
      jobId: job.id,
      runId: run.id,
      runMetadata: {
        retryFeedback: {
          feedback: "Test failed.",
        },
      },
    });

    assert.notEqual(result.job, null);
    assert.equal(result.job?.status, "CODEX_APPROVED");
    assert.equal(result.job?.autoRetryCount, 1);
    assert.equal(result.job?.claimedAt, null);
    assert.equal(result.job?.claimedBy, null);

    const updatedRun = await prisma.run.findUniqueOrThrow({
      where: {
        id: run.id,
      },
    });

    assert.equal(updatedRun.status, "READY_FOR_CODEX");
    assert.equal(updatedRun.completedAt, null);
  });

  it("allows exactly one winner when two auto-retries race against the same PR_CREATED job", async () => {
    const job = await createPrCreatedJob("PR_CREATED");
    const run = job.runs[0];

    const [first, second] = await Promise.all([
      queueAutomaticCodexRetry({
        jobId: job.id,
        runId: run.id,
        runMetadata: {
          retryFeedback: {
            feedback: "Test failed (writer one).",
          },
        },
      }),
      queueAutomaticCodexRetry({
        jobId: job.id,
        runId: run.id,
        runMetadata: {
          retryFeedback: {
            feedback: "Test failed (writer two).",
          },
        },
      }),
    ]);

    const results = [first, second];
    const winners = results.filter((result) => result.job !== null);
    const losers = results.filter((result) => result.job === null);

    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(winners[0]?.job?.autoRetryCount, 1);

    const finalJob = await prisma.job.findUniqueOrThrow({
      where: {
        id: job.id,
      },
    });

    assert.equal(finalJob.status, "CODEX_APPROVED");
    assert.equal(finalJob.autoRetryCount, 1);
  });

  it("is a no-op when another writer already moved the job off PR_CREATED", async () => {
    const job = await createPrCreatedJob("BLOCKED");
    const run = job.runs[0];

    const result = await queueAutomaticCodexRetry({
      jobId: job.id,
      runId: run.id,
      runMetadata: {
        retryFeedback: {
          feedback: "Test failed.",
        },
      },
    });

    assert.equal(result.job, null);

    const untouchedJob = await prisma.job.findUniqueOrThrow({
      where: {
        id: job.id,
      },
    });
    const untouchedRun = await prisma.run.findUniqueOrThrow({
      where: {
        id: run.id,
      },
    });

    assert.equal(untouchedJob.status, "BLOCKED");
    assert.equal(untouchedJob.autoRetryCount, 0);
    assert.equal(untouchedRun.status, "PR_CREATED");
  });
});
