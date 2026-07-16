import {
  appendJobEvent,
  claimNextApprovedCodexJob,
  claimNextPrCreatedJob,
  claimNextQueuedJob,
  claimNextReviewJob,
  claimNextValidatingJob,
  createJobRun,
  heartbeatWorker,
  markJobBlocked,
  markJobCompleted,
  markJobPrCreated,
  markJobReadyForCodex,
  markJobReview,
  markJobRunning,
  markJobValidating,
  markRunCodexRunning,
  markRunFailed,
  markRunPrCreated,
  markRunPushing,
  markRunReadyForCodex,
  markRunSucceeded,
  markRunValidating,
  prisma,
  resetJobToReadyForCodex,
  updateRunMetadata,
} from "@flawferret2/db";
import {
  getJobGoal,
  getJobTitle,
  sendSlackNotification,
  shortJobId,
} from "@flawferret2/shared";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { buildCodexInvocationPlan, runCodexInvocation } from "./codex-invocation.js";
import { config } from "./config.js";
import {
  createDraftPullRequest,
  inspectPullRequestLifecycle,
  type PullRequestLifecycleState,
} from "./pull-request.js";
import { validateRepositoryCheckout } from "./repository-checkout.js";
import { sleep } from "./sleep.js";
import { validateGeneratedWork } from "./validation.js";
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

