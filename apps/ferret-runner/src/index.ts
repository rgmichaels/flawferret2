import {
  appendJobEvent,
  claimNextApprovedCodexJob,
  claimNextQueuedJob,
  createJobRun,
  heartbeatWorker,
  markJobBlocked,
  markJobReadyForCodex,
  markJobRunning,
  markRunFailed,
  markRunReadyForCodex,
  prisma,
  resetJobToReadyForCodex,
  updateRunMetadata,
} from "@flawferret2/db";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { buildCodexInvocationPlan } from "./codex-invocation.js";
import { config } from "./config.js";
import { validateRepositoryCheckout } from "./repository-checkout.js";
import { sleep } from "./sleep.js";
import { prepareWorkBranch } from "./work-branch.js";

const workerId = config.WORKER_ID ?? randomUUID();
const workerHostname = hostname();

let shouldStop = false;
let shutdownStarted = false;
let lastHeartbeatAt = 0;
let lastHeartbeatState: string | null = null;

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

const setWorkerState = async ({
  currentJob = null,
  force = false,
  status,
}: {
  currentJob?: string | null;
  force?: boolean;
  status: "IDLE" | "BUSY" | "OFFLINE" | "ERROR";
}) => {
  const now = Date.now();
  const stateKey = `${status}:${currentJob ?? ""}`;
  const shouldWrite =
    force ||
    stateKey !== lastHeartbeatState ||
    now - lastHeartbeatAt >= config.WORKER_HEARTBEAT_INTERVAL_MS;

  if (!shouldWrite) {
    return;
  }

  await heartbeatWorker({
    workerId,
    hostname: workerHostname,
    currentJob,
    status,
    version: config.WORKER_VERSION,
  });

  lastHeartbeatAt = now;
  lastHeartbeatState = stateKey;
};

const shutdown = async () => {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  shouldStop = true;
  log("Worker shutting down");

  await setWorkerState({
    force: true,
    status: "OFFLINE",
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
  codexEnabled: config.FERRET_RUNNER_ENABLE_CODEX,
  heartbeatIntervalMs: config.WORKER_HEARTBEAT_INTERVAL_MS,
  pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
  simulatedWorkMs: config.WORKER_SIMULATED_WORK_MS,
});

while (!shouldStop) {
  await setWorkerState({
    status: "IDLE",
  });

  const codexClaimResult = await claimNextApprovedCodexJob(workerId);

  if (codexClaimResult.queuePaused) {
    log("Queue is paused; skipping Codex-approved claim");
    await sleep(config.WORKER_POLL_INTERVAL_MS);
    continue;
  }

  if (codexClaimResult.job) {
    const codexJob = codexClaimResult.job;
    const latestRun = codexJob.runs[0] ?? null;
    const invocationPlan = buildCodexInvocationPlan({
      codexCommand: config.CODEX_COMMAND,
      codexEnabled: config.FERRET_RUNNER_ENABLE_CODEX,
      codexModel: config.CODEX_MODEL,
      codexTimeoutMs: config.CODEX_TIMEOUT_MS,
      job: codexJob,
    });

    await setWorkerState({
      currentJob: codexJob.id,
      status: "BUSY",
    });

    await appendJobEvent({
      jobId: codexJob.id,
      eventType: "CODEX_INVOCATION_READY",
      message: "ferret-runner prepared the Codex invocation plan.",
      metadata: {
        command: invocationPlan.command,
        enabled: invocationPlan.enabled,
        localPath: invocationPlan.localPath,
        model: invocationPlan.model,
        runId: latestRun?.id ?? null,
        timeoutMs: invocationPlan.timeoutMs,
        workBranch: invocationPlan.workBranch,
        workerId,
      },
    });

    if (!invocationPlan.enabled) {
      const readyJob = await resetJobToReadyForCodex({
        jobId: codexJob.id,
        workerId,
      });

      await appendJobEvent({
        jobId: readyJob.id,
        eventType: "CODEX_INVOCATION_SKIPPED",
        message: "Codex invocation skipped because FERRET_RUNNER_ENABLE_CODEX is false.",
        metadata: {
          command: invocationPlan.command,
          localPath: invocationPlan.localPath,
          model: invocationPlan.model,
          runId: latestRun?.id ?? null,
          timeoutMs: invocationPlan.timeoutMs,
          workBranch: invocationPlan.workBranch,
          workerId,
        },
      });

      log("Skipped Codex invocation because it is disabled", {
        jobId: readyJob.id,
        runId: latestRun?.id ?? null,
      });

      await setWorkerState({
        status: "IDLE",
      });
      continue;
    }

    await appendJobEvent({
      jobId: codexJob.id,
      eventType: "CODEX_INVOCATION_SKIPPED",
      message: "Real Codex invocation is not implemented yet.",
      metadata: {
        command: invocationPlan.command,
        localPath: invocationPlan.localPath,
        model: invocationPlan.model,
        runId: latestRun?.id ?? null,
        timeoutMs: invocationPlan.timeoutMs,
        workBranch: invocationPlan.workBranch,
        workerId,
      },
    });

    await resetJobToReadyForCodex({
      jobId: codexJob.id,
      workerId,
    });

    await setWorkerState({
      status: "IDLE",
    });
    continue;
  }

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

  await setWorkerState({
    currentJob: claimedJob.id,
    status: "BUSY",
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

    await setWorkerState({
      status: "IDLE",
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

    await setWorkerState({
      status: "IDLE",
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

  await markRunReadyForCodex({
    runId: run.id,
  });

  const readyJob = await markJobReadyForCodex({
    jobId: runningJob.id,
    workerId,
  });

  await appendJobEvent({
    jobId: readyJob.id,
    eventType: "CODEX_APPROVAL_REQUIRED",
    message: "Worker prepared the job and is waiting for Codex approval.",
    metadata: {
      hostname: workerHostname,
      repository: readyJob.repository
        ? `${readyJob.repository.owner}/${readyJob.repository.name}`
        : null,
      runId: run.id,
      status: readyJob.status,
      workerId,
    },
  });

  log("Prepared job for Codex approval", {
    job: readyJob,
    run,
  });

  await setWorkerState({
    status: "IDLE",
  });
}
