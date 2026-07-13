import cors from "@fastify/cors";
import { prisma } from "@flawferret2/db";
import {
  createJobRequestSchema,
  type JobResponse,
} from "@flawferret2/job-schemas";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
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

  return server;
};
