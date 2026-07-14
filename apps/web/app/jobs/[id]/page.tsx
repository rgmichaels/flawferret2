import type { JobEventResponse, JobResponse } from "@flawferret2/job-schemas";

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

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [job, events] = await Promise.all([getJob(id), getJobEvents(id)]);

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
        <span className={`status-pill ${job.status.toLowerCase()}`}>{job.status}</span>
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
