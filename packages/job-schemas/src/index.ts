import { z } from "zod";

export const jobTypeSchema = z.enum(["ADD_PLAYWRIGHT_TEST"]);

export const jobStatusSchema = z.enum([
  "DRAFT",
  "NEEDS_REVIEW",
  "QUEUED",
  "CLAIMED",
  "RUNNING",
  "VALIDATING",
  "REVIEW",
  "PR_APPROVED",
  "PR_CREATED",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "RETRY",
  "CANCELED",
  "READY_FOR_CODEX",
  "CODEX_APPROVED",
]);

export const prioritySchema = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);

export const repositoryProviderSchema = z.enum(["GITHUB"]);

export const trackerProviderSchema = z.enum(["JIRA"]);

export const runStatusSchema = z.enum([
  "STARTED",
  "CODEX_RUNNING",
  "VALIDATING",
  "PUSHING",
  "PR_CREATED",
  "SUCCEEDED",
  "FAILED",
  "READY_FOR_CODEX",
]);

export const jobEventTypeSchema = z.enum([
  "JOB_CREATED",
  "JOB_APPROVED",
  "JOB_UPDATED",
  "JOB_CLAIMED",
  "JOB_RUNNING",
  "RUN_STARTED",
  "WORKER_SIMULATED_WORK_COMPLETE",
  "JOB_RESET",
  "JOB_CANCELED",
  "REPOSITORY_CHECKOUT_VALIDATION_STARTED",
  "REPOSITORY_CHECKOUT_VALIDATED",
  "WORK_BRANCH_PREPARATION_STARTED",
  "TARGET_BRANCH_CHECKED_OUT",
  "WORK_BRANCH_CREATED",
  "CODEX_APPROVAL_REQUIRED",
  "CODEX_APPROVAL_GRANTED",
  "CODEX_INVOCATION_READY",
  "CODEX_INVOCATION_SKIPPED",
  "CODEX_INVOCATION_STARTED",
  "CODEX_INVOCATION_COMPLETED",
  "CODEX_INVOCATION_FAILED",
  "VALIDATION_STARTED",
  "VALIDATION_COMPLETED",
  "VALIDATION_FAILED",
  "PR_CREATION_STARTED",
  "WORK_BRANCH_COMMITTED",
  "WORK_BRANCH_PUSHED",
  "PR_CREATED",
  "PR_CHECKS_PENDING",
  "PR_CHECKS_PASSED",
  "PR_CHECKS_FAILED",
  "PR_MERGED",
  "PR_CLOSED",
  "LOCAL_CHECKOUT_CLEANUP_COMPLETED",
  "LOCAL_CHECKOUT_CLEANUP_FAILED",
  "PR_CREATION_FAILED",
  "PR_CREATION_APPROVED",
  "JOB_BLOCKED",
  "JIRA_TICKET_CREATED",
  "JIRA_TICKET_CREATION_FAILED",
  "JIRA_TICKET_CREATION_SKIPPED",
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
  validationCommand: z.string().trim().optional(),
  trackerIntegrationId: z.string().uuid("Tracker integration must be valid").nullable().optional(),
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
  validationCommand: z.string().nullable(),
  trackerIntegration: z
    .object({
      id: z.string(),
      name: z.string(),
      provider: trackerProviderSchema,
      projectKey: z.string(),
    })
    .nullable(),
  trackerIntegrationId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const trackerBaseUrlSchema = z
  .string()
  .trim()
  .url("Tracker URL must be a valid URL")
  .transform((value) => value.replace(/\/+$/, ""));

const trackerProjectKeySchema = z
  .string()
  .trim()
  .min(1, "Project key is required")
  .max(32, "Project key is too long")
  .regex(/^[A-Z][A-Z0-9_]+$/, "Use the short Jira project key, like QA or GHP");

export const createTrackerIntegrationRequestSchema = z.object({
  provider: trackerProviderSchema.default("JIRA"),
  name: z.string().trim().min(1, "Integration name is required").max(80, "Integration name is too long"),
  baseUrl: trackerBaseUrlSchema,
  email: z.string().trim().email("Jira email must be valid"),
  apiToken: z.string().trim().min(1, "Jira API token is required"),
  projectKey: trackerProjectKeySchema,
  issueType: z.string().trim().min(1, "Issue type is required").default("Task"),
});

export const updateTrackerIntegrationRequestSchema = createTrackerIntegrationRequestSchema.extend({
  apiToken: z.string().trim().optional(),
});

export const trackerIntegrationResponseSchema = z.object({
  id: z.string(),
  provider: trackerProviderSchema,
  name: z.string(),
  baseUrl: z.string(),
  email: z.string(),
  hasApiToken: z.boolean(),
  projectKey: z.string(),
  issueType: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const trackerIntegrationTestResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  projectName: z.string().nullable(),
  projectKey: z.string().nullable(),
});

const jiraIssueSchema = z.object({
  key: z.string(),
  url: z.string(),
});

export const queueControlResponseSchema = z.object({
  paused: z.boolean(),
  pausedAt: z.string().nullable(),
  resumedAt: z.string().nullable(),
  updatedAt: z.string(),
});

export const readinessResponseSchema = z.object({
  api: z.object({
    databaseConnected: z.boolean(),
  }),
  queue: queueControlResponseSchema,
  counts: z.object({
    activeJobs: z.number().int().nonnegative(),
    blockedJobs: z.number().int().nonnegative(),
    cleanupFailures: z.number().int().nonnegative(),
    codexApprovalJobs: z.number().int().nonnegative(),
    completedJobs: z.number().int().nonnegative(),
    jobs: z.number().int().nonnegative(),
    needsReviewJobs: z.number().int().nonnegative(),
    prApprovalJobs: z.number().int().nonnegative(),
    prCreatedJobs: z.number().int().nonnegative(),
    repositories: z.number().int().nonnegative(),
  }),
  nextAction: z
    .object({
      href: z.string(),
      jobId: z.string().nullable(),
      label: z.string(),
      text: z.string(),
    })
    .nullable(),
  runner: z.object({
    codexCommand: z.string(),
    codexEnabled: z.boolean(),
    heartbeatAgeSeconds: z.number().int().nonnegative().nullable(),
    id: z.string().nullable(),
    lastHeartbeat: z.string().nullable(),
    prCreationEnabled: z.boolean(),
    startCommand: z.string(),
    health: z.enum(["offline", "stale", "idle", "busy", "error"]),
    healthText: z.string(),
    slackConfigured: z.boolean(),
    status: z.string().nullable(),
    validationCommandConfigured: z.boolean(),
  }),
  cleanup: z.object({
    latestFailure: z
      .object({
        baseBranch: z.string().nullable(),
        error: z.string().nullable(),
        headBranch: z.string().nullable(),
        href: z.string(),
        jobId: z.string(),
        localPath: z.string().nullable(),
        message: z.string(),
      })
      .nullable(),
  }),
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

export const captureRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const viewportSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

export const locatorCandidateSchema = z.object({
  strategy: z.string().trim().min(1, "Locator strategy is required"),
  value: z.string().trim().min(1, "Locator value is required"),
});

export const captureContextSchema = z
  .object({
    url: z.string().trim().url("Capture URL must be a valid URL").optional(),
    title: z.string().trim().optional(),
    selectedElement: z.string().trim().optional(),
    elementKey: z.string().trim().optional(),
    domSnippet: z.string().trim().optional(),
    outerHTML: z.string().trim().optional(),
    screenshotAssetId: z.string().trim().optional(),
    snapshotUrl: z.string().trim().optional(),
    selectedText: z.string().trim().optional(),
    imageName: z.string().trim().optional(),
    consoleErrors: z.array(z.string().trim().min(1)).default([]),
    networkEvents: z.array(z.string().trim().min(1)).default([]),
    accessibleRole: z.string().trim().optional(),
    accessibleName: z.string().trim().optional(),
    role: z.string().trim().optional(),
    name: z.string().trim().optional(),
    selectors: z.array(z.string().trim().min(1)).default([]),
    locatorCandidates: z.array(locatorCandidateSchema).default([]),
    thenLine: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    captureRect: captureRectSchema.optional(),
    viewport: viewportSchema.optional(),
    devicePixelRatio: z.number().positive().optional(),
  })
  .strict();

export const currentAddPlaywrightTestPayloadSchema = z.object({
  repositoryId: z.string().uuid("Repository is required"),
  targetBranch: z.string().trim().min(1, "Target branch is required"),
  featureArea: z.string().trim().min(1, "Feature area is required"),
  goal: z.string().trim().min(1, "Goal is required"),
  acceptanceCriteria: z.string().trim().min(1, "Acceptance criteria are required"),
  runAffectedTests: z.boolean().default(true),
  createDraftPr: z.boolean().default(true),
  captureContext: captureContextSchema.optional(),
  jiraIssue: jiraIssueSchema.optional(),
});

export const legacyAddPlaywrightTestPayloadSchema = z.object({
  repository: z.string().trim().min(1, "Repository is required"),
  branch: z.string().trim().min(1, "Branch is required"),
  featureArea: z.string().trim().min(1, "Feature area is required"),
  goal: z.string().trim().min(1, "Goal is required"),
  acceptanceCriteria: z.string().trim().min(1, "Acceptance criteria are required"),
  runAffectedTests: z.boolean().default(true),
  createDraftPr: z.boolean().default(true),
  captureContext: captureContextSchema.optional(),
  jiraIssue: jiraIssueSchema.optional(),
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

export const updateReviewJobRequestSchema = z.object({
  priority: prioritySchema,
  payload: z.object({
    targetBranch: z.string().trim().min(1, "Target branch is required"),
    featureArea: z.string().trim().min(1, "Feature area is required"),
    goal: z.string().trim().min(1, "Goal is required"),
    acceptanceCriteria: z.string().trim().min(1, "Acceptance criteria are required"),
  }),
});

export const retryStageRequestSchema = z.object({
  feedback: z.string().trim().max(4000).optional(),
});

export const discoverTestRecommendationSchema = z.object({
  acceptance: z.array(z.string().trim().min(1)).min(1).max(8),
  impact: z.enum(["High", "Medium"]),
  reason: z.string().trim().min(1).max(800),
  scenario: z.array(z.string().trim().min(1)).min(1).max(8),
  tags: z.array(z.string().trim().regex(/^@[A-Za-z0-9_-]+$/)).min(1).max(8),
  title: z.string().trim().min(1).max(160),
});

export const discoverTestRecommendationsRequestSchema = z.object({
  maxRecommendations: z.number().int().min(1).max(20).default(12),
  notes: z.string().trim().max(4000).default(""),
  pageUrl: z.string().trim().url("Page URL must be a valid URL"),
});

export const discoverTestRecommendationsResponseSchema = z.object({
  message: z.string().nullable(),
  provider: z.enum(["openai", "local"]),
  recommendations: z.array(discoverTestRecommendationSchema).max(20),
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

export const paginatedJobsResponseSchema = z.object({
  jobs: z.array(jobResponseSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});

export const jobEventResponseSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  eventType: jobEventTypeSchema,
  message: z.string(),
  metadata: z.unknown().nullable(),
  createdAt: z.string(),
});

export const jobDiffResponseSchema = z.object({
  available: z.boolean(),
  baseRef: z.string().nullable(),
  diff: z.string(),
  localPath: z.string().nullable(),
  reason: z.string().nullable(),
  stat: z.string(),
  truncated: z.boolean(),
  workBranch: z.string().nullable(),
});

export const cucumberStepSchema = z.object({
  keyword: z.string(),
  line: z.number().int().positive(),
  matchedDefinition: z
    .object({
      expression: z.string(),
      line: z.number().int().positive(),
      path: z.string(),
    })
    .nullable(),
  text: z.string(),
});

export const cucumberScenarioSchema = z.object({
  keyword: z.string(),
  line: z.number().int().positive(),
  name: z.string(),
  steps: z.array(cucumberStepSchema),
  tags: z.array(z.string()),
  unmatchedStepCount: z.number().int().nonnegative(),
});

export const cucumberFeatureSummarySchema = z.object({
  description: z.string().nullable(),
  feature: z.string(),
  modifiedAt: z.string(),
  path: z.string(),
  scenarioCount: z.number().int().nonnegative(),
  scenarios: z.array(cucumberScenarioSchema),
  tags: z.array(z.string()),
});

export const cucumberAssociatedFileSchema = z.object({
  kind: z.enum(["feature", "step_definitions", "support", "other"]),
  path: z.string(),
});

export const cucumberFeatureCatalogResponseSchema = z.object({
  features: z.array(cucumberFeatureSummarySchema),
  localPath: z.string().nullable(),
  repository: repositoryResponseSchema,
  root: z.string().nullable(),
  totalScenarios: z.number().int().nonnegative(),
});

export const cucumberFeatureDetailResponseSchema = z.object({
  associatedFiles: z.array(cucumberAssociatedFileSchema),
  content: z.string(),
  feature: cucumberFeatureSummarySchema,
  localPath: z.string().nullable(),
  repository: repositoryResponseSchema,
});

export const explainCucumberScenarioRequestSchema = z.object({
  path: z.string().trim().min(1, "Feature path is required"),
  scenarioLine: z.number().int().positive("Scenario line is required"),
});

export const explainCucumberScenarioResponseSchema = z.object({
  explanation: z.string(),
  provider: z.enum(["openai", "local"]),
  scenarioLine: z.number().int().positive(),
});

export type JobType = z.infer<typeof jobTypeSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobPriority = z.infer<typeof prioritySchema>;
export type RepositoryProvider = z.infer<typeof repositoryProviderSchema>;
export type TrackerProvider = z.infer<typeof trackerProviderSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type JobEventType = z.infer<typeof jobEventTypeSchema>;
export type CreateRepositoryRequest = z.infer<typeof createRepositoryRequestSchema>;
export type RepositoryResponse = z.infer<typeof repositoryResponseSchema>;
export type CreateTrackerIntegrationRequest = z.infer<typeof createTrackerIntegrationRequestSchema>;
export type TrackerIntegrationResponse = z.infer<typeof trackerIntegrationResponseSchema>;
export type TrackerIntegrationTestResponse = z.infer<typeof trackerIntegrationTestResponseSchema>;
export type QueueControlResponse = z.infer<typeof queueControlResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
export type RunResponse = z.infer<typeof runResponseSchema>;
export type CaptureContext = z.infer<typeof captureContextSchema>;
export type AddPlaywrightTestPayload = z.infer<typeof addPlaywrightTestPayloadSchema>;
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;
export type UpdateReviewJobRequest = z.infer<typeof updateReviewJobRequestSchema>;
export type RetryStageRequest = z.infer<typeof retryStageRequestSchema>;
export type DiscoverTestRecommendation = z.infer<typeof discoverTestRecommendationSchema>;
export type DiscoverTestRecommendationsRequest = z.infer<typeof discoverTestRecommendationsRequestSchema>;
export type DiscoverTestRecommendationsResponse = z.infer<typeof discoverTestRecommendationsResponseSchema>;
export type JobResponse = z.infer<typeof jobResponseSchema>;
export type PaginatedJobsResponse = z.infer<typeof paginatedJobsResponseSchema>;
export type JobEventResponse = z.infer<typeof jobEventResponseSchema>;
export type JobDiffResponse = z.infer<typeof jobDiffResponseSchema>;
export type CucumberScenario = z.infer<typeof cucumberScenarioSchema>;
export type CucumberStep = z.infer<typeof cucumberStepSchema>;
export type CucumberFeatureSummary = z.infer<typeof cucumberFeatureSummarySchema>;
export type CucumberAssociatedFile = z.infer<typeof cucumberAssociatedFileSchema>;
export type CucumberFeatureCatalogResponse = z.infer<typeof cucumberFeatureCatalogResponseSchema>;
export type CucumberFeatureDetailResponse = z.infer<typeof cucumberFeatureDetailResponseSchema>;
export type ExplainCucumberScenarioRequest = z.infer<typeof explainCucumberScenarioRequestSchema>;
export type ExplainCucumberScenarioResponse = z.infer<typeof explainCucumberScenarioResponseSchema>;
