import cors from "@fastify/cors";
import { appendJobEvent, prisma } from "@flawferret2/db";
import {
  createJobRequestSchema,
  type JobEventResponse,
  type JobResponse,
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
  claimedBy: job.claimedBy,
  claimedAt: job.claimedAt?.toISOString() ?? null,
  completedAt: job.completedAt?.toISOString() ?? null,
  createdAt: job.createdAt.toISOString(),
  updatedAt: job.updatedAt.toISOString(),
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

  server.post("/jobs", async (request, reply) => {
    const body = createJobRequestSchema.parse(request.body);

    const job = await prisma.job.create({
      data: {
        jobType: body.jobType,
        status: "QUEUED",
        priority: body.priority,
        payload: body.payload,
      },
    });

    await appendJobEvent({
      jobId: job.id,
      eventType: "JOB_CREATED",
      message: "Job was queued from the web interface.",
      metadata: {
        jobType: body.jobType,
        priority: body.priority,
      },
    });

    return reply.status(201).send(toJobResponse(job));
  });

  server.get("/jobs", async () => {
    const jobs = await prisma.job.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    return jobs.map(toJobResponse);
  });

  server.get("/jobs/:id", async (request, reply) => {
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

    return toJobResponse(job);
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

  return server;
};
