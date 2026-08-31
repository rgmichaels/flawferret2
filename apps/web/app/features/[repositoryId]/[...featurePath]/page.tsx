import type {
  CucumberFeatureDetailResponse,
  LocalTestRunResponse,
  LocalTestRunStatsResponse,
  ReadinessResponse,
} from "@flawferret2/job-schemas";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppShell } from "../../../app-shell";
import { ScenarioExplainer } from "./scenario-explainer";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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

type LocalTestRunList = {
  runs: LocalTestRunResponse[];
  totalRuns: number;
};

async function getLocalTestRuns(repositoryId: string, featurePath: string): Promise<LocalTestRunList> {
  try {
    const params = new URLSearchParams({
      featurePath,
      limit: "3",
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

async function getLocalTestRunStats(
  repositoryId: string,
  featurePath: string,
): Promise<LocalTestRunStatsResponse | null> {
  try {
    const params = new URLSearchParams({
      featurePath,
    });
    const response = await fetch(`${apiUrl}/repositories/${repositoryId}/features/local-test-runs/stats?${params}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<LocalTestRunStatsResponse>;
  } catch {
    return null;
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

async function createLocalTestRun(formData: FormData) {
  "use server";

  const repositoryId = String(formData.get("repositoryId") ?? "");
  const featurePath = String(formData.get("featurePath") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/features");

  if (!repositoryId || !featurePath) {
    redirect(returnTo);
  }

  const response = await fetch(`${apiUrl}/repositories/${repositoryId}/features/local-test-runs`, {
    body: JSON.stringify({
      featurePath,
    }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  revalidatePath(returnTo);
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}${response.ok ? "localRunQueued=1" : "localRunError=1"}`);
}

const formatKind = (value: string) =>
  value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const repositoryLabel = (detail: CucumberFeatureDetailResponse) =>
  `${detail.repository.owner}/${detail.repository.name}`;

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

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

const formatDuration = (durationMs: number | null) => {
  if (durationMs === null) {
    return "No timing yet";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
};

const formatRate = (rate: number | null) => (rate === null ? "No data" : `${Math.round(rate * 100)}%`);

export default async function FeatureDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ featurePath: string[]; repositoryId: string }>;
  searchParams: Promise<{ localRunError?: string; localRunQueued?: string }>;
}) {
  const { featurePath, repositoryId } = await params;
  const { localRunError, localRunQueued } = await searchParams;
  const decodedFeaturePath = featurePath.map(decodeURIComponent).join("/");
  const detail = await getFeatureDetail(repositoryId, decodedFeaturePath);

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

  const [localTestRunList, localTestStats, readiness] = await Promise.all([
    getLocalTestRuns(detail.repository.id, detail.feature.path),
    getLocalTestRunStats(detail.repository.id, detail.feature.path),
    getReadiness(),
  ]);
  const localTestRuns = localTestRunList.runs;
  const detailHref = featurePath
    ? `/features/${detail.repository.id}/${detail.feature.path.split("/").map(encodeURIComponent).join("/")}`
    : "/features";
  const localTestRunsHref = `/local-test-runs?repositoryId=${encodeURIComponent(
    detail.repository.id,
  )}&featurePath=${encodeURIComponent(detail.feature.path)}`;

  return (
    <AppShell active="features">
      <section className="workspace">
        <a className="back-link" href={`/features?repositoryId=${detail.repository.id}`}>
          Back to features
        </a>

        <header className="topbar feature-detail-topbar">
          <div>
            <p className="eyebrow">{repositoryLabel(detail)}</p>
            <h1>{detail.feature.feature}</h1>
            <code>{detail.feature.path}</code>
          </div>
          <a className="primary-link" href="/jobs/new">
            Create Test
          </a>
        </header>

        <section className="panel local-test-run-panel">
          <div className="panel-header">
            <div>
              <h2>Local Test Runs</h2>
              <p>Showing the latest 3 local runs for this feature.</p>
            </div>
            <form action={createLocalTestRun} className="local-test-run-form">
              <input name="repositoryId" type="hidden" value={detail.repository.id} />
              <input name="featurePath" type="hidden" value={detail.feature.path} />
              <input name="returnTo" type="hidden" value={detailHref} />
              <button type="submit">Test Local</button>
            </form>
          </div>
          {localRunQueued === "1" ? <p className="local-test-run-confirmation">Local test run queued.</p> : null}
          {localRunError === "1" ? <p className="local-test-run-error">Unable to queue local test run.</p> : null}
          <div className="local-test-run-runner-hint">
            <strong>Runner</strong>
            <span>{readiness?.runner.healthText ?? "Runner status unavailable."}</span>
          </div>
          <dl className="local-test-run-stats">
            <div>
              <dt>Total Runs</dt>
              <dd>{localTestStats?.totalRuns ?? 0}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{localTestStats?.failedRuns ?? 0}</dd>
            </div>
            <div>
              <dt>Pass Rate</dt>
              <dd>{formatRate(localTestStats?.passRate ?? null)}</dd>
            </div>
            <div>
              <dt>Avg Time</dt>
              <dd>{formatDuration(localTestStats?.averageDurationMs ?? null)}</dd>
            </div>
          </dl>
          {localTestRuns.length > 0 ? (
            <>
              <ol className="local-test-run-list wide">
                {localTestRuns.map((run) => {
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
              <a className="local-test-run-history-link" href={localTestRunsHref}>
                View all {localTestRunList.totalRuns} runs
              </a>
            </>
          ) : (
            <p className="empty">No local test runs have been recorded yet.</p>
          )}
        </section>

        <div className="page-grid feature-detail-grid">
          <div className="feature-detail-main">
            <section className="panel feature-detail-panel">
              <div className="panel-header">
                <div>
                  <h2>Scenarios</h2>
                  <p>Parsed from the Cucumber feature file.</p>
                </div>
                <span>{detail.feature.scenarioCount} total</span>
              </div>
              {detail.feature.scenarios.length === 0 ? (
                <p className="empty">No scenarios found in this feature.</p>
              ) : (
                <ol className="scenario-list">
                  {detail.feature.scenarios.map((scenario) => (
                    <li key={`${scenario.line}-${scenario.name}`}>
                      <div className="scenario-list-header">
                        <div>
                          <strong>{scenario.name}</strong>
                          <span>
                            {scenario.keyword} on line {scenario.line}
                          </span>
                        </div>
                        <div className="scenario-badges">
                          {scenario.unmatchedStepCount > 0 ? (
                            <span className="unmatched-step-badge">
                              {scenario.unmatchedStepCount} unmatched
                            </span>
                          ) : (
                            <span className="matched-step-badge">All steps matched</span>
                          )}
                          {scenario.tags.length > 0 ? (
                            <div className="tag-row compact">
                              {scenario.tags.map((tag) => (
                                <span key={tag}>{tag}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <ScenarioExplainer
                        featurePath={detail.feature.path}
                        repositoryDefaultBranch={detail.repository.defaultBranch}
                        repositoryId={detail.repository.id}
                        scenarioName={scenario.name}
                        scenarioLine={scenario.line}
                      />
                      {scenario.steps.length > 0 ? (
                        <ol className="scenario-step-list">
                          {scenario.steps.map((step) => (
                            <li key={`${step.line}-${step.keyword}-${step.text}`}>
                              <div>
                                <span>{step.keyword}</span>
                                <strong>{step.text}</strong>
                              </div>
                              {step.matchedDefinition ? (
                                <code>
                                  {step.matchedDefinition.path}:{step.matchedDefinition.line}
                                </code>
                              ) : (
                                <em>Unmatched step definition</em>
                              )}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="scenario-empty">No steps parsed for this scenario.</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="panel feature-source-panel">
              <div className="panel-header">
                <div>
                  <h2>Feature Source</h2>
                  <p>{detail.localPath}</p>
                </div>
              </div>
              <pre>{detail.content}</pre>
            </section>
          </div>

          <section className="panel feature-detail-panel">
            <div className="panel-header">
              <div>
                <h2>Associated Files</h2>
                <p>Feature file plus likely step/support files.</p>
              </div>
              <span>{detail.associatedFiles.length} files</span>
            </div>
            <ul className="associated-file-list">
              {detail.associatedFiles.map((file) => (
                <li key={file.path}>
                  <span>{formatKind(file.kind)}</span>
                  <code>{file.path}</code>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
