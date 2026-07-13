import { z } from "zod";

export const jobTypeSchema = z.enum(["ADD_PLAYWRIGHT_TEST"]);

export const jobStatusSchema = z.enum([
  "DRAFT",
  "QUEUED",
  "CLAIMED",
  "RUNNING",
  "VALIDATING",
  "REVIEW",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "RETRY",
]);

export const prioritySchema = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);

export const jobEventTypeSchema = z.enum([
  "JOB_CREATED",
  "JOB_CLAIMED",
  "JOB_RUNNING",
  "WORKER_SIMULATED_WORK_COMPLETE",
  "JOB_RESET",
]);

export const addPlaywrightTestPayloadSchema = z.object({
  repository: z.string().trim().min(1, "Repository is required"),
  branch: z.string().trim().min(1, "Branch is required"),
  featureArea: z.string().trim().min(1, "Feature area is required"),
  goal: z.string().trim().min(1, "Goal is required"),
  acceptanceCriteria: z.string().trim().min(1, "Acceptance criteria are required"),
  runAffectedTests: z.boolean().default(true),
  createDraftPr: z.boolean().default(true),
});

export const createJobRequestSchema = z.object({
  jobType: jobTypeSchema.default("ADD_PLAYWRIGHT_TEST"),
  priority: prioritySchema.default("NORMAL"),
  payload: addPlaywrightTestPayloadSchema,
});

export const jobResponseSchema = z.object({
  id: z.string(),
  jobType: jobTypeSchema,
  status: jobStatusSchema,
  priority: prioritySchema,
  payload: addPlaywrightTestPayloadSchema,
  claimedBy: z.string().nullable(),
  claimedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const jobEventResponseSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  eventType: jobEventTypeSchema,
  message: z.string(),
  metadata: z.unknown().nullable(),
  createdAt: z.string(),
});

export type JobType = z.infer<typeof jobTypeSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobPriority = z.infer<typeof prioritySchema>;
export type JobEventType = z.infer<typeof jobEventTypeSchema>;
export type AddPlaywrightTestPayload = z.infer<typeof addPlaywrightTestPayloadSchema>;
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;
export type JobResponse = z.infer<typeof jobResponseSchema>;
export type JobEventResponse = z.infer<typeof jobEventResponseSchema>;
