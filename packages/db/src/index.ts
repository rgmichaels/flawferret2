import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { Job, LocalTestRun, Prisma, Repository, Run, Scenario, Worker } from "@prisma/client";

export type ClaimNextQueuedJobResult = Awaited<ReturnType<typeof claimNextQueuedJob>>;
export type ClaimedJob = NonNullable<ClaimNextQueuedJobResult["job"]>;
export type ClaimNextApprovedCodexJobResult = Awaited<ReturnType<typeof claimNextApprovedCodexJob>>;
export type ClaimedCodexJob = NonNullable<ClaimNextApprovedCodexJobResult["job"]>;
export type ClaimNextValidatingJobResult = Awaited<ReturnType<typeof claimNextValidatingJob>>;
export type ClaimedValidatingJob = NonNullable<ClaimNextValidatingJobResult["job"]>;
export type ClaimNextReviewJobResult = Awaited<ReturnType<typeof claimNextReviewJob>>;
export type ClaimedReviewJob = NonNullable<ClaimNextReviewJobResult["job"]>;
export type ClaimNextPrCreatedJobResult = Awaited<ReturnType<typeof claimNextPrCreatedJob>>;
export type ClaimedPrCreatedJob = NonNullable<ClaimNextPrCreatedJobResult["job"]>;
export type ClaimNextLocalTestRunResult = Awaited<ReturnType<typeof claimNextLocalTestRun>>;
export type ClaimedLocalTestRun = NonNullable<ClaimNextLocalTestRunResult["run"]>;

export const DEFAULT_QUEUE_CONTROL_ID = "default";

export const appendJobEvent = async ({
  jobId,
  eventType,
  message,
  metadata,
}: {
  jobId: string;
  eventType:
    | "JOB_CREATED"
    | "JOB_APPROVED"
    | "JOB_UPDATED"
    | "JOB_CLAIMED"
    | "JOB_RUNNING"
    | "RUN_STARTED"
    | "WORKER_SIMULATED_WORK_COMPLETE"
    | "JOB_RESET"
    | "JOB_CANCELED"
    | "REPOSITORY_CHECKOUT_VALIDATION_STARTED"
    | "REPOSITORY_CHECKOUT_VALIDATED"
    | "WORK_BRANCH_PREPARATION_STARTED"
    | "TARGET_BRANCH_CHECKED_OUT"
    | "WORK_BRANCH_CREATED"
    | "CODEX_APPROVAL_REQUIRED"
    | "CODEX_APPROVAL_GRANTED"
    | "CODEX_INVOCATION_READY"
    | "CODEX_INVOCATION_SKIPPED"
    | "CODEX_INVOCATION_STARTED"
    | "CODEX_INVOCATION_COMPLETED"
    | "CODEX_INVOCATION_FAILED"
    | "VALIDATION_STARTED"
    | "VALIDATION_COMPLETED"
    | "VALIDATION_FAILED"
    | "PR_CREATION_STARTED"
    | "WORK_BRANCH_COMMITTED"
    | "WORK_BRANCH_PUSHED"
    | "PR_CREATED"
    | "PR_CHECKS_PENDING"
    | "PR_CHECKS_PASSED"
    | "PR_CHECKS_FAILED"
    | "PR_MERGED"
    | "PR_CLOSED"
    | "LOCAL_CHECKOUT_CLEANUP_COMPLETED"
    | "LOCAL_CHECKOUT_CLEANUP_FAILED"
    | "PR_CREATION_FAILED"
    | "PR_CREATION_APPROVED"
    | "JOB_BLOCKED"
    | "JIRA_TICKET_CREATED"
    | "JIRA_TICKET_CREATION_FAILED"
    | "JIRA_TICKET_CREATION_SKIPPED"
    | "PR_CHECKS_AUTO_RETRY_QUEUED"
    | "WORKTREE_CREATED"
    | "WORKTREE_CREATION_FAILED"
    | "WORKTREE_REMOVED"
    | "WORKTREE_REMOVAL_FAILED"
    | "DEPENDENCY_INSTALL_STARTED"
    | "DEPENDENCY_INSTALL_COMPLETED"
    | "DEPENDENCY_INSTALL_FAILED";
  message: string;
  metadata?: Prisma.InputJsonValue;
}) =>
  prisma.jobEvent.create({
    data: {
      jobId,
      eventType,
      message,
      metadata,
    },
  });

