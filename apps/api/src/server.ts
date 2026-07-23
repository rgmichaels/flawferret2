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
  createTrackerIntegrationRequestSchema,
  discoverTestRecommendationsRequestSchema,
  explainCucumberScenarioRequestSchema,
  jobStatusSchema,
  retryStageRequestSchema,
  updateTrackerIntegrationRequestSchema,
  updateReviewJobRequestSchema,
  type JobDiffResponse,
  type JobEventResponse,
  type JobResponse,
  type QueueControlResponse,
  type RepositoryResponse,
  type RunResponse,
  type TrackerIntegrationResponse,
  type TrackerIntegrationTestResponse,
} from "@flawferret2/job-schemas";
import {
  getJobGoal,
  getJobTitle,
  sendSlackNotification,
  shortJobId,
} from "@flawferret2/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z, ZodError } from "zod";
import { config } from "./config.js";
import { explainCucumberScenario } from "./cucumber-explanations.js";
import { buildFeatureCatalog, buildFeatureDetail } from "./cucumber-features.js";
import { buildDiscoverRecommendations } from "./discover-recommendations.js";

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
  trackerIntegration:
    | {
        id: string;
        name: string;
        provider: TrackerIntegrationResponse["provider"];
        projectKey: string;
      }
    | null;
  trackerIntegrationId: string | null;
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
  trackerIntegration: repository.trackerIntegration
    ? {
        id: repository.trackerIntegration.id,
        name: repository.trackerIntegration.name,
        provider: repository.trackerIntegration.provider,
        projectKey: repository.trackerIntegration.projectKey,
      }
    : null,
  trackerIntegrationId: repository.trackerIntegrationId,
  createdAt: repository.createdAt.toISOString(),
  updatedAt: repository.updatedAt.toISOString(),
});

