import cors from "@fastify/cors";
import { appendJobEvent, getQueueControl, pauseQueue, prisma, resumeQueue } from "@flawferret2/db";
import {
  createJobRequestSchema,
  createRepositoryRequestSchema,
  type JobEventResponse,
  type JobResponse,
  type QueueControlResponse,
  type RepositoryResponse,
  type RunResponse,
} from "@flawferret2/job-schemas";
import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { config } from "./config.js";

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

const jobParamsSchema = z.object({
  id: z.string().uuid(),
});

const repositoryParamsSchema = z.object({
  id: z.string().uuid(),
});

const githubRepositoryUrl = ({ owner, name }: { owner: string; name: string }) =>
  `https://github.com/${owner}/${name}`;

const githubCloneUrl = ({ owner, name }: { owner: string; name: string }) =>
  `${githubRepositoryUrl({ owner, name })}.git`;

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
      },
      update: {
        defaultBranch: body.defaultBranch,
        cloneUrl,
        webUrl,
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

    return reply.status(201).send(toJobResponseWithRepository(job));
  });

  server.get("/jobs", async () => {
    const jobs = await prisma.job.findMany({
      include: {
        repository: true,
        runs: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    return jobs.map(toJobResponseWithRepository);
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
