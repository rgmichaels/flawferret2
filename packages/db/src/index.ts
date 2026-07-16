import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { Job, Prisma, Repository, Run, Worker } from "@prisma/client";

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
    | "PR_CREATION_FAILED"
    | "PR_CREATION_APPROVED"
    | "JOB_BLOCKED";
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
