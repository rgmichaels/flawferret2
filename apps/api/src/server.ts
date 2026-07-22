import cors from "@fastify/cors";
import {
  appendJobEvent,
  approveJobForCodex,
  approveJobForPrCreation,
  getQueueControl,
  pauseQueue,
  prisma,
  type Prisma,
  resumeQueue,
} from "@flawferret2/db";
import {
  createJobRequestSchema,
  createRepositoryRequestSchema,
  explainCucumberScenarioRequestSchema,
  jobStatusSchema,
  retryStageRequestSchema,
  type JobDiffResponse,
  type JobEventResponse,
  type JobResponse,
  type QueueControlResponse,
  type RepositoryResponse,
  type RunResponse,
} from "@flawferret2/job-schemas";
import {
  getJobGoal,
  getJobTitle,
  sendSlackNotification,
  shortJobId,
} from "@flawferret2/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z, ZodError } from "zod";
import { config } from "./config.js";
import { explainCucumberScenario } from "./cucumber-explanations.js";
import { buildFeatureCatalog, buildFeatureDetail } from "./cucumber-features.js";

const execFileAsync = promisify(execFile);
const DIFF_OUTPUT_LIMIT = 60_000;
const DIFF_PROCESS_BUFFER = 5_000_000;

const toJobResponse = (job: {
  id: string;
  jobType: JobResponse["jobType"];
  status: JobResponse["status"];
  priority: JobResponse["priority"];
  payload: unknown;
  repository: RepositoryResponse | null;
  latestRun: RunResponse | null;
  claimedBy: string | null;
  claimedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): JobResponse => ({
  id: job.id,
  jobType: job.jobType,
  status: job.status,
  priority: job.priority,
  payload: job.payload as JobResponse["payload"],
  repository: job.repository,
  latestRun: job.latestRun,
  claimedBy: job.claimedBy,
  claimedAt: job.claimedAt?.toISOString() ?? null,
  completedAt: job.completedAt?.toISOString() ?? null,
  createdAt: job.createdAt.toISOString(),
  updatedAt: job.updatedAt.toISOString(),
});

const toQueueControlResponse = (queueControl: {
  paused: boolean;
  pausedAt: Date | null;
  resumedAt: Date | null;
  updatedAt: Date;
}): QueueControlResponse => ({
  paused: queueControl.paused,
  pausedAt: queueControl.pausedAt?.toISOString() ?? null,
  resumedAt: queueControl.resumedAt?.toISOString() ?? null,
  updatedAt: queueControl.updatedAt.toISOString(),
});

const toRunResponse = (run: {
  id: string;
  jobId: string;
  status: RunResponse["status"];
  workerId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): RunResponse => ({
  id: run.id,
  jobId: run.jobId,
  status: run.status,
  workerId: run.workerId,
  startedAt: run.startedAt.toISOString(),
  completedAt: run.completedAt?.toISOString() ?? null,
  metadata: run.metadata ?? null,
  createdAt: run.createdAt.toISOString(),
  updatedAt: run.updatedAt.toISOString(),
});

const toRepositoryResponse = (repository: {
  id: string;
  provider: RepositoryResponse["provider"];
  owner: string;
  name: string;
  defaultBranch: string;
  cloneUrl: string;
  webUrl: string;
  localPath: string | null;
  validationCommand: string | null;
  createdAt: Date;
  updatedAt: Date;
}): RepositoryResponse => ({
  id: repository.id,
  provider: repository.provider,
  owner: repository.owner,
  name: repository.name,
  defaultBranch: repository.defaultBranch,
  cloneUrl: repository.cloneUrl,
  webUrl: repository.webUrl,
  localPath: repository.localPath,
  validationCommand: repository.validationCommand,
  createdAt: repository.createdAt.toISOString(),
  updatedAt: repository.updatedAt.toISOString(),
});

const toJobResponseWithRepository = (job: {
  id: string;
  jobType: JobResponse["jobType"];
  status: JobResponse["status"];
  priority: JobResponse["priority"];
  payload: unknown;
  repository:
    | ({
        id: string;
        provider: RepositoryResponse["provider"];
        owner: string;
        name: string;
        defaultBranch: string;
        cloneUrl: string;
        webUrl: string;
        localPath: string | null;
        validationCommand: string | null;
        createdAt: Date;
        updatedAt: Date;
      })
    | null;
  runs: Array<{
    id: string;
    jobId: string;
    status: RunResponse["status"];
    workerId: string | null;
    startedAt: Date;
    completedAt: Date | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>;
  claimedBy: string | null;
  claimedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): JobResponse =>
  toJobResponse({
    ...job,
    latestRun: job.runs[0] ? toRunResponse(job.runs[0]) : null,
    repository: job.repository ? toRepositoryResponse(job.repository) : null,
  });

const toJobEventResponse = (event: {
  id: string;
  jobId: string;
  eventType: JobEventResponse["eventType"];
  message: string;
  metadata: unknown;
  createdAt: Date;
}): JobEventResponse => ({
  id: event.id,
  jobId: event.jobId,
  eventType: event.eventType,
  message: event.message,
  metadata: event.metadata ?? null,
  createdAt: event.createdAt.toISOString(),
});

const getMetadataRecord = (metadata: unknown): Record<string, unknown> => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return metadata as Record<string, unknown>;
};

const getMetadataString = (metadata: unknown, key: string) => {
  const value = getMetadataRecord(metadata)[key];

  return typeof value === "string" && value.length > 0 ? value : null;
};

const truncateDiffOutput = (value: string) => {
  if (value.length <= DIFF_OUTPUT_LIMIT) {
    return {
      text: value,
      truncated: false,
    };
  }

  return {
    text: `${value.slice(0, DIFF_OUTPUT_LIMIT)}\n\n[diff truncated at ${DIFF_OUTPUT_LIMIT} characters]`,
    truncated: true,
  };
};

const isSafeGitRevision = (value: string) => value.length > 0 && !value.startsWith("-") && !value.includes("\0");

const emptyJobDiff = ({
  baseRef = null,
  localPath = null,
  reason,
  workBranch = null,
}: {
  baseRef?: string | null;
  localPath?: string | null;
  reason: string;
  workBranch?: string | null;
}): JobDiffResponse => ({
  available: false,
  baseRef,
  diff: "",
  localPath,
  reason,
  stat: "",
  truncated: false,
  workBranch,
});

const readGeneratedDiff = async (metadata: unknown): Promise<JobDiffResponse> => {
  const localPath = getMetadataString(metadata, "localPath");
  const baseRef =
    getMetadataString(metadata, "baseCommit") ??
    getMetadataString(metadata, "baseRef") ??
    getMetadataString(metadata, "targetBranch");
  const workBranch = getMetadataString(metadata, "workBranch");

  if (!localPath) {
    return emptyJobDiff({
      baseRef,
      reason: "No local checkout path is recorded for this run.",
      workBranch,
    });
  }

  if (!baseRef) {
    return emptyJobDiff({
      localPath,
      reason: "No base commit or branch is recorded for this run.",
      workBranch,
    });
  }

  if (!isSafeGitRevision(baseRef)) {
    return emptyJobDiff({
      baseRef,
      localPath,
      reason: "Recorded base ref cannot be used for diff preview.",
      workBranch,
    });
  }

  try {
    const [{ stdout: stat }, { stdout: diff }] = await Promise.all([
      execFileAsync("git", ["-C", localPath, "diff", "--no-color", "--stat", baseRef, "--"], {
        maxBuffer: DIFF_PROCESS_BUFFER,
      }),
      execFileAsync("git", ["-C", localPath, "diff", "--no-color", "--find-renames", baseRef, "--"], {
        maxBuffer: DIFF_PROCESS_BUFFER,
      }),
    ]);
    const truncated = truncateDiffOutput(diff);
    const available = stat.trim().length > 0 || truncated.text.trim().length > 0;

    return {
      available,
      baseRef,
      diff: truncated.text,
      localPath,
      reason: available ? null : "No generated diff is available.",
      stat,
      truncated: truncated.truncated,
      workBranch,
    };
  } catch (error) {
    return emptyJobDiff({
      baseRef,
      localPath,
      reason: error instanceof Error ? error.message : "Unable to read generated diff.",
      workBranch,
    });
  }
};

const jobParamsSchema = z.object({
  id: z.string().uuid(),
});

const includeCanceledQuerySchema = z.object({
  includeCanceled: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(10),
  paginated: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  sort: z.enum(["status_asc", "status_desc", "updated_asc", "updated_desc"]).default("updated_desc"),
  status: jobStatusSchema.optional(),
});

const repositoryParamsSchema = z.object({
  id: z.string().uuid(),
});

const retryableStatuses = ["BLOCKED", "FAILED", "RETRY"] as const;

const optionalText = (value: string | undefined) => {
  const trimmed = value?.trim();

  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const nextActionStatusPriority: Partial<Record<JobResponse["status"], number>> = {
  READY_FOR_CODEX: 0,
  REVIEW: 1,
  PR_CREATED: 2,
  BLOCKED: 3,
  FAILED: 4,
  RETRY: 5,
};

const getJobActionLabel = (status: JobResponse["status"]) => {
  if (status === "READY_FOR_CODEX") {
    return "Approve Codex";
  }

  if (status === "REVIEW") {
    return "Approve Draft PR";
  }

  if (status === "PR_CREATED") {
    return "Review Pull Request";
  }

  return "Open Attention Job";
};

const getJobActionText = (status: JobResponse["status"]) => {
  if (status === "READY_FOR_CODEX") {
    return "A prepared job is waiting before any model spend happens.";
  }

  if (status === "REVIEW") {
    return "Validated work is waiting before any branch push or PR creation.";
  }

  if (status === "PR_CREATED") {
    return "A draft pull request exists; checks and merge are still pending.";
  }

  return "A job needs recovery before the pipeline can continue.";
};

const githubRepositoryUrl = ({ owner, name }: { owner: string; name: string }) =>
  `https://github.com/${owner}/${name}`;

const githubCloneUrl = ({ owner, name }: { owner: string; name: string }) =>
  `${githubRepositoryUrl({ owner, name })}.git`;

const RUNNER_START_COMMAND = "pnpm --filter @flawferret2/ferret-runner dev";

const getRunnerHealth = ({
  heartbeatAgeSeconds,
  status,
}: {
  heartbeatAgeSeconds: number | null;
  status: string | null;
}) => {
  if (heartbeatAgeSeconds === null) {
    return {
      health: "offline" as const,
      healthText: "No runner heartbeat has been recorded.",
    };
  }

  if (status === "OFFLINE") {
    return {
      health: "offline" as const,
      healthText: "Runner reported offline.",
    };
  }

  if (status === "ERROR") {
    return {
      health: "error" as const,
      healthText: "Runner reported an error state.",
    };
  }

  if (heartbeatAgeSeconds > 120) {
    return {
      health: "stale" as const,
      healthText: `Last heartbeat was ${heartbeatAgeSeconds}s ago.`,
    };
  }

  if (status === "BUSY") {
    return {
      health: "busy" as const,
      healthText: "Runner is currently working.",
    };
  }

  return {
    health: "idle" as const,
    healthText: "Runner heartbeat is fresh and ready.",
  };
};

export const buildServer = async (): Promise<FastifyInstance> => {
  const server = Fastify({
    logger: true,
  });

  await server.register(cors, {
    origin: config.WEB_ORIGIN,
  });

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "ValidationError",
        issues: error.issues,
      });
    }

    server.log.error(error);

    return reply.status(500).send({
      error: "InternalServerError",
      message: "An unexpected error occurred.",
    });
  });

  server.get("/health", async () => {
    await prisma.$queryRaw`SELECT 1`;

    return {
      ok: true,
      service: "flawferret2-api",
    };
  });

  server.get("/readiness", async () => {
    await prisma.$queryRaw`SELECT 1`;

    const [
      queueControl,
      repositories,
      repositoryWithValidationCommand,
      jobs,
      cleanupFailureEvents,
      nextActionJobs,
      latestWorker,
    ] = await Promise.all([
      getQueueControl(),
      prisma.repository.count(),
      prisma.repository.findFirst({
        select: {
          id: true,
        },
        where: {
          validationCommand: {
            not: null,
          },
        },
      }),
      prisma.job.findMany({
        select: {
          status: true,
        },
      }),
      prisma.jobEvent.findMany({
        orderBy: {
          createdAt: "desc",
        },
        select: {
          jobId: true,
          message: true,
          metadata: true,
        },
        where: {
          eventType: "LOCAL_CHECKOUT_CLEANUP_FAILED",
        },
      }),
      prisma.job.findMany({
        orderBy: [
          {
            updatedAt: "desc",
          },
        ],
        select: {
          id: true,
          status: true,
        },
        where: {
          status: {
            in: ["READY_FOR_CODEX", "REVIEW", "PR_CREATED", "BLOCKED", "FAILED", "RETRY"],
          },
        },
      }),
      prisma.worker.findFirst({
        orderBy: {
          lastHeartbeat: "desc",
        },
      }),
    ]);
    const now = Date.now();
    const heartbeatAgeSeconds = latestWorker
      ? Math.max(0, Math.floor((now - latestWorker.lastHeartbeat.getTime()) / 1000))
      : null;
    const runnerHealth = getRunnerHealth({
      heartbeatAgeSeconds,
      status: latestWorker?.status ?? null,
    });
    const countByStatus = (statuses: JobResponse["status"][]) =>
      jobs.filter((job) => statuses.includes(job.status)).length;
    const latestCleanupFailure = cleanupFailureEvents[0] ?? null;
    const latestCleanupFailureMetadata = getMetadataRecord(latestCleanupFailure?.metadata);
    const nextActionJob =
      nextActionJobs.sort((left, right) => {
        const leftPriority = nextActionStatusPriority[left.status] ?? 99;
        const rightPriority = nextActionStatusPriority[right.status] ?? 99;

        return leftPriority - rightPriority;
      })[0] ?? null;

    return {
      api: {
        databaseConnected: true,
      },
      queue: toQueueControlResponse(queueControl),
      counts: {
        activeJobs: countByStatus([
          "CLAIMED",
          "RUNNING",
          "VALIDATING",
          "CODEX_APPROVED",
          "PR_APPROVED",
          "PR_CREATED",
        ]),
        blockedJobs: countByStatus(["BLOCKED", "FAILED", "RETRY"]),
        cleanupFailures: cleanupFailureEvents.length,
        codexApprovalJobs: countByStatus(["READY_FOR_CODEX"]),
        completedJobs: countByStatus(["COMPLETED"]),
        jobs: jobs.length,
        prApprovalJobs: countByStatus(["REVIEW"]),
        prCreatedJobs: countByStatus(["PR_CREATED"]),
        repositories,
      },
      nextAction: nextActionJob
        ? {
            href: `/jobs/${nextActionJob.id}`,
            jobId: nextActionJob.id,
            label: getJobActionLabel(nextActionJob.status),
            text: getJobActionText(nextActionJob.status),
          }
        : null,
      runner: {
        codexCommand: config.CODEX_COMMAND,
        codexEnabled: config.FERRET_RUNNER_ENABLE_CODEX,
        heartbeatAgeSeconds,
        health: runnerHealth.health,
        healthText: runnerHealth.healthText,
        id: latestWorker?.id ?? null,
        lastHeartbeat: latestWorker?.lastHeartbeat.toISOString() ?? null,
        prCreationEnabled: config.FERRET_RUNNER_ENABLE_PR_CREATION,
        slackConfigured: Boolean(config.SLACK_WEBHOOK_URL),
        startCommand: RUNNER_START_COMMAND,
        status: latestWorker?.status ?? null,
        validationCommandConfigured:
          Boolean(config.FERRET_RUNNER_VALIDATION_COMMAND) ||
          Boolean(repositoryWithValidationCommand),
      },
      cleanup: {
        latestFailure: latestCleanupFailure
          ? {
              baseBranch: getMetadataString(latestCleanupFailureMetadata, "baseBranch"),
              error: getMetadataString(latestCleanupFailureMetadata, "error"),
              headBranch: getMetadataString(latestCleanupFailureMetadata, "headBranch"),
              href: `/jobs/${latestCleanupFailure.jobId}`,
              jobId: latestCleanupFailure.jobId,
              localPath: getMetadataString(latestCleanupFailureMetadata, "localPath"),
              message: latestCleanupFailure.message,
            }
          : null,
      },
    };
  });

  server.get("/queue", async () => {
    const queueControl = await getQueueControl();

    return toQueueControlResponse(queueControl);
  });

  server.post("/queue/pause", async () => {
    const queueControl = await pauseQueue();

    return toQueueControlResponse(queueControl);
  });

  server.post("/queue/resume", async () => {
    const queueControl = await resumeQueue();

    return toQueueControlResponse(queueControl);
  });

  server.get("/repositories", async () => {
    const repositories = await prisma.repository.findMany({
      orderBy: [
        {
          owner: "asc",
        },
        {
          name: "asc",
        },
      ],
    });

    return repositories.map(toRepositoryResponse);
  });

  server.post("/repositories", async (request, reply) => {
    const body = createRepositoryRequestSchema.parse(request.body);
    const cloneUrl = githubCloneUrl(body);
    const webUrl = githubRepositoryUrl(body);

    const repository = await prisma.repository.upsert({
      where: {
        provider_owner_name: {
          provider: body.provider,
          owner: body.owner,
          name: body.name,
        },
      },
      create: {
        provider: body.provider,
        owner: body.owner,
        name: body.name,
        defaultBranch: body.defaultBranch,
        cloneUrl,
        webUrl,
        localPath: body.localPath,
        validationCommand: optionalText(body.validationCommand),
      },
      update: {
        defaultBranch: body.defaultBranch,
        cloneUrl,
        webUrl,
        localPath: body.localPath,
        validationCommand: optionalText(body.validationCommand),
      },
    });

    return reply.status(201).send(toRepositoryResponse(repository));
  });

  server.get("/repositories/:id", async (request, reply) => {
    const params = repositoryParamsSchema.parse(request.params);

    const repository = await prisma.repository.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!repository) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Repository not found.",
      });
    }

    return toRepositoryResponse(repository);
  });

  server.put("/repositories/:id", async (request, reply) => {
    const params = repositoryParamsSchema.parse(request.params);
    const body = createRepositoryRequestSchema.parse(request.body);
    const cloneUrl = githubCloneUrl(body);
    const webUrl = githubRepositoryUrl(body);

    const existingRepository = await prisma.repository.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!existingRepository) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Repository not found.",
      });
    }

    const repository = await prisma.repository.update({
      data: {
        provider: body.provider,
        owner: body.owner,
        name: body.name,
        defaultBranch: body.defaultBranch,
        cloneUrl,
        webUrl,
        localPath: body.localPath,
        validationCommand: optionalText(body.validationCommand),
      },
      where: {
        id: params.id,
      },
    });

    return toRepositoryResponse(repository);
  });

  server.delete("/repositories/:id", async (request, reply) => {
    const params = repositoryParamsSchema.parse(request.params);

    const existingRepository = await prisma.repository.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!existingRepository) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Repository not found.",
      });
    }

    await prisma.repository.delete({
      where: {
        id: params.id,
      },
    });

    return reply.status(204).send();
  });

  server.get("/repositories/:id/features", async (request, reply) => {
    const params = repositoryParamsSchema.parse(request.params);

    const repository = await prisma.repository.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!repository) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Repository not found.",
      });
    }

    try {
      return await buildFeatureCatalog({
        repository: toRepositoryResponse(repository),
      });
    } catch (error) {
      return reply.status(409).send({
        error: "FeatureCatalogUnavailable",
        message: error instanceof Error ? error.message : "Unable to read feature catalog.",
      });
    }
  });

  server.get("/repositories/:id/features/detail", async (request, reply) => {
    const params = repositoryParamsSchema.parse(request.params);
    const query = z
      .object({
        path: z.string().trim().min(1),
      })
      .parse(request.query);

    const repository = await prisma.repository.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!repository) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Repository not found.",
      });
    }

    try {
      const detail = await buildFeatureDetail({
        featurePath: query.path,
        repository: toRepositoryResponse(repository),
      });

      if (!detail) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Feature file not found.",
        });
      }

      return detail;
    } catch (error) {
      return reply.status(409).send({
        error: "FeatureCatalogUnavailable",
        message: error instanceof Error ? error.message : "Unable to read feature detail.",
      });
    }
  });

  server.post("/repositories/:id/features/explain", async (request, reply) => {
    const params = repositoryParamsSchema.parse(request.params);
    const body = explainCucumberScenarioRequestSchema.parse(request.body);

    const repository = await prisma.repository.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!repository) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Repository not found.",
      });
    }

    try {
      const detail = await buildFeatureDetail({
        featurePath: body.path,
        repository: toRepositoryResponse(repository),
      });

      if (!detail) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Feature file not found.",
        });
      }

      const scenario = detail.feature.scenarios.find((item) => item.line === body.scenarioLine);

      if (!scenario) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Scenario not found.",
        });
      }

      return await explainCucumberScenario({
        detail,
        scenario,
      });
    } catch (error) {
      return reply.status(409).send({
        error: "ScenarioExplanationUnavailable",
        message: error instanceof Error ? error.message : "Unable to explain scenario.",
      });
    }
  });

  server.post("/jobs", async (request, reply) => {
    const body = createJobRequestSchema.parse(request.body);

    const repository = await prisma.repository.findUnique({
      where: {
        id: body.payload.repositoryId,
      },
    });

    if (!repository) {
      return reply.status(400).send({
        error: "ValidationError",
        message: "Repository must be registered before a job can be queued.",
      });
    }

    const job = await prisma.job.create({
      data: {
        jobType: body.jobType,
        status: "QUEUED",
        priority: body.priority,
        repositoryId: repository.id,
        payload: body.payload,
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

    await appendJobEvent({
      jobId: job.id,
      eventType: "JOB_CREATED",
      message: "Job was queued from the web interface.",
      metadata: {
        jobType: body.jobType,
        priority: body.priority,
        repository: `${repository.owner}/${repository.name}`,
        targetBranch: body.payload.targetBranch,
      },
    });

    const jobTitle = getJobTitle(job.payload);
    const jobGoal = getJobGoal(job.payload);
    const slackResult = await sendSlackNotification({
      text: [
        `Job ${shortJobId(job.id)} created - ${jobTitle}`,
        `Repository: ${repository.owner}/${repository.name}`,
        `Target branch: ${body.payload.targetBranch}`,
        jobGoal ? `Goal: ${jobGoal}` : null,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
      webhookUrl: config.SLACK_WEBHOOK_URL,
    });

    if (!slackResult.sent) {
      server.log.warn(
        {
          jobId: job.id,
          reason: slackResult.reason,
        },
        "Slack job-created notification was not sent",
      );
    }

    return reply.status(201).send(toJobResponseWithRepository(job));
  });

  server.get("/jobs", async (request) => {
    const query = includeCanceledQuerySchema.parse(request.query);
    const where: Prisma.JobWhereInput = {
      ...(query.includeCanceled
        ? {}
        : {
            status: {
              not: "CANCELED",
            },
          }),
      ...(query.status
        ? {
            status: query.status,
          }
        : {}),
    };
    const orderBy: Prisma.JobOrderByWithRelationInput =
      query.sort === "status_asc"
        ? { status: "asc" }
        : query.sort === "status_desc"
          ? { status: "desc" }
          : query.sort === "updated_asc"
            ? { updatedAt: "asc" }
            : { updatedAt: "desc" };
    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        include: {
          repository: true,
          runs: {
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
          },
        },
        orderBy,
        skip: query.paginated ? (query.page - 1) * query.pageSize : 0,
        take: query.paginated ? query.pageSize : 100,
      }),
      prisma.job.count({
        where,
      }),
    ]);
    const mappedJobs = jobs.map(toJobResponseWithRepository);

    if (query.paginated) {
      return {
        jobs: mappedJobs,
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    }

    return mappedJobs;
  });

  server.post("/jobs/:id/cancel", async (request, reply) => {
    const params = jobParamsSchema.parse(request.params);

    const job = await prisma.job.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!job) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Job not found.",
      });
    }

    const cancelableStatuses = ["DRAFT", "QUEUED", "RETRY"] as const;

    if (!cancelableStatuses.includes(job.status as (typeof cancelableStatuses)[number])) {
      return reply.status(409).send({
        error: "Conflict",
        message: "Only draft, queued, or retry jobs can be canceled.",
      });
    }

    const cancelResult = await prisma.job.updateMany({
      where: {
        id: params.id,
        status: {
          in: [...cancelableStatuses],
        },
      },
      data: {
        completedAt: new Date(),
        status: "CANCELED",
      },
    });

    if (cancelResult.count === 0) {
      return reply.status(409).send({
        error: "Conflict",
        message: "Only draft, queued, or retry jobs can be canceled.",
      });
    }

    const canceledJob = await prisma.job.findUniqueOrThrow({
      where: {
        id: params.id,
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

    await appendJobEvent({
      jobId: canceledJob.id,
      eventType: "JOB_CANCELED",
      message: "Job was removed from the active queue.",
      metadata: {
        previousStatus: job.status,
      },
    });

    return toJobResponseWithRepository(canceledJob);
  });

  server.post("/jobs/:id/approve-codex", async (request, reply) => {
    const params = jobParamsSchema.parse(request.params);

    const approvalResult = await approveJobForCodex({
      jobId: params.id,
    });

    if (approvalResult.count === 0) {
      const job = await prisma.job.findUnique({
        where: {
          id: params.id,
        },
      });

      if (!job) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Job not found.",
        });
      }

      return reply.status(409).send({
        error: "Conflict",
        message: "Only jobs ready for Codex can be approved.",
      });
    }

    const approvedJob = await prisma.job.findUniqueOrThrow({
      where: {
        id: params.id,
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

    await appendJobEvent({
      jobId: approvedJob.id,
      eventType: "CODEX_APPROVAL_GRANTED",
      message: "Codex execution was manually approved for this job.",
      metadata: {
        status: approvedJob.status,
      },
    });

    return toJobResponseWithRepository(approvedJob);
  });

  server.post("/jobs/:id/approve-pr", async (request, reply) => {
    const params = jobParamsSchema.parse(request.params);
    const approvalResult = await approveJobForPrCreation({
      jobId: params.id,
    });

    if (approvalResult.count === 0) {
      const job = await prisma.job.findUnique({
        where: {
          id: params.id,
        },
      });

      if (!job) {
        return reply.status(404).send({
          error: "NotFound",
          message: "Job not found.",
        });
      }

      return reply.status(409).send({
        error: "Conflict",
        message: "Only jobs in review can be approved for draft PR creation.",
      });
    }

    const approvedJob = await prisma.job.findUniqueOrThrow({
      where: {
        id: params.id,
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

    await appendJobEvent({
      jobId: approvedJob.id,
      eventType: "PR_CREATION_APPROVED",
      message: "Draft PR creation was manually approved for this job.",
      metadata: {
        status: approvedJob.status,
      },
    });

    return toJobResponseWithRepository(approvedJob);
  });

  server.post("/jobs/:id/requeue", async (request, reply) => {
    const params = jobParamsSchema.parse(request.params);
    const job = await prisma.job.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!job) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Job not found.",
      });
    }

    if (!retryableStatuses.includes(job.status as (typeof retryableStatuses)[number])) {
      return reply.status(409).send({
        error: "Conflict",
        message: "Only blocked, failed, or retry jobs can be requeued.",
      });
    }

    const requeuedJob = await prisma.job.update({
      where: {
        id: params.id,
      },
      data: {
        claimedAt: null,
        claimedBy: null,
        completedAt: null,
        status: "QUEUED",
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

    await appendJobEvent({
      jobId: requeuedJob.id,
      eventType: "JOB_RESET",
      message: "Job was requeued for setup retry.",
      metadata: {
        previousStatus: job.status,
        status: requeuedJob.status,
      },
    });

    return toJobResponseWithRepository(requeuedJob);
  });

  server.post("/jobs/:id/retry-stage", async (request, reply) => {
    const params = jobParamsSchema.parse(request.params);
    const body = retryStageRequestSchema.parse(request.body ?? {});
    const feedback = body.feedback?.trim();
    const job = await prisma.job.findUnique({
      where: {
        id: params.id,
      },
      include: {
        runs: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
    });

    if (!job) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Job not found.",
      });
    }

    const retryableStageStatuses = ["BLOCKED", "FAILED", "RETRY", "REVIEW", "PR_APPROVED"] as const;

    if (!retryableStageStatuses.includes(job.status as (typeof retryableStageStatuses)[number])) {
      return reply.status(409).send({
        error: "Conflict",
        message: "Only blocked, failed, retry, or review jobs can retry the current stage.",
      });
    }

    const latestRun = job.runs[0];

    if (!latestRun) {
      return reply.status(409).send({
        error: "Conflict",
        message: "This job has no run to retry.",
      });
    }

    const metadata =
      latestRun.metadata && typeof latestRun.metadata === "object" && !Array.isArray(latestRun.metadata)
        ? (latestRun.metadata as Record<string, unknown>)
        : {};

    const hasPullRequestAttempt = "pullRequest" in metadata;
    const hasValidationAttempt = "validation" in metadata;
    const hasCodexAttempt = "codex" in metadata || "workBranch" in metadata;
    const target =
      feedback && hasCodexAttempt
        ? {
            jobStatus: "READY_FOR_CODEX" as const,
            message: "Job was returned to Codex with reviewer feedback.",
            runStatus: "READY_FOR_CODEX" as const,
          }
      : hasPullRequestAttempt || job.status === "REVIEW" || job.status === "PR_APPROVED"
        ? {
            jobStatus: "REVIEW" as const,
            message: "Job was returned to review for draft PR approval retry.",
            runStatus: "SUCCEEDED" as const,
          }
        : hasValidationAttempt
          ? {
              jobStatus: "VALIDATING" as const,
              message: "Job was returned to validation retry.",
              runStatus: "VALIDATING" as const,
            }
          : hasCodexAttempt
            ? {
                jobStatus: "READY_FOR_CODEX" as const,
                message: "Job was returned to Codex approval retry.",
                runStatus: "READY_FOR_CODEX" as const,
              }
            : null;

    if (!target) {
      return reply.status(409).send({
        error: "Conflict",
        message: "This job has no retryable pipeline stage. Requeue setup instead.",
      });
    }

    const nextRunMetadata: Record<string, unknown> = {
      ...metadata,
    };

    if (feedback) {
      delete nextRunMetadata.validation;
      delete nextRunMetadata.pullRequest;
      nextRunMetadata.retryFeedback = {
        createdAt: new Date().toISOString(),
        feedback,
        previousRunStatus: latestRun.status,
        previousStatus: job.status,
      };
    }

    const retriedJob = await prisma.$transaction(async (tx) => {
      await tx.run.update({
        where: {
          id: latestRun.id,
        },
        data: {
          completedAt: null,
          metadata: nextRunMetadata as Prisma.InputJsonValue,
          status: target.runStatus,
        },
      });

      return tx.job.update({
        where: {
          id: params.id,
        },
        data: {
          claimedAt: null,
          claimedBy: null,
          completedAt: null,
          status: target.jobStatus,
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
    });

    await appendJobEvent({
      jobId: retriedJob.id,
      eventType: "JOB_RESET",
      message: target.message,
      metadata: {
        previousRunStatus: latestRun.status,
        previousStatus: job.status,
        feedback: feedback ?? null,
        runId: latestRun.id,
        runStatus: target.runStatus,
        status: target.jobStatus,
      },
    });

    return toJobResponseWithRepository(retriedJob);
  });

  server.get("/jobs/:id", async (request, reply) => {
    const params = jobParamsSchema.parse(request.params);

    const job = await prisma.job.findUnique({
      include: {
        repository: true,
        runs: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
      where: {
        id: params.id,
      },
    });

    if (!job) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Job not found.",
      });
    }

    return toJobResponseWithRepository(job);
  });

  server.get("/jobs/:id/diff", async (request, reply) => {
    const params = jobParamsSchema.parse(request.params);

    const job = await prisma.job.findUnique({
      include: {
        runs: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
      where: {
        id: params.id,
      },
    });

    if (!job) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Job not found.",
      });
    }

    const latestRun = job.runs[0] ?? null;

    if (!latestRun) {
      return emptyJobDiff({
        reason: "No execution run has started for this job.",
      });
    }

    return readGeneratedDiff(latestRun.metadata);
  });

  server.get("/jobs/:id/events", async (request, reply) => {
    const params = jobParamsSchema.parse(request.params);

    const events = await prisma.jobEvent.findMany({
      where: {
        jobId: params.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return events.map(toJobEventResponse);
  });

  server.get("/jobs/:id/runs", async (request) => {
    const params = jobParamsSchema.parse(request.params);

    const runs = await prisma.run.findMany({
      where: {
        jobId: params.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return runs.map(toRunResponse);
  });

  return server;
};