const toTrackerIntegrationResponse = (integration: {
  id: string;
  provider: TrackerIntegrationResponse["provider"];
  name: string;
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
  createdAt: Date;
  updatedAt: Date;
}): TrackerIntegrationResponse => ({
  id: integration.id,
  provider: integration.provider,
  name: integration.name,
  baseUrl: integration.baseUrl,
  email: integration.email,
  hasApiToken: integration.apiToken.trim().length > 0,
  projectKey: integration.projectKey,
  issueType: integration.issueType,
  createdAt: integration.createdAt.toISOString(),
  updatedAt: integration.updatedAt.toISOString(),
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
        trackerIntegration:
          | {
              id: string;
              name: string;
              provider: TrackerIntegrationResponse["provider"];
              projectKey: string;
            }
          | null;
        trackerIntegrationId: string | null;
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

const trackerIntegrationParamsSchema = z.object({
  id: z.string().uuid(),
});

const approveReviewRequestSchema = z.object({
  createJiraTicket: z.boolean().default(false),
});

const retryableStatuses = ["BLOCKED", "FAILED", "RETRY"] as const;

const optionalText = (value: string | undefined) => {
  const trimmed = value?.trim();

  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const jiraAuthHeader = ({ apiToken, email }: { apiToken: string; email: string }) =>
  `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;

const testJiraIntegration = async (integration: {
  apiToken: string;
  baseUrl: string;
  email: string;
  projectKey: string;
}): Promise<TrackerIntegrationTestResponse> => {
  const authHeaders = {
    Accept: "application/json",
    Authorization: jiraAuthHeader(integration),
  };
  const authResponse = await fetch(`${integration.baseUrl}/rest/api/3/myself`, {
    headers: authHeaders,
  });

  if (!authResponse.ok) {
    const text = await authResponse.text();

    return {
      ok: false,
      message:
        authResponse.status === 401
          ? "Jira credentials were rejected. Check that the email matches the Atlassian account that created the API token."
          : `Jira authentication check failed with ${authResponse.status}: ${text || authResponse.statusText}`,
      projectKey: integration.projectKey,
      projectName: null,
    };
  }

  const response = await fetch(`${integration.baseUrl}/rest/api/3/project/${integration.projectKey}`, {
    headers: authHeaders,
  });
  const text = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      message: `Jira project check failed with ${response.status}: ${text || response.statusText}`,
      projectKey: integration.projectKey,
      projectName: null,
    };
  }

  try {
    const body = JSON.parse(text) as { key?: string; name?: string };

    return {
      ok: true,
      message: `Connected to Jira project ${body.key ?? integration.projectKey}.`,
      projectKey: body.key ?? integration.projectKey,
      projectName: body.name ?? null,
    };
  } catch {
    return {
      ok: true,
      message: `Connected to Jira project ${integration.projectKey}.`,
      projectKey: integration.projectKey,
      projectName: null,
    };
  }
};

const jiraTextNode = (text: string) => ({
  text,
  type: "text",
});

const jiraParagraph = (text: string) => ({
  content: [jiraTextNode(text)],
  type: "paragraph",
});

const jiraBulletItem = (text: string) => ({
  content: [jiraParagraph(text)],
  type: "listItem",
});

const createJiraIssueForJob = async ({
  integration,
  jobId,
  payload,
  repository,
}: {
  integration: {
    apiToken: string;
    baseUrl: string;
    email: string;
    issueType: string;
    projectKey: string;
  };
  jobId: string;
  payload: {
    acceptanceCriteria: string;
    targetBranch: string;
  };
  repository: {
    name: string;
    owner: string;
  };
}) => {
  const title = getJobTitle(payload);
  const goal = getJobGoal(payload);
  const issueResponse = await fetch(`${integration.baseUrl}/rest/api/3/issue`, {
    body: JSON.stringify({
      fields: {
        description: {
          content: [
            jiraParagraph("FlawFerret queued this automated test implementation request."),
            {
              content: [
                jiraBulletItem(`FlawFerret job: ${shortJobId(jobId)}`),
                jiraBulletItem(`Repository: ${repository.owner}/${repository.name}`),
                jiraBulletItem(`Target branch: ${payload.targetBranch}`),
                ...(goal ? [jiraBulletItem(`Goal: ${goal}`)] : []),
              ],
              type: "bulletList",
            },
            jiraParagraph("Acceptance criteria:"),
            jiraParagraph(payload.acceptanceCriteria),
          ],
          type: "doc",
          version: 1,
        },
        issuetype: {
          name: integration.issueType,
        },
        project: {
          key: integration.projectKey,
        },
        summary: title,
      },
    }),
    headers: {
      Accept: "application/json",
      Authorization: jiraAuthHeader(integration),
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const text = await issueResponse.text();

  if (!issueResponse.ok) {
    throw new Error(`Jira issue creation failed with ${issueResponse.status}: ${text || issueResponse.statusText}`);
  }

  const issue = JSON.parse(text) as { key: string; self: string };

  return {
    key: issue.key,
    url: `${integration.baseUrl}/browse/${issue.key}`,
  };
};

const nextActionStatusPriority: Partial<Record<JobResponse["status"], number>> = {
  NEEDS_REVIEW: 0,
  READY_FOR_CODEX: 1,
  REVIEW: 2,
  PR_CREATED: 3,
  BLOCKED: 4,
  FAILED: 5,
  RETRY: 6,
};

const getJobActionLabel = (status: JobResponse["status"]) => {
  if (status === "NEEDS_REVIEW") {
    return "Review Job";
  }

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
  if (status === "NEEDS_REVIEW") {
    return "A generated request is waiting before it enters the active queue.";
  }

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

  server.post("/discover/recommendations", async (request) => {
    const body = discoverTestRecommendationsRequestSchema.parse(request.body);

    return buildDiscoverRecommendations({
      input: body,
    });
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
            in: ["NEEDS_REVIEW", "READY_FOR_CODEX", "REVIEW", "PR_CREATED", "BLOCKED", "FAILED", "RETRY"],
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
        needsReviewJobs: countByStatus(["NEEDS_REVIEW"]),
        prApprovalJobs: countByStatus(["REVIEW"]),
        prCreatedJobs: countByStatus(["PR_CREATED"]),
        repositories,
      },
      nextAction: nextActionJob
        ? {
            href:
              nextActionJob.status === "NEEDS_REVIEW"
                ? `/jobs/${nextActionJob.id}/review`
                : `/jobs/${nextActionJob.id}`,
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

  server.get("/tracker-integrations", async () => {
    const integrations = await prisma.trackerIntegration.findMany({
      orderBy: [
        {
          provider: "asc",
        },
        {
          name: "asc",
        },
      ],
    });

    return integrations.map(toTrackerIntegrationResponse);
  });

  server.post("/tracker-integrations", async (request, reply) => {
    const body = createTrackerIntegrationRequestSchema.parse(request.body);

    const integration = await prisma.trackerIntegration.upsert({
      where: {
        provider_name: {
          provider: body.provider,
          name: body.name,
        },
      },
      create: {
        apiToken: body.apiToken,
        baseUrl: body.baseUrl,
        email: body.email,
        issueType: body.issueType,
        name: body.name,
        projectKey: body.projectKey,
        provider: body.provider,
      },
      update: {
        apiToken: body.apiToken,
        baseUrl: body.baseUrl,
        email: body.email,
        issueType: body.issueType,
        projectKey: body.projectKey,
      },
    });

    return reply.status(201).send(toTrackerIntegrationResponse(integration));
  });

  server.put("/tracker-integrations/:id", async (request, reply) => {
    const params = trackerIntegrationParamsSchema.parse(request.params);
    const body = updateTrackerIntegrationRequestSchema.parse(request.body);

    const existingIntegration = await prisma.trackerIntegration.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!existingIntegration) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Tracker integration not found.",
      });
    }

    const integration = await prisma.trackerIntegration.update({
      data: {
        apiToken: body.apiToken && body.apiToken.length > 0 ? body.apiToken : existingIntegration.apiToken,
        baseUrl: body.baseUrl,
        email: body.email,
        issueType: body.issueType,
        name: body.name,
        projectKey: body.projectKey,
        provider: body.provider,
      },
      where: {
        id: params.id,
      },
    });

    return toTrackerIntegrationResponse(integration);
  });

  server.delete("/tracker-integrations/:id", async (request, reply) => {
    const params = trackerIntegrationParamsSchema.parse(request.params);

    const existingIntegration = await prisma.trackerIntegration.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!existingIntegration) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Tracker integration not found.",
      });
    }

    await prisma.trackerIntegration.delete({
      where: {
        id: params.id,
      },
    });

    return reply.status(204).send();
  });

  server.post("/tracker-integrations/:id/test", async (request, reply) => {
    const params = trackerIntegrationParamsSchema.parse(request.params);
    const integration = await prisma.trackerIntegration.findUnique({
      where: {
        id: params.id,
      },
    });

    if (!integration) {
      return reply.status(404).send({
        error: "NotFound",
        message: "Tracker integration not found.",
      });
    }

    const result = await testJiraIntegration(integration);

    return reply.status(result.ok ? 200 : 502).send(result);
  });

  server.get("/repositories", async () => {
    const repositories = await prisma.repository.findMany({
      include: {
        trackerIntegration: true,
      },
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
        trackerIntegrationId: body.trackerIntegrationId ?? null,
      },
      update: {
        defaultBranch: body.defaultBranch,
        cloneUrl,
        webUrl,
        localPath: body.localPath,
        validationCommand: optionalText(body.validationCommand),
        trackerIntegrationId: body.trackerIntegrationId ?? null,
      },
      include: {
        trackerIntegration: true,
      },
    });

    return reply.status(201).send(toRepositoryResponse(repository));
  });

  server.get("/repositories/:id", async (request, reply) => {
    const params = repositoryParamsSchema.parse(request.params);

    const repository = await prisma.repository.findUnique({
      include: {
        trackerIntegration: true,
      },
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
        trackerIntegrationId: body.trackerIntegrationId ?? null,
      },
      include: {
        trackerIntegration: true,
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
      include: {
        trackerIntegration: true,
      },
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
      include: {
        trackerIntegration: true,
      },
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
      include: {
        trackerIntegration: true,
      },
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

  server.post("/dev/sample-review-job", async (_request, reply) => {
    if (process.env.NODE_ENV === "production") {
      return reply.status(404).send({
        error: "NotFound",
        message: "Not found.",
      });
    }

    const repository = await prisma.repository.upsert({
      create: {
        cloneUrl: "https://github.com/rgmichaels/flawferret2.git",
        defaultBranch: "main",
        localPath: resolve(process.cwd(), "../.."),
        name: "flawferret2-dev-sample",
        owner: "rgmichaels",
        validationCommand: "pnpm check",
        webUrl: "https://github.com/rgmichaels/flawferret2",
      },
      include: {
        trackerIntegration: true,
      },
      update: {
        defaultBranch: "main",
        localPath: resolve(process.cwd(), "../.."),
        validationCommand: "pnpm check",
      },
      where: {
        provider_owner_name: {
          name: "flawferret2-dev-sample",
          owner: "rgmichaels",
          provider: "GITHUB",
        },
      },
    });

    const acceptanceCriteria = [
      "Source: Page discovery recommendation",
      "Page URL: https://the-internet.herokuapp.com/forgot_password",
      "Impact: High",
      "Tags: @smoke @page-load",
      "Discovery notes: Dev sample for visually checking review, Jira preview, and timeline audit details.",
      "",
      "Suggested scenario:",
      "Given I am on the forgot password page",
      "Then the forgot password page should load with stable content",
      "",
      "Why this matters:",
      "A focused load smoke test catches routing, rendering, and broken deployment issues quickly.",
      "",
      "Implementation guidance:",
      "- Assert a stable heading or landmark is visible.",
      "- Keep the scenario focused on page-load behavior.",
      "- Reuse existing page objects and step definitions where sensible.",
      "- Run affected tests.",
    ].join("\n");
    const payload = {
      acceptanceCriteria,
      createDraftPr: true,
      featureArea: "Dev sample: forgot password page loads with stable content",
      goal: "Implement page-discovery test coverage: forgot password page loads with stable content.",
      repositoryId: repository.id,
      runAffectedTests: true,
      targetBranch: repository.defaultBranch,
    };
    const job = await prisma.job.create({
      data: {
        jobType: "ADD_PLAYWRIGHT_TEST",
        payload,
        priority: "HIGH",
        repositoryId: repository.id,
        status: "NEEDS_REVIEW",
      },
      include: {
        repository: {
          include: {
            trackerIntegration: true,
          },
        },
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
      message: "Dev sample Discover review job was created.",
      metadata: {
        devSample: true,
        pageUrl: "https://the-internet.herokuapp.com/forgot_password",
        repository: `${repository.owner}/${repository.name}`,
        source: "dev_sample_review_job",
        targetBranch: repository.defaultBranch,
      },
    });

    return reply.status(201).send(toJobResponseWithRepository(job));
  });

  server.post("/jobs", async (request, reply) => {
    const body = createJobRequestSchema.parse(request.body);

    const repository = await prisma.repository.findUnique({
      include: {
        trackerIntegration: true,
      },
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
        status: "NEEDS_REVIEW",
        priority: body.priority,
        repositoryId: repository.id,
        payload: body.payload,
      },
      include: {
        repository: {
          include: {
            trackerIntegration: true,
          },
        },
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
      message: "Job was created for review from the web interface.",
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
        `Job ${shortJobId(job.id)} needs review - ${jobTitle}`,
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

  server.put("/jobs/:id/review-request", async (request, reply) => {
    const params = jobParamsSchema.parse(request.params);
    const body = updateReviewJobRequestSchema.parse(request.body);

    const job = await prisma.job.findUnique({
      include: {
        repository: {
          include: {
            trackerIntegration: true,
          },
        },
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

    if (job.status !== "NEEDS_REVIEW") {
      return reply.status(409).send({
        error: "Conflict",
        message: "Only jobs that need review can be edited.",
      });
    }

    const existingPayload = job.payload && typeof job.payload === "object" ? (job.payload as Record<string, unknown>) : {};
    const changedFields = [
      body.priority !== job.priority ? "priority" : null,
      body.payload.acceptanceCriteria !== existingPayload.acceptanceCriteria ? "acceptanceCriteria" : null,
      body.payload.featureArea !== existingPayload.featureArea ? "featureArea" : null,
      body.payload.goal !== existingPayload.goal ? "goal" : null,
      body.payload.targetBranch !== existingPayload.targetBranch ? "targetBranch" : null,
    ].filter((field): field is string => Boolean(field));
    const updatedPayload: Prisma.InputJsonObject = {
      ...existingPayload,
      acceptanceCriteria: body.payload.acceptanceCriteria,
      featureArea: body.payload.featureArea,
      goal: body.payload.goal,
      targetBranch: body.payload.targetBranch,
    };

    const updatedJob = await prisma.job.update({
      data: {
        payload: updatedPayload,
        priority: body.priority,
      },
      include: {
        repository: {
          include: {
            trackerIntegration: true,
          },
        },
        runs: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
      where: {
        id: job.id,
      },
    });

    await appendJobEvent({
      jobId: job.id,
      eventType: "JOB_UPDATED",
      message:
        changedFields.length > 0
          ? `Review request was edited before approval: ${changedFields.join(", ")}.`
          : "Review request was saved before approval with no detected field changes.",
      metadata: {
        changedFields,
        newPriority: body.priority,
        newTargetBranch: body.payload.targetBranch,
        previousPriority: job.priority,
        previousTargetBranch:
          typeof existingPayload.targetBranch === "string" ? existingPayload.targetBranch : null,
        reviewAction: "edited",
      },
    });

    return toJobResponseWithRepository(updatedJob);
  });

  server.post("/jobs/:id/approve-review", async (request, reply) => {
    const params = jobParamsSchema.parse(request.params);
    const body = approveReviewRequestSchema.parse(request.body ?? {});

    const job = await prisma.job.findUnique({
      include: {
        repository: {
          include: {
            trackerIntegration: true,
          },
        },
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

    if (job.status !== "NEEDS_REVIEW") {
      return reply.status(409).send({
        error: "Conflict",
        message: "Only jobs that need review can be approved for the queue.",
      });
    }

    const payload = job.payload as {
      acceptanceCriteria: string;
      jiraIssue?: {
        key: string;
        url: string;
      };
      targetBranch: string;
    };
    let approvedPayload: Prisma.InputJsonValue = payload;

    if (body.createJiraTicket && job.repository?.trackerIntegration && !payload.jiraIssue) {
      try {
        const jiraIssue = await createJiraIssueForJob({
          integration: job.repository.trackerIntegration,
          jobId: job.id,
          payload,
          repository: job.repository,
        });
        approvedPayload = {
          ...payload,
          jiraIssue,
        };

        await appendJobEvent({
          jobId: job.id,
          eventType: "JIRA_TICKET_CREATED",
          message: `Jira ticket ${jiraIssue.key} was created for this job.`,
          metadata: {
            key: jiraIssue.key,
            projectKey: job.repository.trackerIntegration.projectKey,
            reviewAction: "jira_ticket_created",
            trackerIntegrationId: job.repository.trackerIntegration.id,
            url: jiraIssue.url,
          },
        });
      } catch (error) {
        await appendJobEvent({
          jobId: job.id,
          eventType: "JIRA_TICKET_CREATION_FAILED",
          message: "Jira ticket creation failed.",
          metadata: {
            error: error instanceof Error ? error.message : "Unknown Jira error",
            projectKey: job.repository.trackerIntegration.projectKey,
            reviewAction: "jira_ticket_creation_failed",
            trackerIntegrationId: job.repository.trackerIntegration.id,
          },
        });
      }
    } else if (body.createJiraTicket && !job.repository?.trackerIntegration) {
      await appendJobEvent({
        jobId: job.id,
        eventType: "JIRA_TICKET_CREATION_SKIPPED",
        message: "No tracker integration is attached to this repository.",
        metadata: {
          repositoryId: job.repositoryId,
          requestedByReviewer: true,
          reviewAction: "jira_ticket_skipped_no_tracker",
        },
      });
    } else if (!body.createJiraTicket) {
      await appendJobEvent({
        jobId: job.id,
        eventType: "JIRA_TICKET_CREATION_SKIPPED",
        message: "Reviewer approved this job without creating a Jira ticket.",
        metadata: {
          repositoryId: job.repositoryId,
          requestedByReviewer: false,
          reviewAction: "jira_ticket_skipped_by_reviewer",
        },
      });
    }

    const approvedJob = await prisma.job.update({
      data: {
        payload: approvedPayload,
        status: "QUEUED",
      },
      include: {
        repository: {
          include: {
            trackerIntegration: true,
          },
        },
        runs: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
      where: {
        id: job.id,
      },
    });

    await appendJobEvent({
      jobId: job.id,
      eventType: "JOB_APPROVED",
      message: "Job was approved and moved to the active queue.",
      metadata: {
        createJiraTicket: body.createJiraTicket,
        jiraIssueKey: (approvedPayload as { jiraIssue?: { key?: string } }).jiraIssue?.key ?? null,
        previousStatus: job.status,
        reviewAction: "approved",
        targetBranch: payload.targetBranch,
      },
    });

    return toJobResponseWithRepository(approvedJob);
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
          repository: {
            include: {
              trackerIntegration: true,
            },
          },
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

    const cancelableStatuses = ["DRAFT", "NEEDS_REVIEW", "QUEUED", "RETRY"] as const;

    if (!cancelableStatuses.includes(job.status as (typeof cancelableStatuses)[number])) {
      return reply.status(409).send({
        error: "Conflict",
        message: "Only draft, needs-review, queued, or retry jobs can be canceled.",
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
        message: "Only draft, needs-review, queued, or retry jobs can be canceled.",
      });
    }

    const canceledJob = await prisma.job.findUniqueOrThrow({
      where: {
        id: params.id,
      },
      include: {
        repository: {
          include: {
            trackerIntegration: true,
          },
        },
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
      message:
        job.status === "NEEDS_REVIEW"
          ? "Job was canceled while waiting for review."
          : "Job was removed from the active queue.",
      metadata: {
        previousStatus: job.status,
        reviewAction: job.status === "NEEDS_REVIEW" ? "review_canceled" : "canceled",
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
        repository: {
          include: {
            trackerIntegration: true,
          },
        },
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
        repository: {
          include: {
            trackerIntegration: true,
          },
        },
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
        repository: {
          include: {
            trackerIntegration: true,
          },
        },
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
          repository: {
            include: {
              trackerIntegration: true,
            },
          },
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
        repository: {
          include: {
            trackerIntegration: true,
          },
        },
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