const sendRunnerSlackMilestone = async ({
  headline,
  jobId,
  lines = [],
  payload,
}: {
  headline: string;
  jobId: string;
  lines?: Array<string | null>;
  payload: unknown;
}) => {
  const jobGoal = getJobGoal(payload);
  const slackResult = await sendSlackNotification({
    text: [
      `Job ${shortJobId(jobId)} ${headline} - ${getJobTitle(payload)}`,
      ...lines,
      jobGoal ? `Goal: ${jobGoal}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
    webhookUrl: config.SLACK_WEBHOOK_URL,
  });

  if (!slackResult.sent && slackResult.reason !== "not_configured") {
    log("Unable to send Slack milestone notification", {
      jobId,
      reason: slackResult.reason,
    });
  }
};

const prLifecycleEventTypeByState: Record<
  PullRequestLifecycleState,
  "PR_CHECKS_FAILED" | "PR_CHECKS_PASSED" | "PR_CHECKS_PENDING" | "PR_CLOSED" | "PR_MERGED"
> = {
  CHECKS_FAILED: "PR_CHECKS_FAILED",
  CHECKS_PASSED: "PR_CHECKS_PASSED",
  CHECKS_PENDING: "PR_CHECKS_PENDING",
  CLOSED: "PR_CLOSED",
  MERGED: "PR_MERGED",
  NO_CHECKS: "PR_CHECKS_PENDING",
};

const prLifecycleMessageByState: Record<PullRequestLifecycleState, string> = {
  CHECKS_FAILED: "Pull request checks failed.",
  CHECKS_PASSED: "Pull request checks passed; waiting for merge.",
  CHECKS_PENDING: "Pull request checks are still pending.",
  CLOSED: "Pull request was closed without being merged.",
  MERGED: "Pull request was merged.",
  NO_CHECKS: "Pull request has no reported checks yet; waiting for merge.",
};

const getPayloadBoolean = (payload: unknown, key: string, fallback: boolean) => {
  if (!payload || typeof payload !== "object" || !(key in payload)) {
    return fallback;
  }

  const value = (payload as Record<string, unknown>)[key];

  return typeof value === "boolean" ? value : fallback;
};

const getMetadataRecord = (metadata: unknown): Record<string, unknown> => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return metadata as Record<string, unknown>;
};

const getMetadataString = (metadata: unknown, key: string) => {
  const record = getMetadataRecord(metadata);
  const value = record[key];

  return typeof value === "string" && value.length > 0 ? value : null;
};

const truncateText = (value: string | null, maxLength = 4000) => {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
};

const getInvocationMetadata = ({
  invocationPlan,
  logPath = null,
  stderrPath = null,
  result = null,
}: {
  invocationPlan: ReturnType<typeof buildCodexInvocationPlan>;
  logPath?: string | null;
  stderrPath?: string | null;
  result?: {
    error?: string | null;
    exitCode: number | null;
    finalResponse: string | null;
    ok: boolean;
    timedOut: boolean;
    usage: unknown;
  } | null;
}) => ({
  args: invocationPlan.args.slice(0, -1),
  command: invocationPlan.command,
  enabled: invocationPlan.enabled,
  error: result?.error ?? null,
  exitCode: result?.exitCode ?? null,
  finalResponse: truncateText(result?.finalResponse ?? null),
  logPath,
  model: invocationPlan.model,
  ok: result?.ok ?? null,
  stderrPath,
  timedOut: result?.timedOut ?? false,
  timeoutMs: invocationPlan.timeoutMs,
  usage: result?.usage ?? null,
  workBranch: invocationPlan.workBranch,
});

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
  prCreationEnabled: config.FERRET_RUNNER_ENABLE_PR_CREATION,
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

    if (!latestRun || !invocationPlan.localPath) {
      const blockedJob = await markJobBlocked({
        jobId: codexJob.id,
        workerId,
      });

      if (latestRun) {
        await markRunFailed({
          runId: latestRun.id,
          metadata: {
            ...getMetadataRecord(latestRun.metadata),
            codex: getInvocationMetadata({
              invocationPlan,
            }),
          },
        });
      }

      await appendJobEvent({
        jobId: blockedJob.id,
        eventType: "CODEX_INVOCATION_FAILED",
        message: latestRun
          ? "Codex invocation failed because the prepared local checkout path is missing."
          : "Codex invocation failed because the job has no execution run.",
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

      await appendJobEvent({
        jobId: blockedJob.id,
        eventType: "JOB_BLOCKED",
        message: "Codex invocation could not start.",
        metadata: {
          localPath: invocationPlan.localPath,
          runId: latestRun?.id ?? null,
          workerId,
        },
      });

      log("Blocked job before Codex invocation", {
        jobId: blockedJob.id,
        runId: latestRun?.id ?? null,
      });

      await setWorkerState({
        status: "IDLE",
      });
      continue;
    }

    const codexRunMetadata = {
      ...getMetadataRecord(latestRun.metadata),
      codex: getInvocationMetadata({
        invocationPlan,
      }),
    };

    await markRunCodexRunning({
      runId: latestRun.id,
      metadata: codexRunMetadata,
    });

    await appendJobEvent({
      jobId: codexJob.id,
      eventType: "CODEX_INVOCATION_STARTED",
      message: "ferret-runner started Codex execution.",
      metadata: {
        command: invocationPlan.command,
        localPath: invocationPlan.localPath,
        model: invocationPlan.model,
        runId: latestRun.id,
        timeoutMs: invocationPlan.timeoutMs,
        workBranch: invocationPlan.workBranch,
        workerId,
      },
    });

    log("Starting Codex invocation", {
      jobId: codexJob.id,
      localPath: invocationPlan.localPath,
      runId: latestRun.id,
    });

    let codexResult;

    try {
      codexResult = await runCodexInvocation({
        jobId: codexJob.id,
        logDir: config.FERRET_RUNNER_LOG_DIR,
        plan: invocationPlan,
        runId: latestRun.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Codex invocation error.";
      const failedMetadata = {
        ...getMetadataRecord(latestRun.metadata),
        codex: {
          ...getInvocationMetadata({
            invocationPlan,
          }),
          error: message,
        },
      };

      await markRunFailed({
        runId: latestRun.id,
        metadata: failedMetadata,
      });

      const blockedJob = await markJobBlocked({
        jobId: codexJob.id,
        workerId,
      });

      await appendJobEvent({
        jobId: blockedJob.id,
        eventType: "CODEX_INVOCATION_FAILED",
        message,
        metadata: {
          command: invocationPlan.command,
          localPath: invocationPlan.localPath,
          model: invocationPlan.model,
          runId: latestRun.id,
          timeoutMs: invocationPlan.timeoutMs,
          workBranch: invocationPlan.workBranch,
          workerId,
        },
      });

      await appendJobEvent({
        jobId: blockedJob.id,
        eventType: "JOB_BLOCKED",
        message: "Codex invocation failed before producing a result.",
        metadata: {
          error: message,
          runId: latestRun.id,
          workerId,
        },
      });

      log("Blocked job after Codex invocation error", {
        error: message,
        jobId: blockedJob.id,
        runId: latestRun.id,
      });

      await setWorkerState({
        status: "IDLE",
      });
      continue;
    }

    const completedCodexMetadata = {
      ...getMetadataRecord(latestRun.metadata),
      codex: getInvocationMetadata({
        invocationPlan,
        logPath: codexResult.logPath,
        result: codexResult,
        stderrPath: codexResult.stderrPath,
      }),
    };

    if (!codexResult.ok) {
      await markRunFailed({
        runId: latestRun.id,
        metadata: completedCodexMetadata,
      });

      const blockedJob = await markJobBlocked({
        jobId: codexJob.id,
        workerId,
      });

      await appendJobEvent({
        jobId: blockedJob.id,
        eventType: "CODEX_INVOCATION_FAILED",
        message: codexResult.timedOut
          ? "Codex invocation timed out."
          : codexResult.error ?? "Codex invocation exited unsuccessfully.",
        metadata: {
          error: codexResult.error,
          exitCode: codexResult.exitCode,
          logPath: codexResult.logPath,
          runId: latestRun.id,
          stderrPath: codexResult.stderrPath,
          timedOut: codexResult.timedOut,
          workerId,
        },
      });

      await appendJobEvent({
        jobId: blockedJob.id,
        eventType: "JOB_BLOCKED",
        message: "Codex invocation did not complete successfully.",
        metadata: {
          exitCode: codexResult.exitCode,
          logPath: codexResult.logPath,
          runId: latestRun.id,
          stderrPath: codexResult.stderrPath,
          timedOut: codexResult.timedOut,
          workerId,
        },
      });

      log("Blocked job after unsuccessful Codex invocation", {
        exitCode: codexResult.exitCode,
        jobId: blockedJob.id,
        runId: latestRun.id,
        timedOut: codexResult.timedOut,
      });

      await setWorkerState({
        status: "IDLE",
      });
      continue;
    }

    await markRunValidating({
      runId: latestRun.id,
      metadata: completedCodexMetadata,
    });

    const validatingJob = await markJobValidating({
      jobId: codexJob.id,
      workerId,
    });

    await appendJobEvent({
      jobId: validatingJob.id,
      eventType: "CODEX_INVOCATION_COMPLETED",
      message: "Codex invocation completed successfully; job is ready for validation.",
      metadata: {
        exitCode: codexResult.exitCode,
        logPath: codexResult.logPath,
        runId: latestRun.id,
        stderrPath: codexResult.stderrPath,
        workerId,
      },
    });

    log("Codex invocation completed", {
      jobId: validatingJob.id,
      logPath: codexResult.logPath,
      runId: latestRun.id,
    });

    await setWorkerState({
      status: "IDLE",
    });
    continue;
  }

  const validationClaimResult = await claimNextValidatingJob(workerId);

  if (validationClaimResult.queuePaused) {
    log("Queue is paused; skipping validation claim");
    await sleep(config.WORKER_POLL_INTERVAL_MS);
    continue;
  }

  if (validationClaimResult.job) {
    const validationJob = validationClaimResult.job;
    const latestRun = validationJob.runs[0] ?? null;
    const localPath = getMetadataString(latestRun?.metadata, "localPath");

    await setWorkerState({
      currentJob: validationJob.id,
      status: "BUSY",
    });

    if (!latestRun || !localPath) {
      const blockedJob = await markJobBlocked({
        jobId: validationJob.id,
        workerId,
      });

      if (latestRun) {
        await markRunFailed({
          runId: latestRun.id,
          metadata: {
            ...getMetadataRecord(latestRun.metadata),
            validation: {
              error: "Missing prepared local checkout path.",
            },
          },
        });
      }

      await appendJobEvent({
        jobId: blockedJob.id,
        eventType: "VALIDATION_FAILED",
        message: latestRun
          ? "Validation failed because the prepared local checkout path is missing."
          : "Validation failed because the job has no execution run.",
        metadata: {
          localPath,
          runId: latestRun?.id ?? null,
          workerId,
        },
      });

      await appendJobEvent({
        jobId: blockedJob.id,
        eventType: "JOB_BLOCKED",
        message: "Validation could not start.",
        metadata: {
          runId: latestRun?.id ?? null,
          workerId,
        },
      });

      log("Blocked job before validation", {
        jobId: blockedJob.id,
        runId: latestRun?.id ?? null,
      });

      await setWorkerState({
        status: "IDLE",
      });
      continue;
    }

    const runAffectedTests = getPayloadBoolean(
      validationJob.payload,
      "runAffectedTests",
      true,
    );

    await appendJobEvent({
      jobId: validationJob.id,
      eventType: "VALIDATION_STARTED",
      message: "ferret-runner started validating generated work.",
      metadata: {
        command: config.FERRET_RUNNER_VALIDATION_COMMAND ?? null,
        localPath,
        runAffectedTests,
        runId: latestRun.id,
        workerId,
      },
    });

    log("Starting validation", {
      jobId: validationJob.id,
      localPath,
      runId: latestRun.id,
    });

    const validationResult = await validateGeneratedWork({
      command: config.FERRET_RUNNER_VALIDATION_COMMAND,
      jobId: validationJob.id,
      localPath,
      logDir: config.FERRET_RUNNER_LOG_DIR,
      runId: latestRun.id,
    });

    const validationMetadata = {
      ...getMetadataRecord(latestRun.metadata),
      validation: {
        ...validationResult.metadata,
        runAffectedTests,
      },
    };
    const shouldCreateDraftPr = getPayloadBoolean(
      validationJob.payload,
      "createDraftPr",
      true,
    );

    if (!validationResult.ok) {
      await markRunFailed({
        runId: latestRun.id,
        metadata: validationMetadata,
      });

      const blockedJob = await markJobBlocked({
        jobId: validationJob.id,
        workerId,
      });

      await appendJobEvent({
        jobId: blockedJob.id,
        eventType: "VALIDATION_FAILED",
        message: validationResult.message,
        metadata: {
          ...validationResult.metadata,
          runId: latestRun.id,
          workerId,
        },
      });

      await appendJobEvent({
        jobId: blockedJob.id,
        eventType: "JOB_BLOCKED",
        message: "Generated work did not pass validation.",
        metadata: {
          runId: latestRun.id,
          workerId,
        },
      });

      log("Blocked job after validation failure", {
        jobId: blockedJob.id,
        reason: validationResult.message,
        runId: latestRun.id,
      });

      await setWorkerState({
        status: "IDLE",
      });
      continue;
    }

    const nextJob = shouldCreateDraftPr
      ? await markJobReview({
          jobId: validationJob.id,
          workerId,
        })
      : await markJobCompleted({
          jobId: validationJob.id,
          workerId,
        });

    await appendJobEvent({
      jobId: nextJob.id,
      eventType: "VALIDATION_COMPLETED",
      message: shouldCreateDraftPr
        ? "Generated work passed validation and is ready for review."
        : "Generated work passed validation and was completed without draft PR creation.",
      metadata: {
        ...validationResult.metadata,
        createDraftPr: shouldCreateDraftPr,
        runAffectedTests,
        runId: latestRun.id,
        status: nextJob.status,
        workerId,
      },
    });

    await markRunSucceeded({
      runId: latestRun.id,
      metadata: {
        ...validationMetadata,
        validation: {
          ...validationResult.metadata,
          createDraftPr: shouldCreateDraftPr,
          runAffectedTests,
        },
      },
    });

    if (!shouldCreateDraftPr) {
      await sendRunnerSlackMilestone({
        headline: "completed",
        jobId: nextJob.id,
        lines: ["Generated work passed validation without draft PR creation."],
        payload: nextJob.payload,
      });
    }

    log("Validation completed", {
      changedFileCount: validationResult.metadata.changedFileCount,
      createDraftPr: shouldCreateDraftPr,
      jobId: nextJob.id,
      runId: latestRun.id,
    });

    await setWorkerState({
      status: "IDLE",
    });
    continue;
  }

  if (config.FERRET_RUNNER_ENABLE_PR_CREATION) {
    const reviewClaimResult = await claimNextReviewJob(workerId);

    if (reviewClaimResult.queuePaused) {
      log("Queue is paused; skipping review claim");
      await sleep(config.WORKER_POLL_INTERVAL_MS);
      continue;
    }

    if (reviewClaimResult.job) {
      const reviewJob = reviewClaimResult.job;
      const latestRun = reviewJob.runs[0] ?? null;
      const localPath = getMetadataString(latestRun?.metadata, "localPath");

      await setWorkerState({
        currentJob: reviewJob.id,
        status: "BUSY",
      });

      if (!latestRun || !localPath) {
        const blockedJob = await markJobBlocked({
          jobId: reviewJob.id,
          workerId,
        });

        if (latestRun) {
          await markRunFailed({
            runId: latestRun.id,
            metadata: {
              ...getMetadataRecord(latestRun.metadata),
              pullRequest: {
                error: "Missing prepared local checkout path.",
              },
            },
          });
        }

        await appendJobEvent({
          jobId: blockedJob.id,
          eventType: "PR_CREATION_FAILED",
          message: latestRun
            ? "Draft PR creation failed because the prepared local checkout path is missing."
            : "Draft PR creation failed because the job has no execution run.",
          metadata: {
            localPath,
            runId: latestRun?.id ?? null,
            workerId,
          },
        });

        await appendJobEvent({
          jobId: blockedJob.id,
          eventType: "JOB_BLOCKED",
          message: "Draft PR creation could not start.",
          metadata: {
            runId: latestRun?.id ?? null,
            workerId,
          },
        });

        log("Blocked job before draft PR creation", {
          jobId: blockedJob.id,
          runId: latestRun?.id ?? null,
        });

        await setWorkerState({
          status: "IDLE",
        });
        continue;
      }

      await appendJobEvent({
        jobId: reviewJob.id,
        eventType: "PR_CREATION_STARTED",
        message: "ferret-runner started draft PR creation.",
        metadata: {
          localPath,
          runId: latestRun.id,
          workerId,
        },
      });

      await markRunPushing({
        runId: latestRun.id,
        metadata: {
          ...getMetadataRecord(latestRun.metadata),
          pullRequest: {
            enabled: true,
          },
        },
      });

      log("Starting draft PR creation", {
        jobId: reviewJob.id,
        localPath,
        runId: latestRun.id,
      });

      const pullRequestResult = await createDraftPullRequest({
        job: reviewJob,
        localPath,
        runMetadata: latestRun.metadata,
      });

      const pullRequestMetadata = {
        ...getMetadataRecord(latestRun.metadata),
        pullRequest: pullRequestResult.metadata,
      };

      if (!pullRequestResult.ok) {
        await markRunFailed({
          runId: latestRun.id,
          metadata: pullRequestMetadata,
        });

        const blockedJob = await markJobBlocked({
          jobId: reviewJob.id,
          workerId,
        });

        await appendJobEvent({
          jobId: blockedJob.id,
          eventType: "PR_CREATION_FAILED",
          message: pullRequestResult.message,
          metadata: {
            ...pullRequestResult.metadata,
            runId: latestRun.id,
            workerId,
          },
        });

        await appendJobEvent({
          jobId: blockedJob.id,
          eventType: "JOB_BLOCKED",
          message: "Draft PR creation did not complete successfully.",
          metadata: {
            runId: latestRun.id,
            workerId,
          },
        });

        log("Blocked job after draft PR creation failure", {
          jobId: blockedJob.id,
          reason: pullRequestResult.message,
          runId: latestRun.id,
        });

        await setWorkerState({
          status: "IDLE",
        });
        continue;
      }

      await appendJobEvent({
        jobId: reviewJob.id,
        eventType: "WORK_BRANCH_COMMITTED",
        message: "ferret-runner committed generated changes on the work branch.",
        metadata: {
          commitMessage: pullRequestResult.metadata.commitMessage,
          commitSha: pullRequestResult.metadata.commitSha,
          headBranch: pullRequestResult.metadata.headBranch,
          runId: latestRun.id,
          workerId,
        },
      });

      await appendJobEvent({
        jobId: reviewJob.id,
        eventType: "WORK_BRANCH_PUSHED",
        message: "ferret-runner pushed the generated work branch.",
        metadata: {
          headBranch: pullRequestResult.metadata.headBranch,
          runId: latestRun.id,
          workerId,
        },
      });

      await markRunPrCreated({
        runId: latestRun.id,
        metadata: pullRequestMetadata,
      });

      const prCreatedJob = await markJobPrCreated({
        jobId: reviewJob.id,
        workerId,
      });

      await appendJobEvent({
        jobId: prCreatedJob.id,
        eventType: "PR_CREATED",
        message: "ferret-runner created a draft pull request; checks and merge are pending.",
        metadata: {
          ...pullRequestResult.metadata,
          runId: latestRun.id,
          workerId,
        },
      });

      await sendRunnerSlackMilestone({
        headline: "PR Created",
        jobId: prCreatedJob.id,
        lines: [`<${pullRequestResult.metadata.prUrl}|Open pull request>`],
        payload: prCreatedJob.payload,
      });

      log("Draft PR created", {
        jobId: prCreatedJob.id,
        prUrl: pullRequestResult.metadata.prUrl,
        runId: latestRun.id,
      });

      await setWorkerState({
        status: "IDLE",
      });
      continue;
    }
  }

  const prLifecycleClaimResult = await claimNextPrCreatedJob(workerId);

  if (prLifecycleClaimResult.queuePaused) {
    log("Queue is paused; skipping PR lifecycle claim");
    await sleep(config.WORKER_POLL_INTERVAL_MS);
    continue;
  }

  if (prLifecycleClaimResult.job) {
    const prJob = prLifecycleClaimResult.job;
    const latestRun = prJob.runs[0] ?? null;
    const runMetadata = getMetadataRecord(latestRun?.metadata);
    const pullRequestMetadata = getMetadataRecord(runMetadata.pullRequest);
    const lifecycleMetadata = getMetadataRecord(pullRequestMetadata.lifecycle);
    const previousLifecycleState = getMetadataString(lifecycleMetadata, "lifecycleState");
    const localPath = getMetadataString(runMetadata, "localPath");
    const prUrl = getMetadataString(pullRequestMetadata, "prUrl");

    await setWorkerState({
      currentJob: prJob.id,
      status: "BUSY",
    });

    if (!latestRun || !localPath || !prUrl) {
      const blockedJob = await markJobBlocked({
        jobId: prJob.id,
        workerId,
      });

      if (latestRun) {
        await markRunFailed({
          runId: latestRun.id,
          metadata: {
            ...runMetadata,
            pullRequest: {
              ...pullRequestMetadata,
              lifecycle: {
                error: "Missing PR lifecycle inspection inputs.",
                localPath,
                prUrl,
              },
            },
          },
        });
      }

      await appendJobEvent({
        jobId: blockedJob.id,
        eventType: "JOB_BLOCKED",
        message: "Pull request lifecycle inspection could not start.",
        metadata: {
          localPath,
          prUrl,
          runId: latestRun?.id ?? null,
          workerId,
        },
      });

      log("Blocked job before PR lifecycle inspection", {
        jobId: blockedJob.id,
        localPath,
        prUrl,
        runId: latestRun?.id ?? null,
      });

      await setWorkerState({
        status: "IDLE",
      });
      continue;
    }

    const lifecycleResult = await inspectPullRequestLifecycle({
      localPath,
      prUrl,
    });

    if (!lifecycleResult.ok) {
      await updateRunMetadata({
        runId: latestRun.id,
        metadata: {
          ...runMetadata,
          pullRequest: {
            ...pullRequestMetadata,
            lifecycle: lifecycleResult.metadata,
          },
        },
      });

      log("PR lifecycle inspection failed", {
        jobId: prJob.id,
        reason: lifecycleResult.message,
        runId: latestRun.id,
      });

      await setWorkerState({
        status: "IDLE",
      });
      continue;
    }

    const lifecycleState = lifecycleResult.metadata.lifecycleState;
    const lifecycleRunMetadata = {
      ...runMetadata,
      pullRequest: {
        ...pullRequestMetadata,
        lifecycle: {
          ...lifecycleResult.metadata,
          checkedAt: new Date().toISOString(),
        },
      },
    };
    const lifecycleChanged = previousLifecycleState !== lifecycleState;

    if (lifecycleState === "MERGED") {
      await markRunSucceeded({
        runId: latestRun.id,
        metadata: lifecycleRunMetadata,
      });

      const completedJob = await markJobCompleted({
        jobId: prJob.id,
        workerId,
      });

      if (lifecycleChanged) {
        await appendJobEvent({
          jobId: completedJob.id,
          eventType: "PR_MERGED",
          message: prLifecycleMessageByState[lifecycleState],
          metadata: {
            ...lifecycleResult.metadata,
            runId: latestRun.id,
            workerId,
          },
        });
      }

      await sendRunnerSlackMilestone({
        headline: "merged",
        jobId: completedJob.id,
        lines: [`<${lifecycleResult.metadata.prUrl}|Open pull request>`],
        payload: completedJob.payload,
      });

      log("Completed job after PR merge", {
        jobId: completedJob.id,
        prUrl: lifecycleResult.metadata.prUrl,
        runId: latestRun.id,
      });

      await setWorkerState({
        status: "IDLE",
      });
      continue;
    }

    if (lifecycleState === "CHECKS_FAILED" || lifecycleState === "CLOSED") {
      await markRunFailed({
        runId: latestRun.id,
        metadata: lifecycleRunMetadata,
      });

      const blockedJob = await markJobBlocked({
        jobId: prJob.id,
        workerId,
      });

      await appendJobEvent({
        jobId: blockedJob.id,
        eventType: prLifecycleEventTypeByState[lifecycleState],
        message: prLifecycleMessageByState[lifecycleState],
        metadata: {
          ...lifecycleResult.metadata,
          runId: latestRun.id,
          workerId,
        },
      });

      await appendJobEvent({
        jobId: blockedJob.id,
        eventType: "JOB_BLOCKED",
        message:
          lifecycleState === "CHECKS_FAILED"
            ? "Pull request checks need attention."
            : "Pull request closed before merge.",
        metadata: {
          lifecycleState,
          prUrl: lifecycleResult.metadata.prUrl,
          runId: latestRun.id,
          workerId,
        },
      });

      await sendRunnerSlackMilestone({
        headline: lifecycleState === "CHECKS_FAILED" ? "checks failed" : "PR closed",
        jobId: blockedJob.id,
        lines: [`<${lifecycleResult.metadata.prUrl}|Open pull request>`],
        payload: blockedJob.payload,
      });

      log("Blocked job after PR lifecycle terminal state", {
        jobId: blockedJob.id,
        lifecycleState,
        prUrl: lifecycleResult.metadata.prUrl,
        runId: latestRun.id,
      });

      await setWorkerState({
        status: "IDLE",
      });
      continue;
    }

    await updateRunMetadata({
      runId: latestRun.id,
      metadata: lifecycleRunMetadata,
    });

    if (lifecycleChanged) {
      await appendJobEvent({
        jobId: prJob.id,
        eventType: prLifecycleEventTypeByState[lifecycleState],
        message: prLifecycleMessageByState[lifecycleState],
        metadata: {
          ...lifecycleResult.metadata,
          runId: latestRun.id,
          workerId,
        },
      });

      if (lifecycleState === "CHECKS_PASSED") {
        await sendRunnerSlackMilestone({
          headline: "checks passed",
          jobId: prJob.id,
          lines: [`<${lifecycleResult.metadata.prUrl}|Open pull request>`],
          payload: prJob.payload,
        });
      }
    }

    log("PR lifecycle inspected", {
      checks: lifecycleResult.metadata.checks,
      jobId: prJob.id,
      lifecycleState,
      prUrl: lifecycleResult.metadata.prUrl,
      runId: latestRun.id,
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

  await sendRunnerSlackMilestone({
    headline: "ready for Codex approval",
    jobId: readyJob.id,
    lines: ["Manual approval is required before model spend."],
    payload: readyJob.payload,
  });

  log("Prepared job for Codex approval", {
    job: readyJob,
    run,
  });

  await setWorkerState({
    status: "IDLE",
  });
}
