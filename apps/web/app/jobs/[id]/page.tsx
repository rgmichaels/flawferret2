import type {
  JobDiffResponse,
  JobEventResponse,
  JobResponse,
  JobStatus,
  ReadinessResponse,
  RunResponse,
  RunStatus,
} from "@flawferret2/job-schemas";
import { revalidatePath } from "next/cache";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function getJob(id: string): Promise<JobResponse | null> {
  try {
    const response = await fetch(`${apiUrl}/jobs/${id}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<JobResponse>;
  } catch {
    return null;
  }
}

async function getJobEvents(id: string): Promise<JobEventResponse[]> {
  try {
    const response = await fetch(`${apiUrl}/jobs/${id}/events`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    return response.json() as Promise<JobEventResponse[]>;
  } catch {
    return [];
  }
}

async function getJobRuns(id: string): Promise<RunResponse[]> {
  try {
    const response = await fetch(`${apiUrl}/jobs/${id}/runs`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    return response.json() as Promise<RunResponse[]>;
  } catch {
    return [];
  }
}

async function getReadiness(): Promise<ReadinessResponse | null> {
  try {
    const response = await fetch(`${apiUrl}/readiness`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<ReadinessResponse>;
  } catch {
    return null;
  }
}

async function getJobDiff(id: string): Promise<JobDiffResponse | null> {
  try {
    const response = await fetch(`${apiUrl}/jobs/${id}/diff`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<JobDiffResponse>;
  } catch {
    return null;
  }
}

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const formatEventType = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const runStatusLabels: Record<RunStatus, string> = {
  CODEX_RUNNING: "Codex Running",
  FAILED: "Failed",
  PR_CREATED: "PR Created",
  PUSHING: "Pushing",
  READY_FOR_CODEX: "Ready for Codex",
  STARTED: "Started",
  SUCCEEDED: "Succeeded",
  VALIDATING: "Validating",
};

const jobStatusLabels: Record<JobStatus, string> = {
  BLOCKED: "Blocked",
  CANCELED: "Canceled",
  CLAIMED: "Claimed",
  CODEX_APPROVED: "Codex Approved",
  COMPLETED: "Completed",
  DRAFT: "Draft",
  FAILED: "Failed",
  NEEDS_REVIEW: "Needs Review",
  QUEUED: "Queued",
  READY_FOR_CODEX: "Ready for Codex",
  RETRY: "Retry",
  PR_APPROVED: "PR Approved",
  PR_CREATED: "PR Created",
  REVIEW: "Review",
  RUNNING: "Running",
  VALIDATING: "Validating",
};

const prLifecycleLabels: Record<string, string> = {
  CHECKS_FAILED: "Checks failed",
  CHECKS_PASSED: "Checks passed; waiting for merge",
  CHECKS_PENDING: "Checks pending",
  CLOSED: "Closed without merge",
  MERGED: "Merged",
  NO_CHECKS: "No checks reported",
};

async function approveCodex(formData: FormData) {
  "use server";

  const jobId = String(formData.get("jobId") ?? "");
  const response = await fetch(`${apiUrl}/jobs/${jobId}/approve-codex`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Unable to approve Codex for this job.");
  }

  revalidatePath("/");
  revalidatePath(`/jobs/${jobId}`);
}

async function approvePr(formData: FormData) {
  "use server";

  const jobId = String(formData.get("jobId") ?? "");
  const response = await fetch(`${apiUrl}/jobs/${jobId}/approve-pr`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Unable to approve draft PR creation for this job.");
  }

  revalidatePath("/");
  revalidatePath(`/jobs/${jobId}`);
}

async function requeueJob(formData: FormData) {
  "use server";

  const jobId = String(formData.get("jobId") ?? "");
  const response = await fetch(`${apiUrl}/jobs/${jobId}/requeue`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Unable to requeue this job.");
  }

  revalidatePath("/");
  revalidatePath(`/jobs/${jobId}`);
}

async function cancelJob(formData: FormData) {
  "use server";

  const jobId = String(formData.get("jobId") ?? "");
  const response = await fetch(`${apiUrl}/jobs/${jobId}/cancel`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Unable to cancel this job.");
  }

  revalidatePath("/");
  revalidatePath(`/jobs/${jobId}`);
}

async function retryCurrentStage(formData: FormData) {
  "use server";

  const jobId = String(formData.get("jobId") ?? "");
  const feedback = String(formData.get("feedback") ?? "").trim();
  const response = await fetch(`${apiUrl}/jobs/${jobId}/retry-stage`, {
    body: JSON.stringify({
      feedback: feedback.length > 0 ? feedback : undefined,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Unable to retry the current stage.");
  }

  revalidatePath("/");
  revalidatePath(`/jobs/${jobId}`);
}

const getJobRepositoryName = (job: JobResponse) => {
  if (job.repository) {
    return `${job.repository.owner}/${job.repository.name}`;
  }

  if ("repository" in job.payload) {
    return job.payload.repository;
  }

  return "Unregistered repository";
};

const getJobTargetBranch = (job: JobResponse) => {
  if ("targetBranch" in job.payload) {
    return job.payload.targetBranch;
  }

  return job.payload.branch;
};

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

const getMetadataNumber = (metadata: unknown, key: string) => {
  const value = getMetadataRecord(metadata)[key];

  return typeof value === "number" ? value : null;
};

const getMetadataBoolean = (metadata: unknown, key: string) => {
  const value = getMetadataRecord(metadata)[key];

  return typeof value === "boolean" ? value : null;
};

const getMetadataStrings = (metadata: unknown, key: string) => {
  const value = getMetadataRecord(metadata)[key];

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
};

const getNestedMetadata = (metadata: unknown, key: string) =>
  getMetadataRecord(getMetadataRecord(metadata)[key]);

const formatOptionalNumber = (value: number | null) => (value === null ? "Not recorded" : String(value));

const formatBooleanState = (value: boolean | null, trueLabel: string, falseLabel: string) => {
  if (value === null) {
    return "Not recorded";
  }

  return value ? trueLabel : falseLabel;
};

const formatDiagnosticText = (value: string | null, fallback: string) => {
  if (!value) {
    return fallback;
  }

  const compactValue = value.replace(/\s+/g, " ").trim();

  return compactValue.length > 180 ? `${compactValue.slice(0, 177)}...` : compactValue;
};

const getLastEventMessage = (events: JobEventResponse[], eventTypes: string[]) => {
  const event = [...events].reverse().find((item) => eventTypes.includes(item.eventType));

  return event?.message ?? null;
};

const getLastEvent = (events: JobEventResponse[], eventTypes: string[]) =>
  [...events].reverse().find((item) => eventTypes.includes(item.eventType)) ?? null;

const isWebUrl = (value: string) => value.startsWith("https://") || value.startsWith("http://");

type PipelineStageState = "blocked" | "complete" | "current" | "skipped" | "waiting";

type PipelineStage = {
  description: string;
  label: string;
  state: PipelineStageState;
};

type ApprovalAction = {
  buttonLabel: string;
  description: string;
  formAction: (formData: FormData) => Promise<void>;
  riskLabel: string;
  title: string;
};

const canRequeueJob = (status: JobStatus) =>
  status === "BLOCKED" || status === "FAILED" || status === "RETRY";

const canCancelJob = (status: JobStatus) =>
  status === "DRAFT" || status === "NEEDS_REVIEW" || status === "QUEUED" || status === "RETRY";

const canRetryCurrentStage = (job: JobResponse, latestRun: RunResponse | null) =>
  Boolean(latestRun) &&
  (job.status === "BLOCKED" ||
    job.status === "FAILED" ||
    job.status === "RETRY" ||
    job.status === "REVIEW" ||
    job.status === "PR_APPROVED");

const terminalAttentionStatuses: JobStatus[] = ["BLOCKED", "FAILED", "RETRY", "CANCELED"];

const getCreateDraftPr = (validationMetadata: Record<string, unknown>) =>
  getMetadataBoolean(validationMetadata, "createDraftPr") !== false;

const getApprovalAction = (
  job: JobResponse,
  readiness: ReadinessResponse | null,
): ApprovalAction | null => {
  if (job.status === "READY_FOR_CODEX") {
    const codexEnabled = readiness?.runner.codexEnabled ?? false;

    return {
      buttonLabel: "Approve Codex",
      description: codexEnabled
        ? "The runner may invoke Codex for this job after this approval. Keep the queue paused if you are not ready for model usage yet."
        : "Codex execution is disabled. This approval will let the runner record the invocation plan, then return the job to this gate.",
      formAction: approveCodex,
      riskLabel: codexEnabled ? "Can spend API credits" : "Dry-run: no model call",
      title: codexEnabled ? "Approve model execution" : "Approve dry-run plan",
    };
  }

  if (job.status === "REVIEW") {
    const prCreationEnabled = readiness?.runner.prCreationEnabled ?? false;

    return {
      buttonLabel: "Approve Draft PR",
      description: prCreationEnabled
        ? "The runner may push the generated work branch and create a draft GitHub pull request after this approval."
        : "Draft PR creation is disabled. This approval will not push a branch or create a GitHub pull request until runner PR creation is enabled.",
      formAction: approvePr,
      riskLabel: prCreationEnabled ? "Can push code" : "Dry-run: no push",
      title: prCreationEnabled ? "Approve PR creation" : "Approve PR dry-run",
    };
  }

  return null;
};

const buildPipelineStages = ({
  job,
  latestRun,
  prUrl,
  validationMetadata,
}: {
  job: JobResponse;
  latestRun: RunResponse | null;
  prUrl: string | null;
  validationMetadata: Record<string, unknown>;
}): PipelineStage[] => {
  const shouldCreateDraftPr = getCreateDraftPr(validationMetadata);
  const hasRun = Boolean(latestRun);
  const hasValidation = Object.keys(validationMetadata).length > 0;
  const hasAttentionStatus = terminalAttentionStatuses.includes(job.status);
  const codexDone =
    hasValidation ||
    job.status === "VALIDATING" ||
    job.status === "REVIEW" ||
    job.status === "PR_APPROVED" ||
    job.status === "PR_CREATED" ||
    job.status === "COMPLETED";
  const validationDone =
    job.status === "COMPLETED" ||
    job.status === "PR_CREATED" ||
    (hasValidation && (job.status === "REVIEW" || job.status === "PR_APPROVED"));

  return [
    {
      description:
        job.status === "QUEUED" || job.status === "DRAFT"
          ? "Waiting for runner pickup."
          : "Job request is stored.",
      label: "Queue",
      state:
        job.status === "DRAFT" || job.status === "QUEUED"
          ? "current"
          : hasAttentionStatus && !hasRun
            ? "blocked"
            : "complete",
    },
    {
      description: hasRun ? "Local checkout and work branch are prepared." : "Runner prepares repo.",
      label: "Workspace",
      state:
        hasRun || codexDone
          ? "complete"
          : job.status === "CLAIMED" || job.status === "RUNNING"
            ? "current"
            : hasAttentionStatus
              ? "blocked"
              : "waiting",
    },
    {
      description:
        job.status === "READY_FOR_CODEX"
          ? "Manual approval required before model spend."
          : job.status === "CODEX_APPROVED"
            ? "Approved; runner will invoke Codex."
          : codexDone
            ? "Generated changes are ready."
            : "Codex will add the requested test coverage.",
      label: "Codex",
      state: codexDone
        ? "complete"
        : job.status === "READY_FOR_CODEX" ||
            job.status === "CODEX_APPROVED" ||
            latestRun?.status === "CODEX_RUNNING"
          ? "current"
          : hasAttentionStatus && hasRun
            ? "blocked"
            : "waiting",
    },
    {
      description: validationDone
        ? "Generated work has validation metadata."
        : "Runner checks the generated changes.",
      label: "Validation",
      state: validationDone
        ? "complete"
        : job.status === "VALIDATING" || latestRun?.status === "VALIDATING"
          ? "current"
          : hasAttentionStatus && codexDone
            ? "blocked"
            : "waiting",
    },
    {
      description: shouldCreateDraftPr
        ? prUrl
          ? "Draft pull request is available."
          : job.status === "PR_APPROVED"
            ? "Approved; runner will push the branch and create the PR."
            : job.status === "PR_CREATED"
              ? "Draft pull request was created; checks and merge are pending."
            : job.status === "COMPLETED"
              ? "Pipeline completed."
              : "Manual approval required before branch push and PR creation."
        : "Draft PR creation was not requested.",
      label: "Draft PR",
      state: !shouldCreateDraftPr
        ? "skipped"
        : prUrl || job.status === "PR_CREATED" || job.status === "COMPLETED"
          ? "complete"
          : job.status === "REVIEW" || job.status === "PR_APPROVED" || latestRun?.status === "PUSHING"
            ? "current"
            : hasAttentionStatus && validationDone
              ? "blocked"
              : "waiting",
    },
    {
      description: job.status === "COMPLETED" ? "Pipeline finished." : "Final state is pending.",
      label: "Done",
      state:
        job.status === "COMPLETED"
          ? "complete"
          : hasAttentionStatus
            ? "blocked"
            : "waiting",
    },
  ];
};

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [job, events, runs, readiness, generatedDiff] = await Promise.all([
    getJob(id),
    getJobEvents(id),
    getJobRuns(id),
    getReadiness(),
    getJobDiff(id),
  ]);

  if (!job) {
    return (
      <main className="detail-shell">
        <a className="back-link" href="/">
          Back to dashboard
        </a>
        <section className="panel detail-empty">
          <h1>Job not found</h1>
          <p>The requested job does not exist or the API is unavailable.</p>
        </section>
      </main>
    );
  }

  const latestRun = runs[0] ?? job.latestRun;
  const latestMetadata = latestRun?.metadata ?? null;
  const codexMetadata = getNestedMetadata(latestMetadata, "codex");
  const validationMetadata = getNestedMetadata(latestMetadata, "validation");
  const retryFeedbackMetadata = getNestedMetadata(latestMetadata, "retryFeedback");
  const pullRequestMetadata = getNestedMetadata(latestMetadata, "pullRequest");
  const pullRequestLifecycleMetadata = getNestedMetadata(pullRequestMetadata, "lifecycle");
  const changedFiles = getMetadataStrings(validationMetadata, "changedFiles");
  const blockedReason = getLastEventMessage(events, [
    "JOB_BLOCKED",
    "CODEX_INVOCATION_FAILED",
    "VALIDATION_FAILED",
    "PR_CREATION_FAILED",
  ]);
  const cleanupFailureEvent = getLastEvent(events, ["LOCAL_CHECKOUT_CLEANUP_FAILED"]);
  const cleanupFailureMetadata = getMetadataRecord(cleanupFailureEvent?.metadata);
  const cleanupFailureError = getMetadataString(cleanupFailureMetadata, "error");
  const cleanupFailureLocalPath = getMetadataString(cleanupFailureMetadata, "localPath");
  const cleanupFailureHeadBranch = getMetadataString(cleanupFailureMetadata, "headBranch");
  const cleanupFailureBaseBranch = getMetadataString(cleanupFailureMetadata, "baseBranch");
  const prUrl = getMetadataString(pullRequestMetadata, "prUrl");
  const prLifecycleState = getMetadataString(pullRequestLifecycleMetadata, "lifecycleState");
  const prCheckCounts = getNestedMetadata(pullRequestLifecycleMetadata, "checks");
  const latestEvent = events[events.length - 1] ?? null;
  const approvalAction = getApprovalAction(job, readiness);
  const codexEnabled = readiness?.runner.codexEnabled ?? false;
  const prCreationEnabled = readiness?.runner.prCreationEnabled ?? false;
  const pipelineStages = buildPipelineStages({
    job,
    latestRun,
    prUrl,
    validationMetadata,
  });
  const codexExitCode = getMetadataNumber(codexMetadata, "exitCode");
  const codexTimedOut = getMetadataBoolean(codexMetadata, "timedOut");
  const codexError = getMetadataString(codexMetadata, "error");
  const codexFinalResponse = getMetadataString(codexMetadata, "finalResponse");
  const focusedValidationCommand =
    getMetadataString(validationMetadata, "focusedValidationCommand") ??
    getMetadataString(codexMetadata, "focusedValidationCommand");
  const codexLogPath = getMetadataString(codexMetadata, "logPath");
  const codexStderrPath = getMetadataString(codexMetadata, "stderrPath");
  const validationExitCode = getMetadataNumber(validationMetadata, "exitCode");
  const validationError = getMetadataString(validationMetadata, "error");
  const validationLogPath = getMetadataString(validationMetadata, "logPath");
  const validationStderrPath = getMetadataString(validationMetadata, "stderrPath");
  const validationCommand = getMetadataString(validationMetadata, "command");
  const validationCommandSource = getMetadataString(validationMetadata, "commandSource");
  const lastRetryFeedback = getMetadataString(retryFeedbackMetadata, "feedback");
  const pullRequestError = getMetadataString(pullRequestMetadata, "error");
  const pullRequestLifecycleError = getMetadataString(pullRequestLifecycleMetadata, "error");
  const validationHasRun = Object.keys(validationMetadata).length > 0;
  const validationRanRealCommand = Boolean(validationCommand);
  const validationTrust = validationError
    ? {
        description:
          validationCommandSource === "changed_files"
            ? "The fallback changed-file check failed. No focused test command was run for this job."
            : "A configured validation command ran and failed. Review the validation logs before approving anything.",
        label: "Validation failed",
        tone: "danger",
        value: validationCommand ?? "Changed-file check",
      }
    : validationRanRealCommand
      ? {
          description:
            validationCommandSource === "focused"
              ? "Codex suggested a focused command for this generated test, and it ran successfully."
              : validationCommandSource === "repository"
              ? "The repository validation command ran successfully after Codex changed the code."
              : "The global validation command ran successfully after Codex changed the code.",
          label: "Real command passed",
          tone: "ok",
          value: validationCommand,
        }
      : validationHasRun
        ? {
            description:
              "No focused test command was configured for this run. FF2 only confirmed that Codex changed files.",
            label: "Only checked changed files",
            tone: "warn",
            value: `${changedFiles.length} changed file${changedFiles.length === 1 ? "" : "s"}`,
          }
        : {
            description:
              "Validation has not run yet. After Codex finishes, FF2 will use the configured command if one exists.",
            label: "Validation pending",
            tone: "muted",
            value: "Not run",
          };
  const attentionText =
    cleanupFailureError ??
    blockedReason ??
    codexError ??
    validationError ??
    pullRequestError ??
    pullRequestLifecycleError ??
    latestEvent?.message ??
    "No events have been recorded yet.";
  const diagnostics = [
    {
      detail: latestRun
        ? `${runStatusLabels[latestRun.status]} started ${formatDateTime(latestRun.startedAt)}`
        : "No runner execution has started.",
      label: "Latest Run",
      tone: latestRun?.status === "FAILED" ? "danger" : latestRun ? "ok" : "muted",
      value: latestRun ? `#${latestRun.id.slice(0, 8)}` : "None",
    },
    {
      detail:
        codexError ??
        formatDiagnosticText(
          codexFinalResponse,
          Object.keys(codexMetadata).length > 0 ? "Codex metadata is available." : "No Codex attempt recorded.",
        ),
      label: "Codex",
      tone: codexError || codexTimedOut ? "danger" : Object.keys(codexMetadata).length > 0 ? "ok" : "muted",
      value:
        codexTimedOut === true
          ? "Timed out"
          : codexExitCode !== null
            ? `Exit ${codexExitCode}`
            : "Not run",
    },
    {
      detail:
        validationError ??
        (changedFiles.length > 0
          ? `${changedFiles.length} changed file${changedFiles.length === 1 ? "" : "s"} recorded.`
          : "No validation output recorded."),
      label: "Validation",
      tone:
        validationError || (validationExitCode !== null && validationExitCode !== 0)
          ? "danger"
          : Object.keys(validationMetadata).length > 0
            ? "ok"
            : "muted",
      value: validationExitCode !== null ? `Exit ${validationExitCode}` : "Not run",
    },
    {
      detail:
        pullRequestError ??
        pullRequestLifecycleError ??
        (prUrl ? "Pull request metadata is available." : "No pull request has been created."),
      label: "Pull Request",
      tone: pullRequestError || pullRequestLifecycleError ? "danger" : prUrl ? "ok" : "muted",
      value: prLifecycleState
        ? prLifecycleLabels[prLifecycleState] ?? prLifecycleState
        : prUrl
          ? "Created"
          : "Not created",
    },
  ];

  return (
    <main className="detail-shell">
      <a className="back-link" href="/">
        Back to dashboard
      </a>

      <header className="detail-hero">
        <div>
          <p className="eyebrow">Job Detail</p>
          <h1>{job.payload.featureArea}</h1>
          <p>{job.payload.goal}</p>
        </div>
        <div className="detail-actions">
          {job.status === "NEEDS_REVIEW" ? (
            <a className="primary-link" href={`/jobs/${job.id}/review`}>
              Review Job
            </a>
          ) : null}
          {approvalAction ? (
            <section className="approval-card" aria-label={approvalAction.title}>
              <span>{approvalAction.riskLabel}</span>
              <strong>{approvalAction.title}</strong>
              <p>{approvalAction.description}</p>
              <form action={approvalAction.formAction}>
                <input type="hidden" name="jobId" value={job.id} />
                <button type="submit">{approvalAction.buttonLabel}</button>
              </form>
            </section>
          ) : null}
          {canRetryCurrentStage(job, latestRun) ? (
            <form action={retryCurrentStage}>
              <input type="hidden" name="jobId" value={job.id} />
              <button className="secondary-button" type="submit">
                Retry Current Stage
              </button>
            </form>
          ) : null}
          {canRequeueJob(job.status) ? (
            <form action={requeueJob}>
              <input type="hidden" name="jobId" value={job.id} />
              <button className="secondary-button" type="submit">
                Retry Setup
              </button>
            </form>
          ) : null}
          {canCancelJob(job.status) ? (
            <form action={cancelJob}>
              <input type="hidden" name="jobId" value={job.id} />
              <button className="secondary-button danger-button" type="submit">
                Cancel Job
              </button>
            </form>
          ) : null}
          <span className={`status-pill ${job.status.toLowerCase()}`}>
            {jobStatusLabels[job.status]}
          </span>
        </div>
      </header>

      <section className="panel execution-mode-card" aria-label="Execution mode">
        <div>
          <span className={codexEnabled ? "mode-live" : "mode-dry-run"}>Codex</span>
          <strong>{codexEnabled ? "Live execution enabled" : "Dry-run mode"}</strong>
          <p>
            {codexEnabled
              ? "Codex approvals can invoke the configured model command."
              : "Codex approvals record invocation plans without calling the model."}
          </p>
          <code>FERRET_RUNNER_ENABLE_CODEX={codexEnabled ? "true" : "false"}</code>
        </div>
        <div>
          <span className={prCreationEnabled ? "mode-live" : "mode-dry-run"}>Draft PR</span>
          <strong>{prCreationEnabled ? "PR creation enabled" : "PR creation disabled"}</strong>
          <p>
            {prCreationEnabled
              ? "Draft PR approvals can push branches and create GitHub PRs."
              : "Draft PR approvals will not push branches or create GitHub PRs."}
          </p>
          <code>FERRET_RUNNER_ENABLE_PR_CREATION={prCreationEnabled ? "true" : "false"}</code>
        </div>
      </section>

      <section className="panel stage-tracker" aria-label="Job pipeline stages">
        {pipelineStages.map((stage, index) => (
          <article className={`stage-card ${stage.state}`} key={stage.label}>
            <span>{index + 1}</span>
            <div>
              <strong>{stage.label}</strong>
              <p>{stage.description}</p>
            </div>
            <small>{stage.state}</small>
          </article>
        ))}
      </section>

      <section className={`panel validation-trust-card ${validationTrust.tone}`} aria-label="Validation trust level">
        <div>
          <span>Validation</span>
          <strong>{validationTrust.label}</strong>
          <p>{validationTrust.description}</p>
        </div>
        <code>{validationTrust.value}</code>
      </section>

      {canRetryCurrentStage(job, latestRun) ? (
        <section className="panel retry-feedback-card" aria-label="Retry with feedback">
          <div>
            <h2>Send Back to Codex</h2>
            <p>
              Add reviewer feedback before retrying so Codex knows exactly what to revise.
            </p>
            {lastRetryFeedback ? (
              <blockquote>{lastRetryFeedback}</blockquote>
            ) : null}
          </div>
          <form action={retryCurrentStage}>
            <input type="hidden" name="jobId" value={job.id} />
            <textarea
              name="feedback"
              placeholder="Make the scenario explicitly verify the text 'Broken Images' appears on the page."
              required
            />
            <button className="secondary-button" type="submit">
              Retry Codex with Feedback
            </button>
          </form>
        </section>
      ) : null}

      <section className="panel generated-diff-card" aria-label="Generated diff">
        <div className="generated-diff-header">
          <div>
            <h2>Generated Diff</h2>
            <p>Review the local generated changes before approving draft PR creation.</p>
          </div>
          <span>{generatedDiff?.available ? "Available" : "Not available"}</span>
        </div>
        {generatedDiff?.available ? (
          <>
            <dl className="generated-diff-meta">
              <div>
                <dt>Base</dt>
                <dd>
                  <code>{generatedDiff.baseRef ?? "Not recorded"}</code>
                </dd>
              </div>
              <div>
                <dt>Work Branch</dt>
                <dd>
                  <code>{generatedDiff.workBranch ?? "Not recorded"}</code>
                </dd>
              </div>
              <div>
                <dt>Local Path</dt>
                <dd>
                  <code>{generatedDiff.localPath ?? "Not recorded"}</code>
                </dd>
              </div>
            </dl>
            <pre className="generated-diff-stat">{generatedDiff.stat.trim()}</pre>
            <pre className="generated-diff-output">{generatedDiff.diff}</pre>
            {generatedDiff.truncated ? (
              <p className="generated-diff-note">Diff output was truncated for display.</p>
            ) : null}
          </>
        ) : (
          <p className="empty compact-empty">
            {generatedDiff?.reason ?? "Generated diff could not be loaded from the API."}
          </p>
        )}
      </section>

      <section className="panel diagnostics-card" aria-label="Job diagnostics">
        <div className="diagnostics-header">
          <div>
            <h2>Diagnostics</h2>
            <p>Latest runner output and artifact pointers for this job.</p>
          </div>
          <span>{jobStatusLabels[job.status]}</span>
        </div>
        <div className="diagnostics-grid">
          {diagnostics.map((item) => (
            <article className={`diagnostic-item ${item.tone}`} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
        <div className="diagnostics-log-grid">
          <section>
            <h3>Log Paths</h3>
            <dl>
              <div>
                <dt>Codex stdout</dt>
                <dd>
                  <code>{codexLogPath ?? "Not recorded"}</code>
                </dd>
              </div>
              <div>
                <dt>Codex stderr</dt>
                <dd>
                  <code>{codexStderrPath ?? "Not recorded"}</code>
                </dd>
              </div>
              <div>
                <dt>Validation stdout</dt>
                <dd>
                  <code>{validationLogPath ?? "Not recorded"}</code>
                </dd>
              </div>
              <div>
                <dt>Validation stderr</dt>
                <dd>
                  <code>{validationStderrPath ?? "Not recorded"}</code>
                </dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>Last Signal</h3>
            <dl>
              <div>
                <dt>Event</dt>
                <dd>{latestEvent ? formatEventType(latestEvent.eventType) : "None"}</dd>
              </div>
              <div>
                <dt>When</dt>
                <dd>{latestEvent ? formatDateTime(latestEvent.createdAt) : "Not recorded"}</dd>
              </div>
              <div>
                <dt>Codex Timeout</dt>
                <dd>{formatBooleanState(codexTimedOut, "Yes", "No")}</dd>
              </div>
              <div>
                <dt>Validation Exit</dt>
                <dd>{formatOptionalNumber(validationExitCode)}</dd>
              </div>
            </dl>
          </section>
        </div>
        <div className="diagnostics-attention">
          <strong>What happened last</strong>
          <p>{attentionText}</p>
        </div>
      </section>

      <div className="detail-grid">
        <section className="panel detail-card">
          <h2>Request</h2>
          <dl>
            <div>
              <dt>Repository</dt>
              <dd>{getJobRepositoryName(job)}</dd>
            </div>
            <div>
              <dt>Target Branch</dt>
              <dd>{getJobTargetBranch(job)}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{job.priority}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDateTime(job.createdAt)}</dd>
            </div>
            {"jiraIssue" in job.payload && job.payload.jiraIssue ? (
              <div>
                <dt>Jira</dt>
                <dd>
                  <a href={job.payload.jiraIssue.url}>{job.payload.jiraIssue.key}</a>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Acceptance Criteria</dt>
              <dd className="multiline-value">{job.payload.acceptanceCriteria}</dd>
            </div>
          </dl>
        </section>

        <section className="panel detail-card">
          <h2>Runs</h2>
          {runs.length === 0 ? (
            <p className="empty compact-empty">No execution runs have started yet.</p>
          ) : (
            <ol className="run-list">
              {runs.map((run) => (
                <li key={run.id}>
                  <div>
                    <span className={`run-pill ${run.status.toLowerCase()}`}>
                      {runStatusLabels[run.status]}
                    </span>
                    <code>#{run.id.slice(0, 8)}</code>
                  </div>
                  <time dateTime={run.startedAt}>Started {formatDateTime(run.startedAt)}</time>
                  {run.workerId ? <small>Worker {run.workerId}</small> : null}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="panel detail-card pipeline-card">
          <h2>Pipeline</h2>
          <div className="pipeline-grid">
            <section className="pipeline-section">
              <h3>Workspace</h3>
              <dl>
                <div>
                  <dt>Local Path</dt>
                  <dd>
                    <code>{getMetadataString(latestMetadata, "localPath") ?? "Not recorded"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Work Branch</dt>
                  <dd>
                    <code>{getMetadataString(latestMetadata, "workBranch") ?? "Not recorded"}</code>
                  </dd>
                </div>
              </dl>
            </section>

            <section className="pipeline-section">
              <h3>Codex</h3>
              <dl>
                <div>
                  <dt>Model</dt>
                  <dd>{getMetadataString(codexMetadata, "model") ?? "Default"}</dd>
                </div>
                <div>
                  <dt>Output Log</dt>
                  <dd>
                    <code>{getMetadataString(codexMetadata, "logPath") ?? "Not recorded"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Summary</dt>
                  <dd>{getMetadataString(codexMetadata, "finalResponse") ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Suggested Focused Check</dt>
                  <dd>
                    <code>{focusedValidationCommand ?? "Not suggested"}</code>
                  </dd>
                </div>
              </dl>
            </section>

            <section className="pipeline-section">
              <h3>Validation</h3>
              <dl>
                <div>
                  <dt>Changed Files</dt>
                  <dd>
                    {changedFiles.length > 0
                      ? `${getMetadataNumber(validationMetadata, "changedFileCount") ?? changedFiles.length}`
                      : "None recorded"}
                  </dd>
                </div>
                <div>
                  <dt>Command</dt>
                  <dd>{validationCommand ?? "Change detection only"}</dd>
                </div>
                <div>
                  <dt>Command Source</dt>
                  <dd>{validationCommandSource ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Focused Suggestion</dt>
                  <dd>
                    <code>{focusedValidationCommand ?? "Not recorded"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Test Scope</dt>
                  <dd>
                    {getMetadataBoolean(validationMetadata, "runAffectedTests") === false
                      ? "Smallest useful verification"
                      : "Affected tests only"}
                  </dd>
                </div>
                <div>
                  <dt>Draft PR</dt>
                  <dd>
                    {getMetadataBoolean(validationMetadata, "createDraftPr") === false
                      ? "Not requested"
                      : "Requested"}
                  </dd>
                </div>
                <div>
                  <dt>Validation Log</dt>
                  <dd>
                    <code>{getMetadataString(validationMetadata, "logPath") ?? "Not recorded"}</code>
                  </dd>
                </div>
              </dl>
              {changedFiles.length > 0 ? (
                <ul className="changed-file-list">
                  {changedFiles.slice(0, 12).map((file) => (
                    <li key={file}>
                      <code>{file}</code>
                    </li>
                  ))}
                  {changedFiles.length > 12 ? (
                    <li>
                      <span>{changedFiles.length - 12} more</span>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </section>

            <section className="pipeline-section">
              <h3>Pull Request</h3>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {prLifecycleState
                      ? prLifecycleLabels[prLifecycleState] ?? prLifecycleState
                      : prUrl
                        ? "Created"
                        : "Not created"}
                  </dd>
                </div>
                <div>
                  <dt>Checks</dt>
                  <dd>
                    {Object.keys(prCheckCounts).length > 0
                      ? `${getMetadataNumber(prCheckCounts, "passed") ?? 0} passed / ${
                          getMetadataNumber(prCheckCounts, "pending") ?? 0
                        } pending / ${getMetadataNumber(prCheckCounts, "failed") ?? 0} failed`
                      : "Not inspected"}
                  </dd>
                </div>
                <div>
                  <dt>Branch</dt>
                  <dd>
                    <code>{getMetadataString(pullRequestMetadata, "headBranch") ?? "Not recorded"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Commit</dt>
                  <dd>
                    <code>{getMetadataString(pullRequestMetadata, "commitSha") ?? "Not recorded"}</code>
                  </dd>
                </div>
                <div>
                  <dt>URL</dt>
                  <dd>
                    {prUrl && isWebUrl(prUrl) ? (
                      <a href={prUrl}>{prUrl}</a>
                    ) : (
                      <span>{prUrl ?? "Not recorded"}</span>
                    )}
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          {blockedReason ? (
            <div className="pipeline-alert">
              <strong>Latest attention item</strong>
              <p>{blockedReason}</p>
            </div>
          ) : null}

          {cleanupFailureEvent ? (
            <div className="pipeline-alert cleanup-alert">
              <strong>Local cleanup needed</strong>
              <p>{cleanupFailureError ?? cleanupFailureEvent.message}</p>
              <dl>
                <div>
                  <dt>Checkout</dt>
                  <dd>
                    <code>{cleanupFailureLocalPath ?? "Not recorded"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Base</dt>
                  <dd>
                    <code>{cleanupFailureBaseBranch ?? "Not recorded"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Generated Branch</dt>
                  <dd>
                    <code>{cleanupFailureHeadBranch ?? "Not recorded"}</code>
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}
        </section>

        <section className="panel detail-card">
          <h2>Timeline</h2>
          {events.length === 0 ? (
            <p className="empty compact-empty">No events have been recorded yet.</p>
          ) : (
            <ol className="timeline">
              {events.map((event) => (
                <li key={event.id}>
                  <div>
                    <strong>{formatEventType(event.eventType)}</strong>
                    <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
                  </div>
                  <p>{event.message}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
