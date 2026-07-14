import {
  appendJobEvent,
  claimNextQueuedJob,
  createJobRun,
  heartbeatWorker,
  markJobRunning,
  markSimulatedWorkSucceeded,
  prisma,
} from "@flawferret2/db";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { config } from "./config.js";
import { sleep } from "./sleep.js";

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

  const claimedJob = await claimNextQueuedJob(workerId);

  if (!claimedJob) {
    log("No queued jobs found");
    await sleep(config.WORKER_POLL_INTERVAL_MS);
    continue;
  }

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

  const runningJob = await markJobRunning({
    jobId: claimedJob.id,
    workerId,
  });

  const run = await createJobRun({
    jobId: runningJob.id,
    workerId,
    metadata: {
      hostname: workerHostname,
      repository: runningJob.repository
        ? `${runningJob.repository.owner}/${runningJob.repository.name}`
        : null,
    },
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
