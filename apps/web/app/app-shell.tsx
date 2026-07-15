import type { JobResponse, JobStatus, QueueControlResponse, RepositoryResponse } from "@flawferret2/job-schemas";
import { revalidatePath } from "next/cache";
import type { ReactNode } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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

async function getRepositories(): Promise<RepositoryResponse[]> {
  try {
    const response = await fetch(`${apiUrl}/repositories`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    return response.json() as Promise<RepositoryResponse[]>;
  } catch {
    return [];
  }
}

async function getQueueControl(): Promise<QueueControlResponse> {
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
}

async function pauseQueueAction() {
  "use server";

  const response = await fetch(`${apiUrl}/queue/pause`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Unable to pause queue.");
  }

  revalidatePath("/");
  revalidatePath("/jobs/new");
  revalidatePath("/repositories");
}

async function resumeQueueAction() {
  "use server";

  const response = await fetch(`${apiUrl}/queue/resume`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Unable to resume queue.");
  }

  revalidatePath("/");
  revalidatePath("/jobs/new");
  revalidatePath("/repositories");
}

const countByStatus = (jobs: JobResponse[], statuses: JobStatus[]) =>
  jobs.filter((job) => statuses.includes(job.status)).length;

const navClassName = (active: AppShellProps["active"], item: AppShellProps["active"]) =>
  active === item ? "nav-item active" : "nav-item";

type AppShellProps = {
  active: "dashboard" | "jobs" | "readiness" | "repositories" | "new-job";
  children: ReactNode;
};

export async function AppShell({ active, children }: AppShellProps) {
  const [jobs, repositories, queueControl] = await Promise.all([
    getJobs(),
    getRepositories(),
    getQueueControl(),
  ]);
  const runningCount = countByStatus(jobs, ["CLAIMED", "RUNNING", "VALIDATING"]);
  const runnerState = runningCount > 0 ? "Active" : "Idle";

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
          <a className={navClassName(active, "dashboard")} href="/">
            Dashboard
          </a>
          <a className={navClassName(active, "jobs")} href="/#jobs">
            Jobs
          </a>
          <a className={navClassName(active, "repositories")} href="/repositories">
            Repositories
          </a>
          <a className={navClassName(active, "readiness")} href="/readiness">
            Readiness
          </a>
        </nav>

        <nav className="nav-section" aria-label="Create">
          <span>Create</span>
          <a className={navClassName(active, "new-job")} href="/jobs/new">
            New Job
          </a>
        </nav>

        <div className="system-card">
          <div className="system-card-title">
            <span className="status-dot" />
            <strong>System Status</strong>
          </div>
          <dl className="system-status-list">
            <div>
              <dt>API / DB</dt>
              <dd className="positive">Connected</dd>
            </div>
            <div>
              <dt>ferret-runner</dt>
              <dd>{runnerState}</dd>
            </div>
            <div>
              <dt>Queue</dt>
              <dd className={queueControl.paused ? "warning" : "positive"}>
                {queueControl.paused ? "Paused" : "Active"}
              </dd>
            </div>
            <div>
              <dt>Active Jobs</dt>
              <dd>{runningCount}</dd>
            </div>
            <div>
              <dt>Tracked</dt>
              <dd>
                {jobs.length} jobs / {repositories.length} repos
              </dd>
            </div>
          </dl>
          <form
            action={queueControl.paused ? resumeQueueAction : pauseQueueAction}
            className="queue-control-form"
          >
            <button type="submit" className={queueControl.paused ? "resume-button" : "pause-button"}>
              {queueControl.paused ? "Resume Queue" : "Pause Queue"}
            </button>
          </form>
        </div>
      </aside>

      {children}
    </main>
  );
}
