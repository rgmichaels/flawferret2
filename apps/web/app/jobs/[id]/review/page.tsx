import type { JobResponse, QueueControlResponse } from "@flawferret2/job-schemas";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppShell } from "../../../app-shell";
import { parseDiscoverAcceptanceCriteria } from "../../review-request";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type ReviewPageParams = Promise<{
  id: string;
}>;

type ReviewPageSearchParams = Promise<{
  edit?: string;
}>;

const getJob = async (id: string): Promise<JobResponse | null> => {
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
};

const getQueueControl = async (): Promise<QueueControlResponse> => {
  try {
    const response = await fetch(`${apiUrl}/queue`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        paused: false,
        pausedAt: null,
        resumedAt: null,
        updatedAt: new Date().toISOString(),
      };
    }

    return response.json() as Promise<QueueControlResponse>;
  } catch {
    return {
      paused: false,
      pausedAt: null,
      resumedAt: null,
      updatedAt: new Date().toISOString(),
    };
  }
};

const getPayloadString = (payload: unknown, key: string) => {
  if (!payload || typeof payload !== "object" || !(key in payload)) {
    return "";
  }

  const value = (payload as Record<string, unknown>)[key];

  return typeof value === "string" ? value : "";
};

const getJobTitle = (job: JobResponse) =>
  getPayloadString(job.payload, "featureArea") || getPayloadString(job.payload, "goal") || "Untitled job";

const getJobGoal = (job: JobResponse) => getPayloadString(job.payload, "goal");

const getTargetBranch = (job: JobResponse) =>
  getPayloadString(job.payload, "targetBranch") || getPayloadString(job.payload, "branch") || "main";

const getAcceptanceCriteria = (job: JobResponse) => getPayloadString(job.payload, "acceptanceCriteria");

const getRepositoryName = (job: JobResponse) =>
  job.repository ? `${job.repository.owner}/${job.repository.name}` : "Unknown repository";

const priorities: JobResponse["priority"][] = ["LOW", "NORMAL", "HIGH", "URGENT"];

type ReviewConfidenceBadge = {
  detail: string;
  label: string;
  tone: "muted" | "ok" | "warn";
};

const reviewConfidenceBadges = ({
  discoverSummary,
  queueControl,
  tracker,
}: {
  discoverSummary: ReturnType<typeof parseDiscoverAcceptanceCriteria>;
  queueControl: QueueControlResponse;
  tracker: NonNullable<JobResponse["repository"]>["trackerIntegration"] | null;
}): ReviewConfidenceBadge[] => [
  {
    detail: discoverSummary ? "Structured request from Discover Tests." : "Manual or non-Discover request.",
    label: discoverSummary ? "AI generated" : "Manual request",
    tone: discoverSummary ? "ok" : "muted",
  },
  {
    detail: discoverSummary ? "Existing coverage was checked during Discover." : "No Discover coverage check recorded.",
    label: discoverSummary ? "Existing coverage checked" : "Coverage check unavailable",
    tone: discoverSummary ? "ok" : "muted",
  },
  {
    detail: tracker ? `Ticket can be created in ${tracker.projectKey} on approval.` : "No tracker attached to this repository.",
    label: tracker ? "Jira on approval" : "No Jira on approval",
    tone: tracker ? "ok" : "warn",
  },
  {
    detail: queueControl.paused ? "Approved work will wait until the queue resumes." : "Approved work can be picked up by the runner.",
    label: queueControl.paused ? "Queue paused" : "Queue active",
    tone: queueControl.paused ? "warn" : "ok",
  },
];

