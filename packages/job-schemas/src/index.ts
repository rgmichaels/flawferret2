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
  "CANCELED",
]);

export const prioritySchema = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);

export const repositoryProviderSchema = z.enum(["GITHUB"]);

export const runStatusSchema = z.enum([
  "STARTED",
  "CODEX_RUNNING",
  "VALIDATING",
  "PUSHING",
  "PR_CREATED",
  "SUCCEEDED",
  "FAILED",
]);

export const jobEventTypeSchema = z.enum([
  "JOB_CREATED",
  "JOB_CLAIMED",
  "JOB_RUNNING",
  "RUN_STARTED",
  "WORKER_SIMULATED_WORK_COMPLETE",
  "JOB_RESET",
  "JOB_CANCELED",
  "REPOSITORY_CHECKOUT_VALIDATION_STARTED",
  "REPOSITORY_CHECKOUT_VALIDATED",
  "JOB_BLOCKED",
]);

export const createRepositoryRequestSchema = z.object({
  provider: repositoryProviderSchema.default("GITHUB"),
  owner: z
    .string()
    .trim()
    .min(1, "Owner is required")
    .regex(/^[A-Za-z0-9_.-]+$/, "Owner must not include slashes or spaces"),
  name: z
    .string()
    .trim()
    .min(1, "Repository name is required")
    .regex(/^[A-Za-z0-9_.-]+$/, "Repository name must not include slashes or spaces"),
  defaultBranch: z.string().trim().min(1, "Default branch is required").default("main"),
  localPath: z.string().trim().min(1, "Local checkout path is required"),
});

export const repositoryResponseSchema = z.object({
  id: z.string(),
  provider: repositoryProviderSchema,
  owner: z.string(),
  name: z.string(),
  defaultBranch: z.string(),
  cloneUrl: z.string(),
  webUrl: z.string(),
  localPath: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const queueControlResponseSchema = z.object({
  paused: z.boolean(),
  pausedAt: z.string().nullable(),
  resumedAt: z.string().nullable(),
  updatedAt: z.string(),
});

export const runResponseSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  status: runStatusSchema,
  workerId: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  metadata: z.unknown().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const currentAddPlaywrightTestPayloadSchema = z.object({
  repositoryId: z.string().uuid("Repository is required"),
  targetBranch: z.string().trim().min(1, "Target branch is required"),
  featureArea: z.string().trim().min(1, "Feature area is required"),
  goal: z.string().trim().min(1, "Goal is required"),
  acceptanceCriteria: z.string().trim().min(1, "Acceptance criteria are required"),
  runAffectedTests: z.boolean().default(true),
  createDraftPr: z.boolean().default(true),
});

export const legacyAddPlaywrightTestPayloadSchema = z.object({
  repository: z.string().trim().min(1, "Repository is required"),
  branch: z.string().trim().min(1, "Branch is required"),
  featureArea: z.string().trim().min(1, "Feature area is required"),
  goal: z.string().trim().min(1, "Goal is required"),
  acceptanceCriteria: z.string().trim().min(1, "Acceptance criteria are required"),
  runAffectedTests: z.boolean().default(true),
  createDraftPr: z.boolean().default(true),
});

export const addPlaywrightTestPayloadSchema = z.union([
  currentAddPlaywrightTestPayloadSchema,
  legacyAddPlaywrightTestPayloadSchema,
]);

export const createJobRequestSchema = z.object({
  jobType: jobTypeSchema.default("ADD_PLAYWRIGHT_TEST"),
  priority: prioritySchema.default("NORMAL"),
  payload: currentAddPlaywrightTestPayloadSchema,
});

export const jobResponseSchema = z.object({
  id: z.string(),
  jobType: jobTypeSchema,
  status: jobStatusSchema,
  priority: prioritySchema,
  payload: addPlaywrightTestPayloadSchema,
  repository: repositoryResponseSchema.nullable(),
  latestRun: runResponseSchema.nullable(),
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
export type RepositoryProvider = z.infer<typeof repositoryProviderSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type JobEventType = z.infer<typeof jobEventTypeSchema>;
export type CreateRepositoryRequest = z.infer<typeof createRepositoryRequestSchema>;
export type RepositoryResponse = z.infer<typeof repositoryResponseSchema>;
export type QueueControlResponse = z.infer<typeof queueControlResponseSchema>;
export type RunResponse = z.infer<typeof runResponseSchema>;
export type AddPlaywrightTestPayload = z.infer<typeof addPlaywrightTestPayloadSchema>;
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;
export type JobResponse = z.infer<typeof jobResponseSchema>;
export type JobEventResponse = z.infer<typeof jobEventResponseSchema>;
