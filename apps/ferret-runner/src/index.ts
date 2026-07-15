import {
  appendJobEvent,
  claimNextQueuedJob,
  createJobRun,
  heartbeatWorker,
  markJobBlocked,
  markJobRunning,
  markRunFailed,
  markSimulatedWorkSucceeded,
  prisma,
  updateRunMetadata,
} from "@flawferret2/db";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { config } from "./config.js";
import { validateRepositoryCheckout } from "./repository-checkout.js";
import { sleep } from "./sleep.js";
import { prepareWorkBranch } from "./work-branch.js";

const workerId = config.WORKER_ID ?? randomUUID();
const workerHostname = hostname();

let shouldStop = false;
let shutdownStarted = false;

const log = (message: string, metadata?: Record<string, unknown>) => {
  const entry = {
    level: "info",
    message,
    timestamp: new Date().toISOString(),
    workerId,
    ...metadata,
  };

  console.log(JSON.stringify(entry));
};

const getTargetBranch = (payload: unknown) => {
  if (payload && typeof payload === "object" && "targetBranch" in payload) {
    const targetBranch = (payload as { targetBranch?: unknown }).targetBranch;

    if (typeof targetBranch === "string" && targetBranch.length > 0) {
      return targetBranch;
    }
  }

  if (payload && typeof payload === "object" && "branch" in payload) {
    const branch = (payload as { branch?: unknown }).branch;

    if (typeof branch === "string" && branch.length > 0) {
      return branch;
    }
  }

  return "main";
};

const shutdown = async () => {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  shouldStop = true;
  log("Worker shutting down");

  await heartbeatWorker({
    workerId,
    hostname: workerHostname,
    status: "OFFLINE",
    version: config.WORKER_VERSION,
  });
  await prisma.$disconnect();
};

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

log("Worker starting", {
  hostname: workerHostname,
  pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
  simulatedWorkMs: config.WORKER_SIMULATED_WORK_MS,
});

