import type {
  CucumberFeatureCatalogResponse,
  CreateDiscoverRunRequest,
  DiscoverExistingCoverage,
  DiscoverRunResponse,
  DiscoverTestRecommendation,
  DiscoverTestRecommendationsResponse,
  RepositoryResponse,
} from "@flawferret2/job-schemas";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AppShell } from "../app-shell";
import { AnalyzeSubmitButton } from "./analyze-submit-button";
import { classifyRecommendationsByCoverage, summarizeRelatedCoverage } from "./coverage-matching";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type TestRecommendation = DiscoverTestRecommendation;

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

const toPageLabel = (pageUrl: string) => {
  try {
    const url = new URL(pageUrl);
    const pathLabel = url.pathname.replace(/^\/+|\/+$/g, "").replace(/[-_/]+/g, " ");

    return pathLabel.length > 0 ? pathLabel : url.hostname;
  } catch {
    return pageUrl || "page";
  }
};

const hasKeyword = (value: string, keywords: string[]) => {
  const normalized = value.toLowerCase();

  return keywords.some((keyword) => normalized.includes(keyword));
};

const buildRecommendations = ({ notes, pageUrl }: { notes: string; pageUrl: string }): TestRecommendation[] => {
  if (!pageUrl) {
    return [];
  }

  const pageLabel = toPageLabel(pageUrl);
  const context = `${pageUrl} ${notes}`;
  const authPage = hasKeyword(context, ["auth", "login", "sign in", "password", "secure"]);
  const formPage = authPage || hasKeyword(context, ["form", "checkout", "search", "input", "submit"]);
  const listPage = hasKeyword(context, ["table", "list", "search", "filter", "results"]);
  const destructivePage = hasKeyword(context, ["delete", "remove", "admin", "settings"]);
  const recommendations: TestRecommendation[] = [
    {
      acceptance: [
        "Navigate to the target page.",
        "Assert the primary heading or landmark loads.",
        "Verify the page has at least one stable, user-visible signal before interaction.",
      ],
      impact: "High",
      reason: "A focused load smoke test catches routing, rendering, and broken deployment issues quickly.",
      scenario: [
        `Given I am on the ${pageLabel} page`,
        `Then the ${pageLabel} page should load`,
      ],
      tags: ["@smoke", "@page-load"],
      title: `${pageLabel} page loads with stable content`,
    },
    {
      acceptance: [
        "Verify the document title exists and is not empty.",
        "Prefer an assertion that can fail with a clear message.",
      ],
      impact: "Medium",
      reason: "Missing title metadata is easy to regress and affects navigation, accessibility, and browser context.",
      scenario: [
        `Given I am on the ${pageLabel} page`,
        "Then the page title should be populated",
      ],
      tags: ["@metadata"],
      title: `${pageLabel} page exposes a populated title`,
    },
    {
      acceptance: [
        "Navigate to the page.",
        "Check footer or global navigation content that should be present across the app.",
      ],
      impact: "Medium",
      reason: "Global shell checks catch broken layout composition without overloading page-specific scenarios.",
      scenario: [
        `Given I am on the ${pageLabel} page`,
        "Then the global navigation or footer should be valid",
      ],
      tags: ["@layout"],
      title: `${pageLabel} page keeps global shell content intact`,
    },
  ];

  if (formPage) {
    recommendations.push(
      {
        acceptance: [
          "Submit the form with required fields empty.",
          "Assert user-visible validation feedback appears.",
          "Keep the scenario focused on validation, not successful submission.",
        ],
        impact: "High",
        reason: "Required-field validation is high-impact and often regresses when forms are refactored.",
        scenario: [
          `Given I am on the ${pageLabel} page`,
          "When I submit the form without required values",
          "Then I should see validation feedback",
        ],
        tags: ["@form", "@validation"],
        title: `${pageLabel} form rejects missing required values`,
      },
      {
        acceptance: [
          "Enter invalid data into the most important field.",
          "Submit the form.",
          "Assert the error message is clear and remains visible.",
        ],
        impact: "High",
        reason: "Invalid-input coverage protects the most common negative path.",
        scenario: [
          `Given I am on the ${pageLabel} page`,
          "When I submit invalid form data",
          "Then I should see a clear error message",
        ],
        tags: ["@form", "@negative"],
        title: `${pageLabel} form shows a clear invalid-input error`,
      },
      {
        acceptance: [
          "Enter data into user-editable fields.",
          "Trigger validation failure.",
          "Assert useful user-entered values remain available when appropriate.",
        ],
        impact: "Medium",
        reason: "Preserving useful input after validation failure reduces user friction and catches accidental resets.",
        scenario: [
          `Given I am on the ${pageLabel} page`,
          "When validation fails after I enter form data",
          "Then recoverable form values should remain populated",
        ],
        tags: ["@form", "@usability"],
        title: `${pageLabel} form preserves recoverable values after errors`,
      },
    );
  }

  if (authPage) {
    recommendations.push(
      {
        acceptance: [
          "Attempt authentication with invalid credentials.",
          "Assert the request is rejected.",
          "Assert a user-visible error is shown.",
        ],
        impact: "High",
        reason: "Authentication failure coverage protects a critical user and security path.",
        scenario: [
          "Given I am on the login page",
          "When I submit invalid credentials",
          "Then I should see an authentication error",
        ],
        tags: ["@auth", "@negative"],
        title: "Invalid login is rejected with a clear error",
      },
      {
        acceptance: [
          "Navigate directly to a secure URL without a signed-in session.",
          "Assert the app denies access or redirects appropriately.",
          "Assert the user receives a clear authentication-required signal.",
        ],
        impact: "High",
        reason: "Direct URL access is a critical bypass path for authenticated areas.",
        scenario: [
          "Given I am not signed in",
          "When I open a secure page directly",
          "Then access should require authentication",
        ],
        tags: ["@auth", "@security"],
        title: "Secure content blocks unauthenticated direct access",
      },
    );
  }

  if (listPage) {
    recommendations.push(
      {
        acceptance: [
          "Use search or filtering controls with a known term.",
          "Assert matching results remain visible.",
          "Assert non-matching or empty results are handled clearly.",
        ],
        impact: "High",
        reason: "Search and filter behavior is a high-value workflow on list-heavy pages.",
        scenario: [
          `Given I am on the ${pageLabel} page`,
          "When I filter the visible results",
          "Then matching results should remain visible",
        ],
        tags: ["@search", "@filter"],
        title: `${pageLabel} filtering narrows results predictably`,
      },
      {
        acceptance: [
          "Open the page with no available results or use a query that returns none.",
          "Assert a helpful empty state appears.",
        ],
        impact: "Medium",
        reason: "Empty states are frequent edge cases and easy to overlook.",
        scenario: [
          `Given I am on the ${pageLabel} page`,
          "When no matching results are available",
          "Then I should see a helpful empty state",
        ],
        tags: ["@empty-state"],
        title: `${pageLabel} empty state explains when no results match`,
      },
    );
  }

  if (destructivePage) {
    recommendations.push({
      acceptance: [
        "Trigger the destructive action.",
        "Assert a confirmation or guard appears before the action completes.",
        "Assert canceling the guard leaves data unchanged.",
      ],
      impact: "High",
      reason: "Destructive operations need guardrails and clear cancellation behavior.",
      scenario: [
        `Given I am on the ${pageLabel} page`,
        "When I start a destructive action",
        "Then I should be asked to confirm before changes are made",
      ],
      tags: ["@safety", "@destructive"],
      title: `${pageLabel} destructive actions require confirmation`,
    });
  }

  recommendations.push(
    {
      acceptance: [
        "Navigate using keyboard to primary interactive controls.",
        "Assert controls are reachable and have accessible names.",
      ],
      impact: "High",
      reason: "Accessible interaction checks catch severe usability regressions that visual-only checks miss.",
      scenario: [
        `Given I am on the ${pageLabel} page`,
        "When I navigate primary controls with the keyboard",
        "Then the controls should be reachable and named",
      ],
      tags: ["@accessibility", "@keyboard"],
      title: `${pageLabel} primary controls are keyboard reachable`,
    },
    {
      acceptance: [
        "Load the page at a mobile-sized viewport.",
        "Assert primary content and actions remain visible and usable.",
      ],
      impact: "Medium",
      reason: "Responsive smoke coverage catches layout regressions before they become manual QA surprises.",
      scenario: [
        `Given I view the ${pageLabel} page on a mobile viewport`,
        "Then primary content and actions should remain usable",
      ],
      tags: ["@responsive"],
      title: `${pageLabel} page remains usable on mobile viewport`,
    },
    {
      acceptance: [
        "Exercise the main action once.",
        "Assert no unexpected console errors appear during the flow.",
      ],
      impact: "Medium",
      reason: "Console-error checks catch hidden client-side failures that may not visibly break the page.",
      scenario: [
        `Given I am on the ${pageLabel} page`,
        "When I exercise the primary page action",
        "Then no unexpected console errors should be recorded",
      ],
      tags: ["@client-health"],
      title: `${pageLabel} primary flow avoids unexpected console errors`,
    },
  );

  return recommendations.slice(0, 20);
};

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
}: {
  deleted?: string;
  page: number;
  pageSize: number;
}) => {
  const params = new URLSearchParams();

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
  const [repositories, recentRuns] = await Promise.all([getRepositories(), getDiscoverRuns()]);
  const selectedRepository = repositories.find((repository) => repository.id === repositoryId) ?? repositories[0];
  const selectedRepositoryId = selectedRepository?.id || "";
  const selectedBranch = targetBranch || selectedRepository?.defaultBranch || "main";
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
  });
  const nextHref = buildDiscoverHref({
    deleted,
    page: Math.min(totalPages, page + 1),
    pageSize: selectedPageSize,
  });

  return (
    <AppShell active="discover">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Page Discovery</p>
            <h1>Discover Tests</h1>
          </div>
          <a className="primary-link" href="/features">
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
            <label>
              Test Suite Repository
              <select name="repositoryId" defaultValue={selectedRepositoryId} required disabled={repositories.length === 0}>
                <option value="">Select repository</option>
                {repositories.map((repository) => (
                  <option key={repository.id} value={repository.id}>
                    {repositoryLabel(repository)} - {repositoryTrackerLabel(repository)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Target Branch
              <input name="targetBranch" defaultValue={selectedBranch} required />
            </label>
            <label className="wide-field">
              Page URL
              <input name="pageUrl" defaultValue={pageUrl} placeholder="https://example.com/login" required type="url" />
            </label>
            <label className="wide-field">
              Notes
              <textarea
                name="notes"
                defaultValue={notes}
                placeholder="Focus on authentication, validation, empty states, or the riskiest user flows."
              />
            </label>
            <AnalyzeSubmitButton disabled={repositories.length === 0} />
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
