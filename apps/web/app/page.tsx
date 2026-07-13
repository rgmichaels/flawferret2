import type { JobResponse, JobStatus } from "@flawferret2/job-schemas";
import { revalidatePath } from "next/cache";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const statusLabels: Record<JobStatus, string> = {
  BLOCKED: "Blocked",
  CLAIMED: "Claimed",
  COMPLETED: "Completed",
  DRAFT: "Draft",
  FAILED: "Failed",
  QUEUED: "Queued",
  RETRY: "Retry",
  REVIEW: "Review",
  RUNNING: "Running",
  VALIDATING: "Validating",
};

async function getJobs(): Promise<JobResponse[]> {
  try {
    const response = await fetch(`${apiUrl}/jobs`, {
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

async function queueJob(formData: FormData) {
  "use server";

  const response = await fetch(`${apiUrl}/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jobType: "ADD_PLAYWRIGHT_TEST",
      priority: formData.get("priority"),
      payload: {
        repository: formData.get("repository"),
        branch: formData.get("branch"),
        featureArea: formData.get("featureArea"),
        goal: formData.get("goal"),
        acceptanceCriteria: formData.get("acceptanceCriteria"),
        runAffectedTests: formData.get("runAffectedTests") === "on",
        createDraftPr: formData.get("createDraftPr") === "on",
      },
    }),
  });

  if (!response.ok) {
    throw new Error("Unable to queue job.");
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

export default async function Home() {
  const jobs = await getJobs();
  const queuedCount = countByStatus(jobs, ["QUEUED"]);
  const runningCount = countByStatus(jobs, ["CLAIMED", "RUNNING", "VALIDATING"]);
  const reviewCount = countByStatus(jobs, ["REVIEW"]);
  const failedCount = countByStatus(jobs, ["FAILED", "BLOCKED", "RETRY"]);
  const completedCount = countByStatus(jobs, ["COMPLETED"]);

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="FlawFerret2 navigation">
        <div className="brand">
          <div className="brand-mark">F2</div>
          <div>
            <strong>FlawFerret 2</strong>
            <span>QA orchestration</span>
          </div>
        </div>

        <nav className="nav-section" aria-label="Main">
          <span>Main</span>
          <a className="nav-item active" href="/">
            Dashboard
          </a>
          <a className="nav-item" href="#jobs">
            Jobs
          </a>
          <a className="nav-item" href="#workers">
            Workers
          </a>
        </nav>

        <nav className="nav-section" aria-label="Create">
          <span>Create</span>
          <a className="nav-item" href="#new-job">
            New Job
          </a>
        </nav>

        <div className="system-card">
          <div>
            <span className="status-dot" />
            <strong>System Status</strong>
          </div>
          <p>API and Neon connected</p>
          <small>{jobs.length} jobs tracked</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Milestone 2.5</p>
            <h1>Dashboard</h1>
          </div>
          <a className="primary-link" href="#new-job">
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
            <span>Needs Review</span>
            <strong>{reviewCount}</strong>
            <small>Future PR review gate</small>
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

        <div className="content-grid">
          <section className="panel jobs-panel" id="jobs">
            <div className="panel-header">
              <div>
                <h2>Recent Jobs</h2>
                <p>Stored orchestration work from the job queue.</p>
              </div>
              <span>{jobs.length} total</span>
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
                      <th>Priority</th>
                      <th>Updated</th>
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
                          <strong>{job.payload.repository}</strong>
                          <span>{job.payload.branch}</span>
                        </td>
                        <td>
                          <span className={`status-pill ${job.status.toLowerCase()}`}>
                            {statusLabels[job.status]}
                          </span>
                        </td>
                        <td>{job.priority}</td>
                        <td>{formatRelativeTime(job.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel form-panel" id="new-job">
            <div className="panel-header compact">
              <div>
                <h2>Create New Job</h2>
                <p>Queue an Add Playwright Test request.</p>
              </div>
            </div>
            <form action={queueJob} className="job-form">
              <label>
                Test Suite Repository
                <input
                  name="repository"
                  placeholder="rgmichaels/playwright-tests"
                  required
                />
                <span className="field-hint">
                  GitHub owner/name for the repo FlawFerret2 should eventually modify.
                </span>
              </label>
              <label>
                Branch
                <input name="branch" defaultValue="main" required />
              </label>
              <label>
                Feature Area
                <input name="featureArea" placeholder="Login flow" required />
              </label>
              <label>
                Goal
                <textarea
                  name="goal"
                  placeholder="Verify login fails with an invalid password..."
                  required
                />
              </label>
              <label>
                Acceptance Criteria
                <textarea
                  name="acceptanceCriteria"
                  placeholder="The test should verify the error message..."
                  required
                />
              </label>
              <label>
                Priority
                <select name="priority" defaultValue="NORMAL">
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </label>
              <div className="toggles">
                <label>
                  <input name="runAffectedTests" type="checkbox" defaultChecked />
                  Run affected tests only
                </label>
                <label>
                  <input name="createDraftPr" type="checkbox" defaultChecked />
                  Create draft PR
                </label>
              </div>
              <button type="submit">Queue Job</button>
            </form>
          </section>
        </div>

        <section className="panel worker-strip" id="workers">
          <div>
            <h2>Worker Status</h2>
            <p>Milestone 2 workers claim queued jobs and simulate work.</p>
          </div>
          <div className="worker-summary">
            <span>{runningCount > 0 ? "Active" : "Idle"}</span>
            <strong>{runningCount}</strong>
            <small>jobs currently claimed or running</small>
          </div>
        </section>
      </section>
    </main>
  );
}
