import type {
  JobResponse,
  JobStatus,
  RepositoryResponse,
  RunStatus,
} from "@flawferret2/job-schemas";
import { revalidatePath } from "next/cache";
import { AppShell } from "./app-shell";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const statusLabels: Record<JobStatus, string> = {
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
  PR_CREATED: "PR Created",
  REVIEW: "Review",
  RUNNING: "Running",
  VALIDATING: "Validating",
};

const jobStatusOptions = Object.keys(statusLabels) as JobStatus[];

const runStatusLabels: Record<RunStatus, string> = {
  CODEX_RUNNING: "Codex",
  FAILED: "Failed",
  PR_CREATED: "PR Created",
  PUSHING: "Pushing",
  READY_FOR_CODEX: "Ready",
  STARTED: "Started",
  SUCCEEDED: "Succeeded",
  VALIDATING: "Validating",
};

const sortOptions = {
  status_asc: "Status A-Z",
  status_desc: "Status Z-A",
  updated_asc: "Updated oldest",
  updated_desc: "Updated newest",
} as const;

type JobSort = keyof typeof sortOptions;

async function getJobs(includeCanceled = false): Promise<JobResponse[]> {
  try {
    const jobsUrl = new URL(`${apiUrl}/jobs`);

    if (includeCanceled) {
      jobsUrl.searchParams.set("includeCanceled", "true");
    }

    const response = await fetch(jobsUrl, {
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    return response.json() as Promise<JobResponse[]>;
  } catch {
    return [];
  }
}

async function cancelJob(formData: FormData) {
  "use server";

  const jobId = String(formData.get("jobId") ?? "");
  const response = await fetch(`${apiUrl}/jobs/${jobId}/cancel`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Unable to remove job.");
  }

  revalidatePath("/");
}

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
}

const countByStatus = (jobs: JobResponse[], statuses: JobStatus[]) =>
  jobs.filter((job) => statuses.includes(job.status)).length;

const formatRelativeTime = (value: string) => {
  const date = new Date(value);
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  return `${days}d ago`;
};

const shortId = (id: string) => `#${id.slice(0, 8)}`;

const repositoryLabel = (repository: RepositoryResponse) =>
  `${repository.owner}/${repository.name}`;

const getJobRepositoryName = (job: JobResponse) => {
  if (job.repository) {
    return repositoryLabel(job.repository);
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

const getLatestRunLabel = (job: JobResponse) =>
  job.latestRun ? runStatusLabels[job.latestRun.status] : "No run";

const getRunnerStateLabel = (runningJobs: number) => (runningJobs > 0 ? "Active" : "Idle");

const getMetadataRecord = (metadata: unknown): Record<string, unknown> => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return metadata as Record<string, unknown>;
};

const getNestedMetadata = (metadata: unknown, key: string) =>
  getMetadataRecord(getMetadataRecord(metadata)[key]);

const getMetadataString = (metadata: unknown, key: string) => {
  const value = getMetadataRecord(metadata)[key];

  return typeof value === "string" && value.length > 0 ? value : null;
};

const isWebUrl = (value: string) => value.startsWith("https://") || value.startsWith("http://");

const getPullRequestUrl = (job: JobResponse) => {
  const pullRequestMetadata = getNestedMetadata(job.latestRun?.metadata, "pullRequest");
  const prUrl = getMetadataString(pullRequestMetadata, "prUrl");

  return prUrl && isWebUrl(prUrl) ? prUrl : null;
};

const stageLabels: Partial<Record<JobStatus, string>> = {
  BLOCKED: "Needs operator recovery",
  CODEX_APPROVED: "Codex approved; waiting for runner",
  COMPLETED: "Pipeline finished",
  PR_APPROVED: "Draft PR approved; waiting for runner",
  PR_CREATED: "Draft PR created; checks and merge pending",
  READY_FOR_CODEX: "Waiting for Codex approval",
  REVIEW: "Waiting for draft PR approval",
  RUNNING: "Codex or setup in progress",
  VALIDATING: "Validation in progress",
};

const getStageLabel = (job: JobResponse) =>
  stageLabels[job.status] ?? (job.latestRun ? runStatusLabels[job.latestRun.status] : "Setup pending");

const canCancelJob = (job: JobResponse) =>
  job.status === "DRAFT" || job.status === "QUEUED" || job.status === "RETRY";

const canApproveCodex = (job: JobResponse) => job.status === "READY_FOR_CODEX";

const canApprovePr = (job: JobResponse) => job.status === "REVIEW";

const getSelectedStatus = (value: string | undefined) =>
  jobStatusOptions.includes(value as JobStatus) ? (value as JobStatus) : "";

const getSelectedSort = (value: string | undefined): JobSort =>
  value && value in sortOptions ? (value as JobSort) : "updated_desc";

const sortJobs = (jobs: JobResponse[], sort: JobSort) => {
  const sortedJobs = [...jobs];

  sortedJobs.sort((left, right) => {
    if (sort === "status_asc" || sort === "status_desc") {
      const comparison = statusLabels[left.status].localeCompare(statusLabels[right.status]);

      return sort === "status_asc" ? comparison : -comparison;
    }

    const leftTime = new Date(left.updatedAt).getTime();
    const rightTime = new Date(right.updatedAt).getTime();

    return sort === "updated_asc" ? leftTime - rightTime : rightTime - leftTime;
  });

  return sortedJobs;
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ includeCanceled?: string; sort?: string; status?: string }>;
}) {
  const {
    includeCanceled: includeCanceledParam,
    sort: sortParam,
    status: statusParam,
  } = await searchParams;
  const selectedStatus = getSelectedStatus(statusParam);
  const selectedSort = getSelectedSort(sortParam);
  const includeCanceled = includeCanceledParam === "true" || selectedStatus === "CANCELED";
  const jobs = await getJobs(includeCanceled);
  const filteredJobs = sortJobs(
    selectedStatus ? jobs.filter((job) => job.status === selectedStatus) : jobs,
    selectedSort,
  );
  const queuedCount = countByStatus(jobs, ["QUEUED"]);
  const runningCount = countByStatus(jobs, ["CLAIMED", "RUNNING", "VALIDATING"]);
  const reviewCount = countByStatus(jobs, [
    "READY_FOR_CODEX",
    "CODEX_APPROVED",
    "REVIEW",
    "PR_APPROVED",
    "PR_CREATED",
  ]);
  const codexApprovalCount = countByStatus(jobs, ["READY_FOR_CODEX"]);
  const prApprovalCount = countByStatus(jobs, ["REVIEW"]);
  const prCreatedCount = countByStatus(jobs, ["PR_CREATED"]);
  const failedCount = countByStatus(jobs, ["FAILED", "BLOCKED", "RETRY"]);
  const completedCount = countByStatus(jobs, ["COMPLETED"]);

  return (
    <AppShell active="dashboard">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Milestone 3</p>
            <h1>Dashboard</h1>
          </div>
          <a className="primary-link" href="/jobs/new">
            New Job
          </a>
        </header>

        <section className="metric-grid" aria-label="Job status summary">
          <article className="metric-card queued">
            <span>Queued</span>
            <strong>{queuedCount}</strong>
            <small>Waiting for a worker</small>
          </article>
          <article className="metric-card running">
            <span>Running</span>
            <strong>{runningCount}</strong>
            <small>Claimed or in progress</small>
          </article>
          <article className="metric-card review">
            <span>Approval</span>
            <strong>{reviewCount}</strong>
            <small>
              {codexApprovalCount} Codex / {prApprovalCount} PR waiting / {prCreatedCount} PR open
            </small>
          </article>
          <article className="metric-card failed">
            <span>Failed</span>
            <strong>{failedCount}</strong>
            <small>Blocked, retry, or failed</small>
          </article>
          <article className="metric-card completed">
            <span>Completed</span>
            <strong>{completedCount}</strong>
            <small>Finished jobs</small>
          </article>
        </section>

        <section className="panel jobs-panel" id="jobs">
          <div className="panel-header">
            <div>
              <h2>Recent Jobs</h2>
              <p>Stored orchestration work from the job queue.</p>
            </div>
            <form action="/" className="job-filter-form">
              <label>
                <span>Status</span>
                <select defaultValue={selectedStatus} name="status">
                  <option value="">All statuses</option>
                  {jobStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Sort</span>
                <select defaultValue={selectedSort} name="sort">
                  {Object.entries(sortOptions).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-filter">
                <input
                  defaultChecked={includeCanceled}
                  name="includeCanceled"
                  type="checkbox"
                  value="true"
                />
                <span>Include canceled</span>
              </label>
              <button type="submit">Apply</button>
              <a className="filter-reset" href="/#jobs">
                Reset
              </a>
              <strong>
                {filteredJobs.length} of {jobs.length} shown
              </strong>
            </form>
          </div>

          {filteredJobs.length === 0 ? (
            <p className="empty">
              {jobs.length === 0 ? "No jobs have been queued yet." : "No jobs match this filter."}
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Repository</th>
                    <th>Status</th>
                    <th>Run</th>
                    <th>Priority</th>
                    <th>Updated</th>
                    <th>Artifact</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => {
                    const pullRequestUrl = getPullRequestUrl(job);

                    return (
                      <tr key={job.id}>
                        <td>
                          <a href={`/jobs/${job.id}`}>{shortId(job.id)}</a>
                          <span>{job.payload.featureArea}</span>
                        </td>
                        <td>
                          <strong>{getJobRepositoryName(job)}</strong>
                          <span>{getJobTargetBranch(job)}</span>
                        </td>
                        <td>
                          <span className={`status-pill ${job.status.toLowerCase()}`}>
                            {statusLabels[job.status]}
                          </span>
                          <span className="stage-note">{getStageLabel(job)}</span>
                        </td>
                        <td>
                          <span
                            className={`run-pill ${
                              job.latestRun ? job.latestRun.status.toLowerCase() : "none"
                            }`}
                          >
                            {getLatestRunLabel(job)}
                          </span>
                        </td>
                        <td>{job.priority}</td>
                        <td>{formatRelativeTime(job.updatedAt)}</td>
                        <td>
                          {pullRequestUrl ? (
                            <a className="artifact-link" href={pullRequestUrl}>
                              Open PR
                            </a>
                          ) : (
                            <span className="muted-action">No PR</span>
                          )}
                        </td>
                        <td>
                          {canApproveCodex(job) ? (
                            <form action={approveCodex} className="inline-job-action">
                              <input type="hidden" name="jobId" value={job.id} />
                              <button type="submit">Approve Codex</button>
                            </form>
                          ) : canApprovePr(job) ? (
                            <form action={approvePr} className="inline-job-action">
                              <input type="hidden" name="jobId" value={job.id} />
                              <button type="submit">Approve PR</button>
                            </form>
                          ) : canCancelJob(job) ? (
                            <form action={cancelJob} className="inline-job-action">
                              <input type="hidden" name="jobId" value={job.id} />
                              <button type="submit">Remove</button>
                            </form>
                          ) : (
                            <span className="muted-action">Locked</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </AppShell>
  );
}
