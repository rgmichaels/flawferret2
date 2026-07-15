import type {
  JobEventResponse,
  JobResponse,
  JobStatus,
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
  QUEUED: "Queued",
  READY_FOR_CODEX: "Ready for Codex",
  RETRY: "Retry",
  PR_APPROVED: "PR Approved",
  REVIEW: "Review",
  RUNNING: "Running",
  VALIDATING: "Validating",
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

async function retryCurrentStage(formData: FormData) {
  "use server";

  const jobId = String(formData.get("jobId") ?? "");
  const response = await fetch(`${apiUrl}/jobs/${jobId}/retry-stage`, {
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

const getLastEventMessage = (events: JobEventResponse[], eventTypes: string[]) => {
  const event = [...events].reverse().find((item) => eventTypes.includes(item.eventType));

  return event?.message ?? null;
};

const isWebUrl = (value: string) => value.startsWith("https://") || value.startsWith("http://");

const canRequeueJob = (status: JobStatus) =>
  status === "BLOCKED" || status === "FAILED" || status === "RETRY";

const canRetryCurrentStage = (job: JobResponse, latestRun: RunResponse | null) =>
  Boolean(latestRun) &&
  (job.status === "BLOCKED" ||
    job.status === "FAILED" ||
    job.status === "RETRY" ||
    job.status === "REVIEW" ||
    job.status === "PR_APPROVED");

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [job, events, runs] = await Promise.all([
    getJob(id),
    getJobEvents(id),
    getJobRuns(id),
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
  const pullRequestMetadata = getNestedMetadata(latestMetadata, "pullRequest");
  const changedFiles = getMetadataStrings(validationMetadata, "changedFiles");
  const blockedReason = getLastEventMessage(events, [
    "JOB_BLOCKED",
    "CODEX_INVOCATION_FAILED",
    "VALIDATION_FAILED",
    "PR_CREATION_FAILED",
  ]);
  const prUrl = getMetadataString(pullRequestMetadata, "prUrl");

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
          {job.status === "READY_FOR_CODEX" ? (
            <form action={approveCodex}>
              <input type="hidden" name="jobId" value={job.id} />
              <button type="submit">Approve Codex</button>
            </form>
          ) : null}
          {job.status === "REVIEW" ? (
            <form action={approvePr}>
              <input type="hidden" name="jobId" value={job.id} />
              <button type="submit">Approve Draft PR</button>
            </form>
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
          <span className={`status-pill ${job.status.toLowerCase()}`}>
            {jobStatusLabels[job.status]}
          </span>
        </div>
      </header>

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
            <div>
              <dt>Acceptance Criteria</dt>
              <dd>{job.payload.acceptanceCriteria}</dd>
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
                  <dd>{getMetadataString(validationMetadata, "command") ?? "Change detection only"}</dd>
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
                  <dd>{prUrl ? "Created" : "Not created"}</dd>
                </div>
                <div>
                  <dt>Branch</dt>
                  <dd>
                    <code>{getMetadataString(pullRequestMetadata, "headBranch") ?? "Not recorded"}</code>
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
