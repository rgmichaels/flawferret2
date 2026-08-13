import type {
  CucumberFeatureCatalogResponse,
  CreateDiscoverRunRequest,
  DiscoverExistingCoverage,
  DiscoverRunResponse,
  DiscoverTestRecommendationsResponse,
  RepositoryResponse,
} from "@flawferret2/job-schemas";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AppShell } from "../app-shell";
import { AnalyzeSubmitButton } from "./analyze-submit-button";
import { classifyRecommendationsByCoverage, summarizeRelatedCoverage } from "./coverage-matching";
import { buildRecommendations, toPageLabel } from "./local-recommendations";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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

async function getFeatureCatalog(repositoryId: string): Promise<CucumberFeatureCatalogResponse | null> {
  if (!repositoryId) {
    return null;
  }

  try {
    const response = await fetch(`${apiUrl}/repositories/${repositoryId}/features`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<CucumberFeatureCatalogResponse>;
  } catch {
    return null;
  }
}

async function getAiRecommendations({
  existingCoverage,
  notes,
  pageUrl,
}: {
  existingCoverage: DiscoverExistingCoverage[];
  notes: string;
  pageUrl: string;
}): Promise<DiscoverTestRecommendationsResponse | null> {
  if (!pageUrl) {
    return null;
  }

  try {
    const response = await fetch(`${apiUrl}/discover/recommendations`, {
      body: JSON.stringify({
        existingCoverage,
        maxRecommendations: 14,
        notes,
        pageUrl,
      }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<DiscoverTestRecommendationsResponse>;
  } catch {
    return null;
  }
}

async function getDiscoverRuns(): Promise<DiscoverRunResponse[]> {
  try {
    const response = await fetch(`${apiUrl}/discover/runs`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    return response.json() as Promise<DiscoverRunResponse[]>;
  } catch {
    return [];
  }
}

async function createDiscoverRun(input: CreateDiscoverRunRequest): Promise<DiscoverRunResponse> {
  const response = await fetch(`${apiUrl}/discover/runs`, {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Unable to save discovery run.");
  }

  return response.json() as Promise<DiscoverRunResponse>;
}

async function deleteDiscoverRun(formData: FormData) {
  "use server";

  const discoverRunId = String(formData.get("discoverRunId") ?? "");

  if (!discoverRunId) {
    redirect("/discover");
  }

  const response = await fetch(`${apiUrl}/discover/runs/${discoverRunId}`, {
    cache: "no-store",
    method: "DELETE",
  });

  if (!response.ok && response.status !== 404) {
    throw new Error("Unable to delete discovery run.");
  }

  revalidatePath("/discover");
  redirect("/discover?deleted=1");
}

const repositoryLabel = (repository: RepositoryResponse) => `${repository.owner}/${repository.name}`;

const repositoryTrackerLabel = (repository: RepositoryResponse) =>
  repository.trackerIntegration
    ? `Jira ${repository.trackerIntegration.projectKey}`
    : "No tracker";

const formatRunDate = (value: string) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const getSelectedPage = (value: string | undefined) => {
  const page = Number(value);

  return Number.isInteger(page) && page > 0 ? page : 1;
};

const getSelectedPageSize = (value: string | undefined) => {
  const pageSize = Number(value);

  return [5, 10, 25].includes(pageSize) ? pageSize : 5;
};

const buildDiscoverHref = ({
  deleted,
  page,
  pageSize,
  repositoryId,
}: {
  deleted?: string;
  page: number;
  pageSize: number;
  repositoryId: string;
}) => {
  const params = new URLSearchParams();

  if (repositoryId) {
    params.set("repositoryId", repositoryId);
  }
  if (deleted === "1") {
    params.set("deleted", "1");
  }
  if (page !== 1) {
    params.set("page", String(page));
  }
  if (pageSize !== 5) {
    params.set("pageSize", String(pageSize));
  }

  const query = params.toString();

  return query ? `/discover?${query}` : "/discover";
};

const buildDiscoverAnalysis = async ({
  notes,
  pageUrl,
  repositoryId,
}: {
  notes: string;
  pageUrl: string;
  repositoryId: string;
}) => {
  const featureCatalog = await getFeatureCatalog(repositoryId);
  const pageLabel = toPageLabel(pageUrl);
  const existingCoverage = summarizeRelatedCoverage({
    catalog: featureCatalog,
    notes,
    pageLabel,
    pageUrl,
  });
  const rawLocalRecommendations = buildRecommendations({
    notes,
    pageUrl,
  });
  const localCoverageDecisions = classifyRecommendationsByCoverage({
    existingCoverage,
    recommendations: rawLocalRecommendations,
  });
  const aiRecommendations = await getAiRecommendations({
    existingCoverage,
    notes,
    pageUrl,
  });
  const aiCoverageDecisions =
    aiRecommendations?.provider === "openai"
      ? classifyRecommendationsByCoverage({
          existingCoverage,
          recommendations: aiRecommendations.recommendations,
        })
      : [];
  const usingAiRecommendations = aiRecommendations?.provider === "openai" && aiRecommendations.recommendations.length > 0;
  const coverageDecisions = usingAiRecommendations ? aiCoverageDecisions : localCoverageDecisions;

  return {
    hiddenDecisions: coverageDecisions.filter((decision) => decision.status === "hide"),
    provider: usingAiRecommendations ? "AI gap analysis" : "local gap analysis",
    relatedCoverage: existingCoverage,
    visibleDecisions: coverageDecisions.filter((decision) => decision.status === "keep"),
  };
};

async function analyzePage(formData: FormData) {
  "use server";

  const repositoryId = String(formData.get("repositoryId") ?? "");
  const targetBranch = String(formData.get("targetBranch") ?? "main");
  const pageUrl = String(formData.get("pageUrl") ?? "");
  const notes = String(formData.get("notes") ?? "");
  const analysis = await buildDiscoverAnalysis({
    notes,
    pageUrl,
    repositoryId,
  });
  const run = await createDiscoverRun({
    hiddenDecisions: analysis.hiddenDecisions,
    notes,
    pageUrl,
    provider: analysis.provider,
    relatedCoverage: analysis.relatedCoverage,
    repositoryId,
    targetBranch,
    visibleDecisions: analysis.visibleDecisions,
  });

  revalidatePath("/discover");
  redirect(`/discover/${run.id}`);
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{
    notes?: string;
    page?: string;
    pageSize?: string;
    pageUrl?: string;
    repositoryId?: string;
    deleted?: string;
    targetBranch?: string;
  }>;
}) {
  const query = await searchParams;
  const { deleted, notes = "", page: pageParam, pageSize: pageSizeParam, pageUrl = "", repositoryId = "", targetBranch = "main" } = query;
  const selectedPage = getSelectedPage(pageParam);
  const selectedPageSize = getSelectedPageSize(pageSizeParam);
  const [repositories, allRecentRuns] = await Promise.all([getRepositories(), getDiscoverRuns()]);
  const selectedRepository = repositories.find((repository) => repository.id === repositoryId) ?? null;
  const selectedRepositoryId = selectedRepository?.id || "";
  const selectedBranch = targetBranch || selectedRepository?.defaultBranch || "main";
  const analyzePageUrl = pageUrl || selectedRepository?.baseUrl || "";
  const recentRuns = selectedRepositoryId
    ? allRecentRuns.filter((run) => run.repository.id === selectedRepositoryId)
    : [];
  const totalRuns = recentRuns.length;
  const totalPages = Math.max(1, Math.ceil(totalRuns / selectedPageSize));
  const page = Math.min(selectedPage, totalPages);
  const firstShown = totalRuns === 0 ? 0 : (page - 1) * selectedPageSize + 1;
  const lastShown = Math.min(totalRuns, page * selectedPageSize);
  const paginatedRuns = recentRuns.slice((page - 1) * selectedPageSize, page * selectedPageSize);
  const previousHref = buildDiscoverHref({
    deleted,
    page: Math.max(1, page - 1),
    pageSize: selectedPageSize,
    repositoryId: selectedRepositoryId,
  });
  const nextHref = buildDiscoverHref({
    deleted,
    page: Math.min(totalPages, page + 1),
    pageSize: selectedPageSize,
    repositoryId: selectedRepositoryId,
  });

  return (
    <AppShell active="discover">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Page Discovery</p>
            <h1>Discover Tests</h1>
          </div>
          <a className="primary-link" href={selectedRepositoryId ? `/features?repositoryId=${selectedRepositoryId}` : "/features"}>
            Feature Catalog
          </a>
        </header>

        <section className="panel discover-panel">
          <div className="panel-header">
            <div>
              <h2>Analyze Page</h2>
              <p>Create a saved analysis artifact, then review and queue recommended tests from its detail page.</p>
            </div>
          </div>
          <form action={analyzePage} className="job-form discover-form">
            <div className="scoped-repository-field">
              <span>Test Suite Repository</span>
              {selectedRepository ? (
                <>
                  <input name="repositoryId" type="hidden" value={selectedRepositoryId} />
                  <div className="locked-scope-value">
                    <strong>{repositoryLabel(selectedRepository)}</strong>
                    <small>
                      {selectedRepository.defaultBranch} - {repositoryTrackerLabel(selectedRepository)}
                    </small>
                  </div>
                  <span className="field-hint">
                    Locked to the current scope. Change the Scope selector above to use a different repository.
                  </span>
                </>
              ) : (
                <>
                  <div className="locked-scope-value missing">
                    <strong>No repository scope selected</strong>
                    <small>{repositories.length === 0 ? "Register a repository first" : "Choose a Scope above"}</small>
                  </div>
                  <span className="field-hint">Discover analysis needs a scoped repository before it can run.</span>
                </>
              )}
            </div>
            <label>
              Target Branch
              <input name="targetBranch" defaultValue={selectedBranch} required />
            </label>
            <label className="wide-field">
              Page URL
              <input name="pageUrl" defaultValue={analyzePageUrl} placeholder="https://example.com/login" required type="url" />
            </label>
            <label className="wide-field">
              Notes
              <textarea
                name="notes"
                defaultValue={notes}
                placeholder="Focus on authentication, validation, empty states, or the riskiest user flows."
              />
            </label>
            <AnalyzeSubmitButton disabled={!selectedRepositoryId} />
          </form>
        </section>

        {deleted === "1" ? <p className="queue-success-note">Discovery run deleted.</p> : null}

        {recentRuns.length > 0 ? (
          <section className="panel discover-history-panel">
            <div className="panel-header">
              <div>
                <h2>Saved Analyses</h2>
                <p>
                  Reopen saved page analyses without regenerating recommendations. Showing {firstShown}-{lastShown} of{" "}
                  {totalRuns}.
                </p>
              </div>
              <form className="discover-history-controls" action="/discover">
                {selectedRepositoryId ? <input name="repositoryId" type="hidden" value={selectedRepositoryId} /> : null}
                {deleted === "1" ? <input name="deleted" type="hidden" value="1" /> : null}
                <label>
                  Page Size
                  <select defaultValue={selectedPageSize} name="pageSize">
                    <option value="5">5</option>
                    <option value="10">10</option>
                    <option value="25">25</option>
                  </select>
                </label>
                <button className="secondary-button" type="submit">
                  Apply
                </button>
              </form>
            </div>
            <ol className="discover-history-list">
              {paginatedRuns.map((run) => {
                const candidateCount = run.visibleDecisions.length;
                const hiddenCount = run.hiddenDecisions.length;

                return (
                  <li key={run.id}>
                    <div>
                      <a href={`/discover/${run.id}`}>{run.pageUrl}</a>
                      <span>
                        {repositoryLabel(run.repository)} on {run.targetBranch}
                      </span>
                      <form action={deleteDiscoverRun} className="discover-history-delete-form">
                        <input name="discoverRunId" type="hidden" value={run.id} />
                        <button className="danger-button compact-button" type="submit">
                          Delete
                        </button>
                      </form>
                    </div>
                    <div className="discover-history-meta">
                      <span>{run.provider}</span>
                      <span>
                        {candidateCount} visible / {hiddenCount} hidden
                      </span>
                      {run.queuedTitles.length > 0 ? <span>{run.queuedTitles.length} queued</span> : null}
                      <time dateTime={run.createdAt}>{formatRunDate(run.createdAt)}</time>
                    </div>
                  </li>
                );
              })}
            </ol>
            <nav className="pagination-bar" aria-label="Saved analyses pagination">
              <span>
                Page {page} of {totalPages}
              </span>
              <div>
                {page > 1 ? (
                  <a className="secondary-button" href={previousHref}>
                    Previous
                  </a>
                ) : (
                  <span className="pagination-disabled">Previous</span>
                )}
                {page < totalPages ? (
                  <a className="secondary-button" href={nextHref}>
                    Next
                  </a>
                ) : (
                  <span className="pagination-disabled">Next</span>
                )}
              </div>
            </nav>
          </section>
        ) : (
          <section className="panel detail-empty">
            <h2>No saved analyses yet</h2>
            <p>Analyze a page to create the first saved recommendation artifact.</p>
          </section>
        )}

        {selectedRepository ? (
          selectedRepository.trackerIntegration ? (
            <p className="queue-success-note">
              Queued jobs for {repositoryLabel(selectedRepository)} will create Jira tickets in{" "}
              {selectedRepository.trackerIntegration.projectKey}.
            </p>
          ) : (
            <p className="queue-paused-note">
              {repositoryLabel(selectedRepository)} has no work tracker attached, so queued jobs will not create Jira tickets.
            </p>
          )
        ) : null}
      </section>
    </AppShell>
  );
}