const priorityRankSql = Prisma.sql`
  CASE priority
    WHEN 'URGENT' THEN 4
    WHEN 'HIGH' THEN 3
    WHEN 'NORMAL' THEN 2
    WHEN 'LOW' THEN 1
    ELSE 0
  END
`;

export const heartbeatWorker = async ({
  workerId,
  hostname,
  version,
  currentJob = null,
  status = "IDLE",
}: {
  workerId: string;
  hostname: string;
  version: string;
  currentJob?: string | null;
  status?: "IDLE" | "BUSY" | "OFFLINE" | "ERROR";
}) =>
  prisma.worker.upsert({
    where: {
      id: workerId,
    },
    update: {
      currentJob,
      hostname,
      lastHeartbeat: new Date(),
      status,
      version,
    },
    create: {
      id: workerId,
      currentJob,
      hostname,
      status,
      version,
    },
  });

export const getQueueControl = async () =>
  prisma.queueControl.upsert({
    where: {
      id: DEFAULT_QUEUE_CONTROL_ID,
    },
    update: {},
    create: {
      id: DEFAULT_QUEUE_CONTROL_ID,
      paused: false,
      resumedAt: new Date(),
    },
  });

export const pauseQueue = async () =>
  prisma.queueControl.upsert({
    where: {
      id: DEFAULT_QUEUE_CONTROL_ID,
    },
    update: {
      paused: true,
      pausedAt: new Date(),
    },
    create: {
      id: DEFAULT_QUEUE_CONTROL_ID,
      paused: true,
      pausedAt: new Date(),
    },
  });

export const resumeQueue = async () =>
  prisma.queueControl.upsert({
    where: {
      id: DEFAULT_QUEUE_CONTROL_ID,
    },
    update: {
      paused: false,
      resumedAt: new Date(),
    },
    create: {
      id: DEFAULT_QUEUE_CONTROL_ID,
      paused: false,
      resumedAt: new Date(),
    },
  });

export const claimNextQueuedJob = async (workerId: string) =>
  prisma.$transaction(async (tx) => {
    const queueControl = await tx.queueControl.upsert({
      where: {
        id: DEFAULT_QUEUE_CONTROL_ID,
      },
      update: {},
      create: {
        id: DEFAULT_QUEUE_CONTROL_ID,
        paused: false,
        resumedAt: new Date(),
      },
    });

    if (queueControl.paused) {
      return {
        job: null,
        queuePaused: true,
      };
    }

    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM jobs
      WHERE status = 'QUEUED'
      ORDER BY ${priorityRankSql} DESC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const candidate = candidates[0];

    if (!candidate) {
      return {
        job: null,
        queuePaused: false,
      };
    }

    const job = await tx.job.update({
      where: {
        id: candidate.id,
      },
      data: {
        claimedAt: new Date(),
        claimedBy: workerId,
        status: "CLAIMED",
      },
      include: {
        repository: true,
      },
    });

    return {
      job,
      queuePaused: false,
    };
  });

