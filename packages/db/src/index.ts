import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { Job, Prisma, Repository, Run, Worker } from "@prisma/client";

export type ClaimedJob = Awaited<ReturnType<typeof claimNextQueuedJob>>;

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
    | "JOB_RESET";
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

export const claimNextQueuedJob = async (workerId: string) =>
  prisma.$transaction(async (tx) => {
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
      return null;
    }

    return tx.job.update({
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
