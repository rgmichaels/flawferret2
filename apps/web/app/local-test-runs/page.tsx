import type { CucumberFeatureDetailResponse, LocalTestRunResponse } from "@flawferret2/job-schemas";
import { AppShell } from "../app-shell";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const pageSize = 25;

type LocalTestRunList = {
  runs: LocalTestRunResponse[];
  totalRuns: number;
};

async function getFeatureDetail(
  repositoryId: string,
  featurePath: string,
): Promise<CucumberFeatureDetailResponse | null> {
  try {
    const response = await fetch(
      `${apiUrl}/repositories/${repositoryId}/features/detail?path=${encodeURIComponent(featurePath)}`,
      {
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<CucumberFeatureDetailResponse>;
  } catch {
    return null;
  }
}

async function getLocalTestRuns(repositoryId: string, featurePath: string, page: number): Promise<LocalTestRunList> {
  try {
    const params = new URLSearchParams({
      featurePath,
      limit: String(pageSize),
      page: String(page),
    });
    const response = await fetch(`${apiUrl}/repositories/${repositoryId}/features/local-test-runs?${params}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return { runs: [], totalRuns: 0 };
    }

    const runs = (await response.json()) as LocalTestRunResponse[];

    return {
      runs,
      totalRuns: Number(response.headers.get("x-total-count") ?? runs.length),
    };
  } catch {
    return { runs: [], totalRuns: 0 };
  }
}

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const formatDuration = (durationMs: number | null) => {
  if (durationMs === null) {
    return "No timing yet";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
};

const formatLocalRunStatus = (status: LocalTestRunResponse["status"]) =>
  status.charAt(0) + status.slice(1).toLowerCase();

const localRunLabel = (
  run: LocalTestRunResponse,
  scenarios: CucumberFeatureDetailResponse["feature"]["scenarios"],
) => {
  if (run.scope !== "SCENARIO" || !run.scenarioLine) {
    return {
      meta: "All scenarios",
      title: "Feature",
    };
  }

  const scenario = scenarios.find((candidate) => candidate.line === run.scenarioLine);

  return {
    meta: `Line ${run.scenarioLine}`,
    title: scenario?.name ?? `Scenario on line ${run.scenarioLine}`,
  };
};

const featureDetailHref = (repositoryId: string, featurePath: string) =>
  `/features/${repositoryId}/${featurePath.split("/").map(encodeURIComponent).join("/")}`;

const historyHref = (repositoryId: string, featurePath: string, page: number) =>
  `/local-test-runs?repositoryId=${encodeURIComponent(repositoryId)}&featurePath=${encodeURIComponent(
    featurePath,
  )}&page=${page}`;

export default async function LocalTestRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ featurePath?: string; page?: string; repositoryId?: string }>;
}) {
  const { featurePath = "", page: pageValue = "1", repositoryId = "" } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageValue, 10) || 1);

  if (!repositoryId || !featurePath) {
    return (
      <AppShell active="features">
        <section className="workspace">
          <a className="back-link" href="/features">
            Back to features
          </a>
          <section className="panel detail-empty">
            <h1>Local test runs</h1>
            <p>Select a feature to view its local run history.</p>
          </section>
        </section>
      </AppShell>
    );
  }

  const [detail, runList] = await Promise.all([
    getFeatureDetail(repositoryId, featurePath),
    getLocalTestRuns(repositoryId, featurePath, page),
  ]);

  if (!detail) {
    return (
      <AppShell active="features">
        <section className="workspace">
          <a className="back-link" href="/features">
            Back to features
          </a>
          <section className="panel detail-empty">
            <h1>Feature not found</h1>
            <p>The requested feature file could not be read from the registered checkout.</p>
          </section>
        </section>
      </AppShell>
    );
  }

  const totalPages = Math.max(1, Math.ceil(runList.totalRuns / pageSize));
  const safePage = Math.min(page, totalPages);

  return (
    <AppShell active="features">
      <section className="workspace">
        <a className="back-link" href={featureDetailHref(repositoryId, featurePath)}>
          Back to feature
        </a>

        <header className="topbar local-test-history-topbar">
          <div>
            <p className="eyebrow">Local Test History</p>
            <h1>{detail.feature.feature}</h1>
            <p>
              {detail.repository.owner}/{detail.repository.name} / {detail.feature.path}
            </p>
          </div>
          <span>{runList.totalRuns} total</span>
        </header>

        <section className="panel local-test-run-panel">
          {runList.runs.length > 0 ? (
            <>
              <ol className="local-test-run-list wide">
                {runList.runs.map((run) => {
                  const label = localRunLabel(run, detail.feature.scenarios);

                  return (
                    <li key={run.id}>
                      <div>
                        <span className={`local-test-run-status ${run.status.toLowerCase()}`}>
                          {formatLocalRunStatus(run.status)}
                        </span>
                        <span className="local-test-run-name">
                          <strong>{label.title}</strong>
                          <small>{label.meta}</small>
                        </span>
                      </div>
                      <span>{run.exitCode === null ? "Exit pending" : `Exit ${run.exitCode}`}</span>
                      <span>
                        {formatDuration(run.durationMs)} / {formatDate(run.updatedAt)}
                      </span>
                      <a className="compact-output-link" href={`/local-test-runs/${run.id}/output`}>
                        View Output
                      </a>
                    </li>
                  );
                })}
              </ol>
              <nav className="pagination-bar" aria-label="Local test run pagination">
                <span>
                  Page {safePage} of {totalPages}
                </span>
                <div>
                  {safePage > 1 ? (
                    <a className="secondary-button" href={historyHref(repositoryId, featurePath, safePage - 1)}>
                      Previous
                    </a>
                  ) : (
                    <span className="pagination-disabled">Previous</span>
                  )}
                  {safePage < totalPages ? (
                    <a className="secondary-button" href={historyHref(repositoryId, featurePath, safePage + 1)}>
                      Next
                    </a>
                  ) : (
                    <span className="pagination-disabled">Next</span>
                  )}
                </div>
              </nav>
            </>
          ) : (
            <p className="empty">No local test runs have been recorded yet.</p>
          )}
        </section>
      </section>
    </AppShell>
  );
}