const buildJiraPreviewLines = (job: JobResponse) => {
  const goal = getJobGoal(job);

  return [
    "FlawFerret queued this automated test implementation request.",
    "",
    `- FlawFerret job: #${job.id.slice(0, 8)}`,
    `- Repository: ${getRepositoryName(job)}`,
    `- Target branch: ${getTargetBranch(job)}`,
    goal ? `- Goal: ${goal}` : null,
    "",
    "Acceptance criteria:",
    getAcceptanceCriteria(job),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
};

async function saveReviewRequest(formData: FormData) {
  "use server";

  const jobId = String(formData.get("jobId") ?? "");
  const response = await fetch(`${apiUrl}/jobs/${jobId}/review-request`, {
    body: JSON.stringify({
      priority: String(formData.get("priority") ?? "NORMAL"),
      payload: {
        acceptanceCriteria: String(formData.get("acceptanceCriteria") ?? ""),
        featureArea: String(formData.get("featureArea") ?? ""),
        goal: String(formData.get("goal") ?? ""),
        targetBranch: String(formData.get("targetBranch") ?? ""),
      },
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error("Unable to save review request.");
  }

  revalidatePath("/");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/review`);
  redirect(`/jobs/${jobId}/review?saved=${Date.now()}`);
}

async function approveReview(formData: FormData) {
  "use server";

  const jobId = String(formData.get("jobId") ?? "");
  const createJiraTicket = formData.get("createJiraTicket") === "on";

  const response = await fetch(`${apiUrl}/jobs/${jobId}/approve-review`, {
    body: JSON.stringify({
      createJiraTicket,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Unable to approve job for the queue.");
  }

  revalidatePath("/");
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}`);
}

async function cancelJob(formData: FormData) {
  "use server";

  const jobId = String(formData.get("jobId") ?? "");
  const response = await fetch(`${apiUrl}/jobs/${jobId}/cancel`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Unable to cancel job.");
  }

  revalidatePath("/");
  redirect(`/jobs/${jobId}`);
}

export default async function JobReviewPage({
  params,
  searchParams,
}: {
  params: ReviewPageParams;
  searchParams: ReviewPageSearchParams;
}) {
  const { id } = await params;
  const query = await searchParams;
  const [job, queueControl] = await Promise.all([getJob(id), getQueueControl()]);

  if (!job) {
    return (
      <AppShell active="jobs">
        <section className="workspace">
          <header className="topbar">
            <div>
              <p className="eyebrow">Job Review</p>
              <h1>Job not found</h1>
            </div>
            <a className="primary-link" href="/">
              Back to dashboard
            </a>
          </header>
          <section className="panel detail-empty">
            <p>The requested job does not exist or the API is unavailable.</p>
          </section>
        </section>
      </AppShell>
    );
  }

  const tracker = job.repository?.trackerIntegration ?? null;
  const createJiraByDefault = job.status === "NEEDS_REVIEW" && Boolean(tracker);
  const isEditing = job.status === "NEEDS_REVIEW" && query.edit === "true";
  const discoverSummary = parseDiscoverAcceptanceCriteria(getAcceptanceCriteria(job));
  const confidenceBadges = reviewConfidenceBadges({
    discoverSummary,
    queueControl,
    tracker,
  });

  return (
    <AppShell active="jobs">
      <section className="workspace review-shell">
        <header className="topbar review-topbar">
          <div>
            <p className="eyebrow">Job Review</p>
            <h1>{getJobTitle(job)}</h1>
            <p>{getJobGoal(job) || "Review this generated test request before it enters the active queue."}</p>
          </div>
          <div className="review-topbar-actions">
            <span className={`status-pill ${job.status.toLowerCase()}`}>
              {job.status === "NEEDS_REVIEW" ? "Needs Review" : job.status}
            </span>
            <a className="secondary-button compact-button" href={`/jobs/${job.id}`}>
              Job Detail
            </a>
          </div>
        </header>

        <dl className="review-meta">
          <div>
            <dt>Repository</dt>
            <dd>{getRepositoryName(job)}</dd>
          </div>
          <div>
            <dt>Branch</dt>
            <dd>{getTargetBranch(job)}</dd>
          </div>
          <div>
            <dt>Priority</dt>
            <dd>{job.priority}</dd>
          </div>
          <div>
            <dt>Job</dt>
            <dd>#{job.id.slice(0, 8)}</dd>
          </div>
        </dl>

        <section className="review-confidence-bar" aria-label="Review confidence">
          {confidenceBadges.map((badge) => (
            <div className={`review-confidence-badge ${badge.tone}`} key={badge.label}>
              <strong>{badge.label}</strong>
              <span>{badge.detail}</span>
            </div>
          ))}
        </section>

        <div className="review-workspace-grid">
          <section className="panel detail-card review-request-card">
            <div className="review-card-header">
              <div>
                <h2>{isEditing ? "Edit Request" : "Request"}</h2>
                <p>{isEditing ? "Adjust what the runner will receive before approval." : "This is the work request that will be queued for the runner."}</p>
              </div>
              {job.status === "NEEDS_REVIEW" ? (
                isEditing ? (
                  <a className="secondary-button compact-button" href={`/jobs/${job.id}/review`}>
                    Done
                  </a>
                ) : (
                  <a className="secondary-button compact-button" href={`/jobs/${job.id}/review?edit=true`}>
                    Edit
                  </a>
                )
              ) : null}
            </div>
            {isEditing ? (
              <form action={saveReviewRequest} className="review-request-form">
                <input name="jobId" type="hidden" value={job.id} />
                <div className="review-form-grid">
                  <label>
                    Feature Area
                    <input name="featureArea" required defaultValue={getJobTitle(job)} />
                  </label>
                  <label>
                    Target Branch
                    <input name="targetBranch" required defaultValue={getTargetBranch(job)} />
                  </label>
                  <label>
                    Priority
                    <select name="priority" required defaultValue={job.priority}>
                      {priorities.map((priority) => (
                        <option key={priority} value={priority}>
                          {priority}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Goal
                  <textarea name="goal" required rows={3} defaultValue={getJobGoal(job)} />
                </label>
                <label>
                  Acceptance Criteria
                  <textarea name="acceptanceCriteria" required rows={10} defaultValue={getAcceptanceCriteria(job)} />
                </label>
                <div className="review-actions">
                  <button className="secondary-button" type="submit">
                    Save Request
                  </button>
                  <button
                    className="secondary-button danger-button"
                    form="review-cancel-form"
                    type="submit"
                  >
                    Cancel Job
                  </button>
                </div>
              </form>
            ) : (
              <dl className="review-request-summary">
                <div>
                  <dt>Repository</dt>
                  <dd>{getRepositoryName(job)}</dd>
                </div>
                <div>
                  <dt>Goal</dt>
                  <dd>{getJobGoal(job)}</dd>
                </div>
                <div>
                  <dt>Target Branch</dt>
                  <dd>{getTargetBranch(job)}</dd>
                </div>
                <div>
                  <dt>Priority</dt>
                  <dd>{job.priority}</dd>
                </div>
                <div>
                  <dt>Acceptance Criteria</dt>
                  <dd>
                    {discoverSummary ? (
                      <div className="review-discovery-summary">
                        <section>
                          <h3>Discovery Source</h3>
                          <dl>
                            <div>
                              <dt>Source</dt>
                              <dd>{discoverSummary.source}</dd>
                            </div>
                            <div>
                              <dt>Page URL</dt>
                              <dd>
                                <a href={discoverSummary.pageUrl}>{discoverSummary.pageUrl}</a>
                              </dd>
                            </div>
                            <div>
                              <dt>Impact</dt>
                              <dd>{discoverSummary.impact || "Not specified"}</dd>
                            </div>
                            <div>
                              <dt>Tags</dt>
                              <dd>
                                {discoverSummary.tags.length > 0 ? (
                                  <span className="tag-row">
                                    {discoverSummary.tags.map((tag) => (
                                      <span key={tag}>{tag}</span>
                                    ))}
                                  </span>
                                ) : (
                                  "None"
                                )}
                              </dd>
                            </div>
                            {discoverSummary.notes ? (
                              <div>
                                <dt>Notes</dt>
                                <dd>{discoverSummary.notes}</dd>
                              </div>
                            ) : null}
                          </dl>
                        </section>
                        <section>
                          <h3>Suggested Scenario</h3>
                          <pre>{discoverSummary.scenario.join("\n")}</pre>
                        </section>
                        <section>
                          <h3>Why This Matters</h3>
                          <p>{discoverSummary.why}</p>
                        </section>
                        <section>
                          <h3>Implementation Guidance</h3>
                          <ul>
                            {discoverSummary.guidance.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </section>
                      </div>
                    ) : (
                      <div className="multiline-value review-text-block">{getAcceptanceCriteria(job)}</div>
                    )}
                  </dd>
                </div>
              </dl>
            )}
          </section>

          <aside className="review-side-rail">
            <section className="panel review-approval-panel">
              <div className="review-card-header">
                <div>
                  <h2>Approve</h2>
                  <p>Once approved, this job moves into the active queue for runner pickup.</p>
                </div>
              </div>
              {job.status === "NEEDS_REVIEW" ? (
                <form action={approveReview} className="approval-form">
                  <input name="jobId" type="hidden" value={job.id} />
                  {!isEditing ? (
                    <div className="review-edit-callout">
                      <div>
                        <strong>Edit before approving</strong>
                        <span>Adjust the goal, branch, priority, or acceptance criteria before this enters the queue.</span>
                      </div>
                      <a className="secondary-button compact-button" href={`/jobs/${job.id}/review?edit=true`}>
                        Edit Request
                      </a>
                    </div>
                  ) : null}
                  <label className="checkbox-filter">
                    <input
                      defaultChecked={createJiraByDefault}
                      disabled={!tracker}
                      name="createJiraTicket"
                      type="checkbox"
                    />
                    <span>Create Jira ticket on approval</span>
                  </label>
                  {!tracker ? (
                    <p className="queue-paused-note">
                      Attach a work tracker to this repository before approval if you want a Jira ticket.
                    </p>
                  ) : null}
                  <div className="review-actions">
                    <button type="submit">Approve and Queue</button>
                    <a className="secondary-button primary-link" href={`/jobs/${job.id}`}>
                      Back
                    </a>
                  </div>
                </form>
              ) : (
                <p className="empty compact-empty">This job is no longer waiting for review.</p>
              )}
              {job.status === "NEEDS_REVIEW" ? (
                <form action={cancelJob} className="review-cancel-form" id="review-cancel-form">
                  <input name="jobId" type="hidden" value={job.id} />
                </form>
              ) : null}
            </section>

            <section className="panel detail-card review-jira-card">
              <div className="review-card-header">
                <div>
                  <h2>Jira Preview</h2>
                  <p>{tracker ? "Created only when this request is approved with Jira enabled." : "Attach a tracker to this repository to create Jira on approval."}</p>
                </div>
              </div>
              <dl className="review-ticket-summary">
                <div>
                  <dt>Project</dt>
                  <dd>{tracker ? `${tracker.name} (${tracker.projectKey})` : "No tracker attached"}</dd>
                </div>
                <div>
                  <dt>Issue Type</dt>
                  <dd>{job.repository?.trackerIntegration ? "Configured on tracker" : "Not available"}</dd>
                </div>
                <div>
                  <dt>Summary</dt>
                  <dd>{getJobTitle(job)}</dd>
                </div>
                <div>
                  <dt>Description</dt>
                  <dd className="multiline-value review-text-block">{buildJiraPreviewLines(job)}</dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>
      </section>
    </AppShell>
  );
}
