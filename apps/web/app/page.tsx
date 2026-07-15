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
  REVIEW: "Review",
  RUNNING: "Running",
  VALIDATING: "Validating",
};

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

const canCancelJob = (job: JobResponse) =>
  job.status === "DRAFT" || job.status === "QUEUED" || job.status === "RETRY";

const canApproveCodex = (job: JobResponse) => job.status === "READY_FOR_CODEX";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ includeCanceled?: string }>;
}) {
  const { includeCanceled: includeCanceledParam } = await searchParams;
  const includeCanceled = includeCanceledParam === "true";
  const jobs = await getJobs(includeCanceled);
  const queuedCount = countByStatus(jobs, ["QUEUED"]);
  const runningCount = countByStatus(jobs, ["CLAIMED", "RUNNING", "VALIDATING"]);
  const reviewCount = countByStatus(jobs, ["READY_FOR_CODEX", "CODEX_APPROVED", "REVIEW"]);
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
            <small>Ready, approved, or review</small>
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
            <div className="panel-actions">
              <a
                className={includeCanceled ? "filter-toggle active" : "filter-toggle"}
                href={includeCanceled ? "/" : "/?includeCanceled=true"}
              >
                {includeCanceled ? "Hide canceled" : "Show canceled"}
              </a>
              <span>{jobs.length} total</span>
            </div>
          </div>

          {jobs.length === 0 ? (
            <p className="empty">No jobs have been queued yet.</p>
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
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
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
                        {canApproveCodex(job) ? (
                          <form action={approveCodex} className="inline-job-action">
                            <input type="hidden" name="jobId" value={job.id} />
                            <button type="submit">Approve Codex</button>
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </AppShell>
  );
}
