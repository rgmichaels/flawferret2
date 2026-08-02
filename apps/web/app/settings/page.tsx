import { AppShell } from "../app-shell";
import type { RepositoryResponse, TrackerIntegrationResponse } from "@flawferret2/job-schemas";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type ReadinessSummary = {
  counts: {
    repositories: number;
    jobs: number;
  };
  queue: {
    paused: boolean;
  };
  runner: {
    healthText: string;
  };
};

const getRepositories = async (): Promise<RepositoryResponse[]> => {
  try {
    const response = await fetch(`${apiUrl}/repositories`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    return (await response.json()) as RepositoryResponse[];
  } catch {
    return [];
  }
};

const getTrackerIntegrations = async (): Promise<TrackerIntegrationResponse[]> => {
  try {
    const response = await fetch(`${apiUrl}/tracker-integrations`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    return (await response.json()) as TrackerIntegrationResponse[];
  } catch {
    return [];
  }
};

const getReadiness = async (): Promise<ReadinessSummary | null> => {
  try {
    const response = await fetch(`${apiUrl}/readiness`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as ReadinessSummary;
  } catch {
    return null;
  }
};

export default async function SettingsPage() {
  const [repositories, integrations, readiness] = await Promise.all([
    getRepositories(),
    getTrackerIntegrations(),
    getReadiness(),
  ]);
  const apiDocumentationUrl = `${apiUrl}/documentation`;
  const queueState = readiness ? (readiness.queue.paused ? "Paused" : "Active") : "Unknown";

  return (
    <AppShell active="settings">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Configuration</p>
            <h1>Settings</h1>
          </div>
        </header>

        <section className="settings-grid" aria-label="Configuration areas">
          <a className="settings-card" href="/repositories">
            <span>Repositories</span>
            <strong>{repositories.length}</strong>
            <p>Manage GitHub repositories, local checkout paths, default branches, and attached trackers.</p>
          </a>

          <a className="settings-card" href="/integrations">
            <span>Integrations</span>
            <strong>{integrations.length}</strong>
            <p>Configure Jira and future work trackers once, then attach them to repositories.</p>
          </a>

          <a className="settings-card" href="/readiness">
            <span>Readiness</span>
            <strong>{queueState}</strong>
            <p>{readiness?.runner.healthText ?? "Check API, queue, runner, validation, and PR readiness."}</p>
          </a>

          <a className="settings-card" href={apiDocumentationUrl}>
            <span>API Docs</span>
            <strong>Swagger</strong>
            <p>Open the generated API documentation for routes, tags, and the OpenAPI JSON contract.</p>
          </a>
        </section>

        <section className="panel settings-summary">
          <div className="panel-header">
            <div>
              <h2>Configuration Snapshot</h2>
              <p>Repo, tracker, and runner setup that affects queued work.</p>
            </div>
          </div>
          <dl>
            <div>
              <dt>Repositories</dt>
              <dd>{repositories.length}</dd>
            </div>
            <div>
              <dt>Work trackers</dt>
              <dd>{integrations.length}</dd>
            </div>
            <div>
              <dt>Queue</dt>
              <dd>{queueState}</dd>
            </div>
            <div>
              <dt>Tracked jobs</dt>
              <dd>{readiness?.counts.jobs ?? 0}</dd>
            </div>
            <div>
              <dt>API docs</dt>
              <dd>Available</dd>
            </div>
          </dl>
        </section>
      </section>
    </AppShell>
  );
}
