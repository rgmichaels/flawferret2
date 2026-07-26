import type {
  DiscoverCoverageDecision,
  DiscoverRunResponse,
  DiscoverTestRecommendation,
} from "@flawferret2/job-schemas";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "../../app-shell";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type DiscoverRunPageParams = Promise<{
  id: string;
}>;

type DiscoverRunPageSearchParams = Promise<{
  queued?: string;
}>;

const getDiscoverRun = async (runId: string): Promise<DiscoverRunResponse | null> => {
  try {
    const response = await fetch(`${apiUrl}/discover/runs/${runId}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<DiscoverRunResponse>;
  } catch {
    return null;
  }
};

const markDiscoverRunQueued = async (runId: string, queuedTitles: string[]) => {
  if (queuedTitles.length === 0) {
    return;
  }

  const response = await fetch(`${apiUrl}/discover/runs/${runId}/queued`, {
    body: JSON.stringify({ queuedTitles }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error("Unable to mark discovery recommendations as queued.");
  }
};

async function deleteDiscoverRun(formData: FormData) {
  "use server";

  const runId = String(formData.get("runId") ?? "");

  if (!runId) {
    redirect("/discover");
  }

  const response = await fetch(`${apiUrl}/discover/runs/${runId}`, {
    cache: "no-store",
    method: "DELETE",
  });

  if (!response.ok && response.status !== 404) {
    throw new Error("Unable to delete discovery run.");
  }

  revalidatePath("/discover");
  revalidatePath(`/discover/${runId}`);
  redirect("/discover?deleted=1");
}

const repositoryLabel = (run: DiscoverRunResponse) => `${run.repository.owner}/${run.repository.name}`;

const formatRunDate = (value: string) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const formatCoveragePercent = (score: number) => `${Math.round(score * 100)}%`;

const coverageDecisionText = (decision: DiscoverCoverageDecision) =>
  decision.matchedCoverage
    ? `${decision.reason} Match: ${decision.matchedCoverage.feature} > ${decision.matchedCoverage.scenario}.`
    : decision.reason;

const buildAcceptanceCriteria = ({
  notes,
  pageUrl,
  recommendation,
}: {
  notes: string;
  pageUrl: string;
  recommendation: DiscoverTestRecommendation;
}) =>
  [
    "Source: Page discovery recommendation",
    `Page URL: ${pageUrl}`,
    `Impact: ${recommendation.impact}`,
    `Tags: ${recommendation.tags.join(" ")}`,
    notes.trim() ? `Discovery notes: ${notes.trim()}` : null,
    "",
    "Suggested scenario:",
    ...recommendation.scenario,
    "",
    "Why this matters:",
    recommendation.reason,
    "",
    "Implementation guidance:",
    ...recommendation.acceptance.map((item) => `- ${item}`),
    "- Add or update Cucumber feature coverage.",
    "- Reuse existing page objects and step definitions where sensible.",
    "- Keep the scenario focused on one behavior.",
    "- Run affected tests.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

async function queueSelectedTests(formData: FormData) {
  "use server";

  const runId = String(formData.get("runId") ?? "");
  const repositoryId = String(formData.get("repositoryId") ?? "");
  const targetBranch = String(formData.get("targetBranch") ?? "main");
  const pageUrl = String(formData.get("pageUrl") ?? "");
  const notes = String(formData.get("notes") ?? "");
  const recommendations = formData
    .getAll("recommendation")
    .map((value) => JSON.parse(String(value)) as DiscoverTestRecommendation);

  if (recommendations.length === 0) {
    redirect(`/discover/${runId}?queued=0`);
  }

  await Promise.all(
    recommendations.map(async (recommendation) => {
      const response = await fetch(`${apiUrl}/jobs`, {
        body: JSON.stringify({
          jobType: "ADD_PLAYWRIGHT_TEST",
          priority: recommendation.impact === "High" ? "HIGH" : "NORMAL",
          payload: {
            acceptanceCriteria: buildAcceptanceCriteria({
              notes,
              pageUrl,
              recommendation,
            }),
            createDraftPr: true,
            featureArea: recommendation.title,
            goal: `Implement page-discovery test coverage: ${recommendation.title}.`,
            repositoryId,
            runAffectedTests: true,
            targetBranch,
          },
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Unable to queue one or more selected tests.");
      }
    }),
  );

  await markDiscoverRunQueued(
    runId,
    recommendations.map((recommendation) => recommendation.title),
  );

  revalidatePath("/");
  revalidatePath("/discover");
  revalidatePath(`/discover/${runId}`);
  redirect(`/discover/${runId}?queued=${recommendations.length}`);
}

const RecommendationList = ({
  decisions,
  hidden = false,
  queuedTitleSet,
}: {
  decisions: DiscoverCoverageDecision[];
  hidden?: boolean;
  queuedTitleSet: Set<string>;
}) => (
  <ol className={`recommendation-list${hidden ? " hidden" : ""}`}>
    {decisions.map((decision) => {
      const isQueued = queuedTitleSet.has(decision.recommendation.title);

      return (
        <li key={decision.recommendation.title}>
          <label className="recommendation-check">
            <input
              disabled={isQueued}
              name="recommendation"
              type="checkbox"
              value={JSON.stringify(decision.recommendation)}
            />
            <span>{isQueued ? "Already Queued" : hidden ? "Implement Anyway" : "Implement Test"}</span>
          </label>
          <div className="recommendation-copy">
            <div>
              <h3>{decision.recommendation.title}</h3>
              <span className={`impact-pill ${decision.recommendation.impact.toLowerCase()}`}>
                {decision.recommendation.impact} impact
              </span>
              {isQueued ? <span className="queued-pill">Queued</span> : null}
            </div>
            <p>{decision.recommendation.reason}</p>
            <p className={`coverage-decision-note${hidden ? " duplicate" : ""}`}>
              {hidden
                ? `Hidden because ${coverageDecisionText(decision)} Similarity: ${formatCoveragePercent(decision.score)}.`
                : coverageDecisionText(decision)}
            </p>
            {hidden && decision.matchedCoverage ? <code className="coverage-match-path">{decision.matchedCoverage.path}</code> : null}
            <pre>{decision.recommendation.scenario.join("\n")}</pre>
            <div className="tag-row compact">
              {decision.recommendation.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        </li>
      );
    })}
  </ol>
);

export default async function DiscoverRunPage({
  params,
  searchParams,
}: {
  params: DiscoverRunPageParams;
  searchParams: DiscoverRunPageSearchParams;
}) {
  const [{ id }, { queued }] = await Promise.all([params, searchParams]);
  const run = await getDiscoverRun(id);

  if (!run) {
    notFound();
  }

  const queuedCount = Number.parseInt(queued ?? "", 10);
  const queuedTitleSet = new Set(run.queuedTitles);

  return (
    <AppShell active="discover">
      <section className="workspace discover-run-shell">
        <header className="topbar discover-run-topbar">
          <div>
            <p className="eyebrow">Discovery Artifact</p>
            <h1>{run.pageUrl}</h1>
            <p>
              Saved {formatRunDate(run.createdAt)} for {repositoryLabel(run)} on {run.targetBranch}.
            </p>
          </div>
          <div className="topbar-actions">
            <a className="secondary-button compact-button" href={`/discover?runId=${run.id}`}>
              Open in Discover
            </a>
            <form action={deleteDiscoverRun}>
              <input name="runId" type="hidden" value={run.id} />
              <button className="danger-button compact-button" type="submit">
                Delete
              </button>
            </form>
            <a className="primary-link" href="/discover">
              Discover Tests
            </a>
          </div>
        </header>

        {Number.isFinite(queuedCount) ? (
          queuedCount > 0 ? (
            <p className="queue-success-note">
              {queuedCount} {queuedCount === 1 ? "test was" : "tests were"} added to the queue.
            </p>
          ) : (
            <p className="queue-paused-note">Select at least one recommended test before queueing.</p>
          )
        ) : null}

        <section className="discover-run-summary-grid">
          <article className="panel discover-run-summary-card">
            <span>Provider</span>
            <strong>{run.provider}</strong>
          </article>
          <article className="panel discover-run-summary-card">
            <span>Visible</span>
            <strong>{run.visibleDecisions.length}</strong>
          </article>
          <article className="panel discover-run-summary-card">
            <span>Hidden</span>
            <strong>{run.hiddenDecisions.length}</strong>
          </article>
          <article className="panel discover-run-summary-card">
            <span>Queued</span>
            <strong>{run.queuedTitles.length}</strong>
          </article>
        </section>

        <section className="panel discover-run-request-card">
          <div className="panel-header">
            <div>
              <h2>Original Request</h2>
              <p>Inputs captured when this analysis was generated.</p>
            </div>
          </div>
          <dl className="discover-run-request-list">
            <div>
              <dt>Repository</dt>
              <dd>{repositoryLabel(run)}</dd>
            </div>
            <div>
              <dt>Target branch</dt>
              <dd>{run.targetBranch}</dd>
            </div>
            <div>
              <dt>Page URL</dt>
              <dd>{run.pageUrl}</dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd>{run.notes.trim() || "No notes supplied."}</dd>
            </div>
          </dl>
        </section>

        {run.relatedCoverage.length > 0 ? (
          <section className="panel existing-coverage-panel">
            <div className="panel-header">
              <div>
                <h2>Related Existing Tests</h2>
                <p>
                  {run.relatedCoverage.length} nearby Cucumber{" "}
                  {run.relatedCoverage.length === 1 ? "scenario was" : "scenarios were"} used to avoid duplicate
                  recommendations.
                </p>
              </div>
            </div>
            <ol className="existing-coverage-list">
              {run.relatedCoverage.map((coverage) => (
                <li key={`${coverage.path}:${coverage.scenario}`}>
                  <div>
                    <strong>{coverage.scenario}</strong>
                    <span>{coverage.feature}</span>
                  </div>
                  <code>{coverage.path}</code>
                  {coverage.tags.length > 0 ? (
                    <div className="tag-row compact">
                      {coverage.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <form action={queueSelectedTests} className="panel recommendation-panel">
          <div className="panel-header">
            <div>
              <h2>Recommended Tests</h2>
              <p>Queue saved recommendations from this analysis without regenerating it.</p>
            </div>
            <button type="submit">Queue Selected</button>
          </div>
          <input name="runId" type="hidden" value={run.id} />
          <input name="repositoryId" type="hidden" value={run.repositoryId} />
          <input name="targetBranch" type="hidden" value={run.targetBranch} />
          <input name="pageUrl" type="hidden" value={run.pageUrl} />
          <input name="notes" type="hidden" value={run.notes} />
          {run.visibleDecisions.length > 0 ? (
            <RecommendationList decisions={run.visibleDecisions} queuedTitleSet={queuedTitleSet} />
          ) : (
            <p className="queue-paused-note recommendation-source-note">
              Every generated recommendation looked similar to existing Cucumber coverage.
            </p>
          )}
          {run.hiddenDecisions.length > 0 ? (
            <details className="hidden-recommendations">
              <summary>
                Show {run.hiddenDecisions.length} hidden duplicate-looking{" "}
                {run.hiddenDecisions.length === 1 ? "suggestion" : "suggestions"}
              </summary>
              <RecommendationList decisions={run.hiddenDecisions} hidden queuedTitleSet={queuedTitleSet} />
            </details>
          ) : null}
        </form>
      </section>
    </AppShell>
  );
}