while (!shouldStop) {
  await heartbeatWorker({
    workerId,
    hostname: workerHostname,
    status: "IDLE",
    version: config.WORKER_VERSION,
  });

  const claimResult = await claimNextQueuedJob(workerId);

  if (claimResult.queuePaused) {
    log("Queue is paused; skipping claim");
    await sleep(config.WORKER_POLL_INTERVAL_MS);
    continue;
  }

  if (!claimResult.job) {
    log("No queued jobs found");
    await sleep(config.WORKER_POLL_INTERVAL_MS);
    continue;
  }

  const claimedJob = claimResult.job;

  await appendJobEvent({
    jobId: claimedJob.id,
    eventType: "JOB_CLAIMED",
    message: "Worker claimed the next queued job.",
    metadata: {
      hostname: workerHostname,
      repository: claimedJob.repository
        ? `${claimedJob.repository.owner}/${claimedJob.repository.name}`
        : null,
      workerId,
    },
  });

  await heartbeatWorker({
    workerId,
    hostname: workerHostname,
    currentJob: claimedJob.id,
    status: "BUSY",
    version: config.WORKER_VERSION,
  });

  await appendJobEvent({
    jobId: claimedJob.id,
    eventType: "REPOSITORY_CHECKOUT_VALIDATION_STARTED",
    message: "ferret-runner is validating the configured local checkout.",
    metadata: {
      repository: claimedJob.repository
        ? `${claimedJob.repository.owner}/${claimedJob.repository.name}`
        : null,
      targetBranch: getTargetBranch(claimedJob.payload),
      workerId,
    },
  });

  const checkoutValidation = claimedJob.repository
    ? await validateRepositoryCheckout({
        repository: claimedJob.repository,
        targetBranch: getTargetBranch(claimedJob.payload),
      })
    : {
        ok: false as const,
        message: "Job has no registered repository.",
        metadata: {
          jobId: claimedJob.id,
        },
      };

  if (!checkoutValidation.ok) {
    const blockedJob = await markJobBlocked({
      jobId: claimedJob.id,
      workerId,
    });

    await appendJobEvent({
      jobId: blockedJob.id,
      eventType: "JOB_BLOCKED",
      message: checkoutValidation.message,
      metadata: {
        ...checkoutValidation.metadata,
        workerId,
      },
    });

    log("Blocked job during local checkout validation", {
      jobId: blockedJob.id,
      reason: checkoutValidation.message,
    });

    await heartbeatWorker({
      workerId,
      hostname: workerHostname,
      status: "IDLE",
      version: config.WORKER_VERSION,
    });
    continue;
  }

  await appendJobEvent({
    jobId: claimedJob.id,
    eventType: "REPOSITORY_CHECKOUT_VALIDATED",
    message: "Configured local checkout is valid.",
    metadata: {
      ...checkoutValidation.metadata,
      workerId,
    },
  });

  const runningJob = await markJobRunning({
    jobId: claimedJob.id,
    workerId,
  });

  const runMetadata = {
    checkoutBranchRef: checkoutValidation.metadata.branchRef,
    hostname: workerHostname,
    localPath: checkoutValidation.metadata.localPath,
    remoteUrl: checkoutValidation.metadata.remoteUrl,
    repository: runningJob.repository
      ? `${runningJob.repository.owner}/${runningJob.repository.name}`
      : null,
    targetBranch: getTargetBranch(runningJob.payload),
  };

  const run = await createJobRun({
    jobId: runningJob.id,
    workerId,
    metadata: runMetadata,
  });

  await appendJobEvent({
    jobId: runningJob.id,
    eventType: "RUN_STARTED",
    message: "ferret-runner started a new execution run.",
    metadata: {
      runId: run.id,
      status: run.status,
      workerId,
    },
  });

  await appendJobEvent({
    jobId: runningJob.id,
    eventType: "WORK_BRANCH_PREPARATION_STARTED",
    message: "ferret-runner is preparing a generated work branch.",
    metadata: {
      localPath: checkoutValidation.metadata.localPath,
      runId: run.id,
      targetBranch: getTargetBranch(runningJob.payload),
      workerId,
    },
  });

  const workBranchPreparation = await prepareWorkBranch({
    jobId: runningJob.id,
    localPath: checkoutValidation.metadata.localPath,
    targetBranch: getTargetBranch(runningJob.payload),
  });

  if (!workBranchPreparation.ok) {
    await markRunFailed({
      runId: run.id,
    });

    const blockedJob = await markJobBlocked({
      jobId: runningJob.id,
      workerId,
    });

    await appendJobEvent({
      jobId: blockedJob.id,
      eventType: "JOB_BLOCKED",
      message: workBranchPreparation.message,
      metadata: {
        ...workBranchPreparation.metadata,
        runId: run.id,
        workerId,
      },
    });

    log("Blocked job during work branch preparation", {
      jobId: blockedJob.id,
      reason: workBranchPreparation.message,
      runId: run.id,
    });

    await heartbeatWorker({
      workerId,
      hostname: workerHostname,
      status: "IDLE",
      version: config.WORKER_VERSION,
    });
    continue;
  }

  await updateRunMetadata({
    runId: run.id,
    metadata: {
      ...runMetadata,
      ...workBranchPreparation.metadata,
    },
  });

  await appendJobEvent({
    jobId: runningJob.id,
    eventType: "TARGET_BRANCH_CHECKED_OUT",
    message: "ferret-runner checked out the target branch base.",
    metadata: {
      baseCommit: workBranchPreparation.metadata.baseCommit,
      baseRef: workBranchPreparation.metadata.baseRef,
      localPath: workBranchPreparation.metadata.localPath,
      runId: run.id,
      targetBranch: workBranchPreparation.metadata.targetBranch,
      workerId,
    },
  });

  await appendJobEvent({
    jobId: runningJob.id,
    eventType: "WORK_BRANCH_CREATED",
    message: "ferret-runner created the generated work branch.",
    metadata: {
      baseCommit: workBranchPreparation.metadata.baseCommit,
      localPath: workBranchPreparation.metadata.localPath,
      runId: run.id,
      workBranch: workBranchPreparation.metadata.workBranch,
      workerId,
    },
  });

  await appendJobEvent({
    jobId: runningJob.id,
    eventType: "JOB_RUNNING",
    message: "Worker marked the job as running.",
    metadata: {
      hostname: workerHostname,
      repository: runningJob.repository
        ? `${runningJob.repository.owner}/${runningJob.repository.name}`
        : null,
      runId: run.id,
      workerId,
    },
  });

  log("Claimed job", {
    job: runningJob,
    run,
  });

  await sleep(config.WORKER_SIMULATED_WORK_MS);

  const completed = await markSimulatedWorkSucceeded({
    jobId: runningJob.id,
    runId: run.id,
  });

  log("Simulated worker pass complete", {
    jobId: completed.job.id,
    runId: completed.run.id,
  });

  await appendJobEvent({
    jobId: completed.job.id,
    eventType: "WORKER_SIMULATED_WORK_COMPLETE",
    message: "Worker completed the Milestone 2 simulated work pass.",
    metadata: {
      jobStatus: completed.job.status,
      runId: completed.run.id,
      runStatus: completed.run.status,
      simulatedWorkMs: config.WORKER_SIMULATED_WORK_MS,
      workerId,
    },
  });
}