export const claimNextApprovedCodexJob = async (workerId: string) =>
  prisma.$transaction(async (tx) => {
    const queueControl = await tx.queueControl.upsert({
      where: {
        id: DEFAULT_QUEUE_CONTROL_ID,
      },
      update: {},
      create: {
        id: DEFAULT_QUEUE_CONTROL_ID,
        paused: false,
        resumedAt: new Date(),
      },
    });

    if (queueControl.paused) {
      return {
        job: null,
        queuePaused: true,
      };
    }

    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM jobs
      WHERE status = 'CODEX_APPROVED'
      ORDER BY updated_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const candidate = candidates[0];

    if (!candidate) {
      return {
        job: null,
        queuePaused: false,
      };
    }

    const job = await tx.job.update({
      where: {
        id: candidate.id,
      },
      data: {
        claimedAt: new Date(),
        claimedBy: workerId,
        status: "RUNNING",
      },
      include: {
        repository: true,
        runs: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
    });

    return {
      job,
      queuePaused: false,
    };
  });

export const claimNextValidatingJob = async (workerId: string) =>
  prisma.$transaction(async (tx) => {
    const queueControl = await tx.queueControl.upsert({
      where: {
        id: DEFAULT_QUEUE_CONTROL_ID,
      },
      update: {},
      create: {
        id: DEFAULT_QUEUE_CONTROL_ID,
        paused: false,
        resumedAt: new Date(),
      },
    });

    if (queueControl.paused) {
      return {
        job: null,
        queuePaused: true,
      };
    }

    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM jobs
      WHERE status = 'VALIDATING'
      ORDER BY updated_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const candidate = candidates[0];

    if (!candidate) {
      return {
        job: null,
        queuePaused: false,
      };
    }

    const job = await tx.job.update({
      where: {
        id: candidate.id,
      },
      data: {
        claimedAt: new Date(),
        claimedBy: workerId,
      },
      include: {
        repository: true,
        runs: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
    });

    return {
      job,
      queuePaused: false,
    };
  });

export const claimNextReviewJob = async (workerId: string) =>
  prisma.$transaction(async (tx) => {
    const queueControl = await tx.queueControl.upsert({
      where: {
        id: DEFAULT_QUEUE_CONTROL_ID,
      },
      update: {},
      create: {
        id: DEFAULT_QUEUE_CONTROL_ID,
        paused: false,
        resumedAt: new Date(),
      },
    });

    if (queueControl.paused) {
      return {
        job: null,
        queuePaused: true,
      };
    }

    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM jobs
      WHERE status = 'PR_APPROVED'
      ORDER BY updated_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const candidate = candidates[0];

    if (!candidate) {
      return {
        job: null,
        queuePaused: false,
      };
    }

    const job = await tx.job.update({
      where: {
        id: candidate.id,
      },
      data: {
        claimedAt: new Date(),
        claimedBy: workerId,
      },
      include: {
        repository: true,
        runs: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
    });

    return {
      job,
      queuePaused: false,
    };
  });

export const claimNextPrCreatedJob = async (workerId: string) =>
  prisma.$transaction(async (tx) => {
    const queueControl = await tx.queueControl.upsert({
      where: {
        id: DEFAULT_QUEUE_CONTROL_ID,
      },
      update: {},
      create: {
        id: DEFAULT_QUEUE_CONTROL_ID,
        paused: false,
        resumedAt: new Date(),
      },
    });

    if (queueControl.paused) {
      return {
        job: null,
        queuePaused: true,
      };
    }

    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM jobs
      WHERE status = 'PR_CREATED'
      ORDER BY updated_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const candidate = candidates[0];

    if (!candidate) {
      return {
        job: null,
        queuePaused: false,
      };
    }

    const job = await tx.job.update({
      where: {
        id: candidate.id,
      },
      data: {
        claimedAt: new Date(),
        claimedBy: workerId,
      },
      include: {
        repository: true,
        runs: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
    });

    return {
      job,
      queuePaused: false,
    };
  });

export const claimNextLocalTestRun = async (workerId: string) =>
  prisma.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM local_test_runs
      WHERE status = 'QUEUED'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const candidate = candidates[0];

    if (!candidate) {
      return {
        run: null,
      };
    }

    const run = await tx.localTestRun.update({
      where: {
        id: candidate.id,
      },
      data: {
        startedAt: new Date(),
        status: "RUNNING",
        workerId,
      },
      include: {
        repository: true,
      },
    });

    return {
      run,
    };
  });

export const markLocalTestRunPassed = async ({
  command,
  exitCode,
  runId,
  stderrPath,
  stdoutPath,
}: {
  command: string;
  exitCode: number | null;
  runId: string;
  stderrPath: string;
  stdoutPath: string;
}) =>
  prisma.localTestRun.update({
    where: {
      id: runId,
    },
    data: {
      command,
      completedAt: new Date(),
      exitCode,
      stderrPath,
      stdoutPath,
      status: "PASSED",
    },
    include: {
      repository: true,
    },
  });

export const markLocalTestRunFailed = async ({
  command,
  error,
  exitCode,
  runId,
  stderrPath,
  stdoutPath,
}: {
  command: string;
  error?: string | null;
  exitCode: number | null;
  runId: string;
  stderrPath: string;
  stdoutPath: string;
}) =>
  prisma.localTestRun.update({
    where: {
      id: runId,
    },
    data: {
      command,
      completedAt: new Date(),
      error,
      exitCode,
      stderrPath,
      stdoutPath,
      status: "FAILED",
    },
    include: {
      repository: true,
    },
  });

export type ScenarioSnapshot = {
  contentHash: string;
  idSource: "tag" | "fingerprint";
  lastSeenLine: number;
  lastSeenName: string;
  lastSeenPath: string;
  scenarioId: string;
};

const SCENARIO_UPSERT_BATCH_SIZE = 500;

/**
 * Records the scenarios seen in a parse of a repository checkout. One
 * `INSERT ... ON CONFLICT` per batch keeps this to a handful of statements
 * regardless of catalog size. Seen rows get `missingSince` cleared. When
 * `markMissing` is set (full-catalog parses only), existing rows of the
 * repository whose ID is not in `presentScenarioIds` (defaults to the upserted
 * IDs) get `missingSince` set. Rows are never deleted.
 */
export const syncRepositoryScenarios = async ({
  markMissing,
  presentScenarioIds,
  repositoryId,
  scenarios,
  seenAt = new Date(),
}: {
  markMissing: boolean;
  presentScenarioIds?: string[];
  repositoryId: string;
  scenarios: ScenarioSnapshot[];
  seenAt?: Date;
}) => {
  const uniqueScenarios = [...new Map(scenarios.map((scenario) => [scenario.scenarioId, scenario])).values()];
  const batches: ScenarioSnapshot[][] = [];
  for (let index = 0; index < uniqueScenarios.length; index += SCENARIO_UPSERT_BATCH_SIZE) {
    batches.push(uniqueScenarios.slice(index, index + SCENARIO_UPSERT_BATCH_SIZE));
  }

  return prisma.$transaction(async (tx) => {
    let upserted = 0;

    for (const batch of batches) {
      const values = batch.map(
        (scenario) => Prisma.sql`(
          ${randomUUID()}::uuid,
          ${repositoryId}::uuid,
          ${scenario.scenarioId},
          ${scenario.lastSeenPath},
          ${scenario.lastSeenLine},
          ${scenario.lastSeenName},
          ${scenario.contentHash},
          ${scenario.idSource},
          ${seenAt},
          ${seenAt}
        )`,
      );

      upserted += await tx.$executeRaw`
        INSERT INTO scenarios (
          id, repository_id, scenario_id, last_seen_path, last_seen_line, last_seen_name,
          content_hash, id_source, first_seen_at, last_seen_at
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT (repository_id, scenario_id) DO UPDATE SET
          last_seen_path = EXCLUDED.last_seen_path,
          last_seen_line = EXCLUDED.last_seen_line,
          last_seen_name = EXCLUDED.last_seen_name,
          content_hash = EXCLUDED.content_hash,
          id_source = EXCLUDED.id_source,
          last_seen_at = EXCLUDED.last_seen_at,
          missing_since = NULL
      `;
    }

    const markedMissing = markMissing
      ? (
          await tx.scenario.updateMany({
            data: {
              missingSince: seenAt,
            },
            where: {
              missingSince: null,
              repositoryId,
              scenarioId: {
                notIn: presentScenarioIds ?? uniqueScenarios.map((scenario) => scenario.scenarioId),
              },
            },
          })
        ).count
      : 0;

    return {
      markedMissing,
      upserted,
    };
  });
};

/** Distinct (featurePath, scenarioLine) targets of SCENARIO runs that predate scenario IDs. */
export const listLocalTestRunTargetsWithoutScenarioId = async ({ repositoryId }: { repositoryId: string }) =>
  (
    await prisma.localTestRun.groupBy({
      by: ["featurePath", "scenarioLine"],
      orderBy: [{ featurePath: "asc" }, { scenarioLine: "asc" }],
      where: {
        repositoryId,
        scenarioId: null,
        scenarioLine: {
          not: null,
        },
        scope: "SCENARIO",
      },
    })
  ).flatMap((target) =>
    target.scenarioLine === null ? [] : [{ featurePath: target.featurePath, scenarioLine: target.scenarioLine }],
  );

export const assignLocalTestRunScenarioId = async ({
  featurePath,
  repositoryId,
  scenarioId,
  scenarioLine,
}: {
  featurePath: string;
  repositoryId: string;
  scenarioId: string;
  scenarioLine: number;
}) =>
  (
    await prisma.localTestRun.updateMany({
      data: {
        scenarioId,
      },
      where: {
        featurePath,
        repositoryId,
        scenarioId: null,
        scenarioLine,
        scope: "SCENARIO",
      },
    })
  ).count;

export const markJobRunning = async ({
  jobId,
  workerId,
}: {
  jobId: string;
  workerId: string;
}) =>
  prisma.job.update({
    where: {
      id: jobId,
    },
    data: {
      claimedBy: workerId,
      status: "RUNNING",
    },
    include: {
      repository: true,
    },
  });

export const markJobBlocked = async ({
  jobId,
  workerId,
}: {
  jobId: string;
  workerId: string;
}) =>
  prisma.job.update({
    where: {
      id: jobId,
    },
    data: {
      claimedBy: workerId,
      completedAt: new Date(),
      status: "BLOCKED",
    },
    include: {
      repository: true,
    },
  });

export const markJobValidating = async ({
  jobId,
  workerId,
}: {
  jobId: string;
  workerId: string;
}) =>
  prisma.job.update({
    where: {
      id: jobId,
    },
    data: {
      claimedBy: workerId,
      status: "VALIDATING",
    },
    include: {
      repository: true,
    },
  });

export const markJobReview = async ({
  jobId,
  workerId,
}: {
  jobId: string;
  workerId: string;
}) =>
  prisma.job.update({
    where: {
      id: jobId,
    },
    data: {
      claimedBy: workerId,
      status: "REVIEW",
    },
    include: {
      repository: true,
    },
  });

export const approveJobForPrCreation = async ({ jobId }: { jobId: string }) =>
  prisma.job.updateMany({
    where: {
      id: jobId,
      status: "REVIEW",
    },
    data: {
      status: "PR_APPROVED",
    },
  });

export const markJobCompleted = async ({
  jobId,
  workerId,
}: {
  jobId: string;
  workerId: string;
}) =>
  prisma.job.update({
    where: {
      id: jobId,
    },
    data: {
      claimedBy: workerId,
      completedAt: new Date(),
      status: "COMPLETED",
    },
    include: {
      repository: true,
    },
  });

export const markJobPrCreated = async ({
  jobId,
  workerId,
}: {
  jobId: string;
  workerId: string;
}) =>
  prisma.job.update({
    where: {
      id: jobId,
    },
    data: {
      claimedBy: workerId,
      status: "PR_CREATED",
    },
    include: {
      repository: true,
    },
  });

export const markJobReadyForCodex = async ({
  jobId,
  workerId,
}: {
  jobId: string;
  workerId: string;
}) =>
  prisma.job.update({
    where: {
      id: jobId,
    },
    data: {
      claimedBy: workerId,
      status: "READY_FOR_CODEX",
    },
    include: {
      repository: true,
    },
  });

export const createJobRun = async ({
  jobId,
  workerId,
  metadata,
}: {
  jobId: string;
  workerId: string;
  metadata?: Prisma.InputJsonValue;
}) =>
  prisma.run.create({
    data: {
      jobId,
      metadata,
      status: "STARTED",
      workerId,
    },
  });

export const updateRunMetadata = async ({
  runId,
  metadata,
}: {
  runId: string;
  metadata: Prisma.InputJsonValue;
}) =>
  prisma.run.update({
    where: {
      id: runId,
    },
    data: {
      metadata,
    },
  });

export const markRunCodexRunning = async ({
  runId,
  metadata,
}: {
  runId: string;
  metadata?: Prisma.InputJsonValue;
}) =>
  prisma.run.update({
    where: {
      id: runId,
    },
    data: {
      metadata,
      status: "CODEX_RUNNING",
    },
  });

export const markRunFailed = async ({
  runId,
  metadata,
}: {
  runId: string;
  metadata?: Prisma.InputJsonValue;
}) =>
  prisma.run.update({
    where: {
      id: runId,
    },
    data: {
      completedAt: new Date(),
      metadata,
      status: "FAILED",
    },
  });

export const markRunValidating = async ({
  runId,
  metadata,
}: {
  runId: string;
  metadata?: Prisma.InputJsonValue;
}) =>
  prisma.run.update({
    where: {
      id: runId,
    },
    data: {
      metadata,
      status: "VALIDATING",
    },
  });

export const markRunSucceeded = async ({
  runId,
  metadata,
}: {
  runId: string;
  metadata?: Prisma.InputJsonValue;
}) =>
  prisma.run.update({
    where: {
      id: runId,
    },
    data: {
      completedAt: new Date(),
      metadata,
      status: "SUCCEEDED",
    },
  });

export const markRunPushing = async ({
  runId,
  metadata,
}: {
  runId: string;
  metadata?: Prisma.InputJsonValue;
}) =>
  prisma.run.update({
    where: {
      id: runId,
    },
    data: {
      metadata,
      status: "PUSHING",
    },
  });

export const markRunPrCreated = async ({
  runId,
  metadata,
}: {
  runId: string;
  metadata?: Prisma.InputJsonValue;
}) =>
  prisma.run.update({
    where: {
      id: runId,
    },
    data: {
      completedAt: new Date(),
      metadata,
      status: "PR_CREATED",
    },
  });

export const markRunReadyForCodex = async ({ runId }: { runId: string }) =>
  prisma.run.update({
    where: {
      id: runId,
    },
    data: {
      status: "READY_FOR_CODEX",
    },
  });

export const approveJobForCodex = async ({ jobId }: { jobId: string }) =>
  prisma.job.updateMany({
    where: {
      id: jobId,
      status: "READY_FOR_CODEX",
    },
    data: {
      status: "CODEX_APPROVED",
    },
  });

/**
 * Auto-heal path for `CHECKS_FAILED`: requeues the job straight into
 * `CODEX_APPROVED`, bypassing the manual `approve-codex` gate, and bumps the
 * durable `autoRetryCount` counter. Mirrors the metadata-clearing shape the
 * manual `/jobs/:id/retry-stage` route writes (see apps/api/src/server.ts),
 * but reuses the existing run instead of creating a new one.
 *
 * The job is only claimed for auto-retry out of `PR_CREATED` — the status
 * `claimNextPrCreatedJob` leaves jobs in while ferret-runner polls PR
 * lifecycle. Guards the write with `updateMany` (mirroring
 * `approveJobForCodex`) so that if another writer already moved the job off
 * `PR_CREATED` (e.g. a manual cancel/requeue) this becomes a no-op instead of
 * clobbering that write, and returns `{ job: null }` for the caller to handle
 * the same way `approveJobForCodex`'s HTTP caller handles a 0-row update.
 */
export const queueAutomaticCodexRetry = async ({
  jobId,
  runId,
  runMetadata,
}: {
  jobId: string;
  runId: string;
  runMetadata: Prisma.InputJsonValue;
}) =>
  prisma.$transaction(async (tx) => {
    const updateResult = await tx.job.updateMany({
      where: {
        id: jobId,
        status: "PR_CREATED",
      },
      data: {
        autoRetryCount: {
          increment: 1,
        },
        claimedAt: null,
        claimedBy: null,
        completedAt: null,
        status: "CODEX_APPROVED",
      },
    });

    if (updateResult.count === 0) {
      return {
        job: null,
      };
    }

    await tx.run.update({
      where: {
        id: runId,
      },
      data: {
        completedAt: null,
        metadata: runMetadata,
        status: "READY_FOR_CODEX",
      },
    });

    const job = await tx.job.findUniqueOrThrow({
      where: {
        id: jobId,
      },
      include: {
        repository: true,
        runs: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
    });

    return {
      job,
    };
  });

export const resetJobToReadyForCodex = async ({
  jobId,
  workerId,
}: {
  jobId: string;
  workerId: string;
}) =>
  prisma.job.update({
    where: {
      id: jobId,
    },
    data: {
      claimedBy: workerId,
      status: "READY_FOR_CODEX",
    },
    include: {
      repository: true,
    },
  });

export const markSimulatedWorkSucceeded = async ({
  jobId,
  runId,
}: {
  jobId: string;
  runId: string;
}) => {
  const completedAt = new Date();

  return prisma.$transaction(async (tx) => {
    const run = await tx.run.update({
      where: {
        id: runId,
      },
      data: {
        completedAt,
        status: "SUCCEEDED",
      },
    });

    const job = await tx.job.update({
      where: {
        id: jobId,
      },
      data: {
        completedAt,
        status: "COMPLETED",
      },
      include: {
        repository: true,
      },
    });

    return {
      job,
      run,
    };
  });
};

export const listRepositoriesWithLocalPath = async () =>
  prisma.repository.findMany({
    select: {
      id: true,
      localPath: true,
    },
    where: {
      localPath: {
        not: null,
      },
    },
  });

export const findJobsForWorktreeSweep = async (jobIds: string[]) =>
  prisma.job.findMany({
    select: {
      completedAt: true,
      id: true,
      status: true,
      updatedAt: true,
    },
    where: {
      id: {
        in: jobIds,
      },
    },
  });
