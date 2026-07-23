import type {
  CucumberFeatureCatalogResponse,
  DiscoverExistingCoverage,
  DiscoverTestRecommendation,
  DiscoverTestRecommendationsResponse,
  QueueControlResponse,
  RepositoryResponse,
} from "@flawferret2/job-schemas";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AppShell } from "../app-shell";

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

async function queueSelectedTests(formData: FormData) {
  "use server";

  const repositoryId = String(formData.get("repositoryId") ?? "");
  const targetBranch = String(formData.get("targetBranch") ?? "main");
  const pageUrl = String(formData.get("pageUrl") ?? "");
  const notes = String(formData.get("notes") ?? "");
  const selectedRecommendations = formData.getAll("recommendation").map((value) => String(value));
  const queuedCount = selectedRecommendations.length;

  if (queuedCount === 0) {
    redirect(
      `/discover?${new URLSearchParams({
        notes,
        pageUrl,
        repositoryId,
        targetBranch,
        queued: "0",
      }).toString()}`,
    );
  }

  await Promise.all(
    selectedRecommendations.map(async (serializedRecommendation) => {
      const recommendation = JSON.parse(serializedRecommendation) as TestRecommendation;
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

  revalidatePath("/");
  revalidatePath("/discover");
  redirect(
    `/discover?${new URLSearchParams({
      notes,
      pageUrl,
      repositoryId,
      targetBranch,
      queued: String(queuedCount),
    }).toString()}`,
  );
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

const tokenize = (value: string) =>
  new Set(
    value
      .toLowerCase()
      .replace(/https?:\/\/|www\./g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !["com", "the", "and", "page", "test", "should"].includes(token)),
  );

const coverageText = (coverage: DiscoverExistingCoverage) =>
  [coverage.feature, coverage.scenario, coverage.path, ...coverage.tags, ...coverage.steps].join(" ");

const overlapScore = (left: Set<string>, right: Set<string>) => {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  return [...left].filter((token) => right.has(token)).length / Math.min(left.size, right.size);
};

const summarizeRelatedCoverage = ({
  catalog,
  notes,
  pageUrl,
}: {
  catalog: CucumberFeatureCatalogResponse | null;
  notes: string;
  pageUrl: string;
}): DiscoverExistingCoverage[] => {
  if (!catalog || !pageUrl) {
    return [];
  }

  const pageTokens = tokenize(`${toPageLabel(pageUrl)} ${pageUrl} ${notes}`);

  return catalog.features
    .flatMap((feature) =>
      feature.scenarios.map((scenario) => ({
        coverage: {
          feature: feature.feature,
          path: feature.path,
          scenario: scenario.name,
          steps: scenario.steps.map((step) => `${step.keyword} ${step.text}`),
          tags: [...new Set([...feature.tags, ...scenario.tags])],
        },
        score: overlapScore(
          pageTokens,
          tokenize(
            [
              feature.feature,
              scenario.name,
              feature.path,
              ...scenario.tags,
              ...scenario.steps.map((step) => step.text),
            ].join(" "),
          ),
        ),
      })),
    )
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 12)
    .map((item) => item.coverage);
};

const filterCoveredRecommendations = ({
  existingCoverage,
  recommendations,
}: {
  existingCoverage: DiscoverExistingCoverage[];
  recommendations: TestRecommendation[];
}) =>
  recommendations.filter((recommendation) => {
    const recommendationTokens = tokenize([recommendation.title, recommendation.reason, ...recommendation.scenario].join(" "));

    return !existingCoverage.some((coverage) => {
      const coverageTokens = tokenize(coverageText(coverage));
      const titleMatch = coverage.scenario.toLowerCase() === recommendation.title.toLowerCase();
      const highOverlap = overlapScore(recommendationTokens, coverageTokens) >= 0.78;

      return titleMatch || highOverlap;
    });
  });

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

const buildAcceptanceCriteria = ({
  notes,
  pageUrl,
  recommendation,
}: {
  notes: string;
  pageUrl: string;
  recommendation: TestRecommendation;
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

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{
    notes?: string;
    pageUrl?: string;
    queued?: string;
    repositoryId?: string;
    targetBranch?: string;
  }>;
}) {
  const [{ notes = "", pageUrl = "", queued, repositoryId = "", targetBranch = "main" }, repositories, queueControl] =
    await Promise.all([searchParams, getRepositories(), getQueueControl()]);
  const selectedRepository = repositories.find((repository) => repository.id === repositoryId) ?? repositories[0];
  const selectedRepositoryId = repositoryId || selectedRepository?.id || "";
  const selectedBranch = targetBranch || selectedRepository?.defaultBranch || "main";
  const featureCatalog = pageUrl ? await getFeatureCatalog(selectedRepositoryId) : null;
  const existingCoverage = summarizeRelatedCoverage({
    catalog: featureCatalog,
    notes,
    pageUrl,
  });
  const rawLocalRecommendations = buildRecommendations({
    notes,
    pageUrl,
  });
  const localRecommendations = filterCoveredRecommendations({
    existingCoverage,
    recommendations: rawLocalRecommendations,
  });
  const aiRecommendations = await getAiRecommendations({
    existingCoverage,
    notes,
    pageUrl,
  });
  const aiGapRecommendations =
    aiRecommendations?.provider === "openai"
      ? filterCoveredRecommendations({
          existingCoverage,
          recommendations: aiRecommendations.recommendations,
        })
      : [];
  const recommendations =
    aiRecommendations?.provider === "openai" && aiGapRecommendations.length > 0
      ? aiGapRecommendations
      : localRecommendations;
  const suppressedAiDuplicateCount =
    aiRecommendations?.provider === "openai"
      ? aiRecommendations.recommendations.length - aiGapRecommendations.length
      : 0;
  const suppressedLocalDuplicateCount = rawLocalRecommendations.length - localRecommendations.length;
  const suppressedDuplicateCount =
    aiRecommendations?.provider === "openai" && aiRecommendations.recommendations.length > 0
      ? suppressedAiDuplicateCount
      : suppressedLocalDuplicateCount;
  const recommendationProvider =
    aiRecommendations?.provider === "openai" && aiGapRecommendations.length > 0 ? "AI gap analysis" : "local gap analysis";
  const queuedCount = Number.parseInt(queued ?? "", 10);

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
              <p>Generate high-impact test ideas, select the valuable ones, and queue them for implementation.</p>
            </div>
          </div>
          <form action="/discover" className="job-form discover-form">
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
            <button type="submit" disabled={repositories.length === 0}>
              Analyze Page
            </button>
          </form>
        </section>

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

        {queueControl.paused ? (
          <p className="queue-paused-note">Queue is paused. Selected tests can be queued now and will wait.</p>
        ) : null}

        {Number.isFinite(queuedCount) ? (
          queuedCount > 0 ? (
            <p className="queue-success-note">
              {queuedCount} {queuedCount === 1 ? "test was" : "tests were"} added to the queue.
            </p>
          ) : (
            <p className="queue-paused-note">Select at least one recommended test before queueing.</p>
          )
        ) : null}

        {pageUrl && existingCoverage.length > 0 ? (
          <section className="panel existing-coverage-panel">
            <div className="panel-header">
              <div>
                <h2>Related Existing Tests</h2>
                <p>
                  {existingCoverage.length} nearby Cucumber {existingCoverage.length === 1 ? "scenario was" : "scenarios were"} used
                  to avoid duplicate recommendations.
                </p>
              </div>
            </div>
            <ol className="existing-coverage-list">
              {existingCoverage.slice(0, 8).map((coverage) => (
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

        {recommendations.length > 0 ? (
          <form action={queueSelectedTests} className="panel recommendation-panel">
            <div className="panel-header">
              <div>
                <h2>Recommended Tests</h2>
                <p>
                  {recommendations.length} behavior-focused candidates for this page. Generated by {recommendationProvider}.
                </p>
              </div>
              <button type="submit">Queue Selected</button>
            </div>
            {aiRecommendations?.message ? (
              <p className="queue-paused-note recommendation-source-note">{aiRecommendations.message}</p>
            ) : null}
            {suppressedDuplicateCount > 0 ? (
              <p className="queue-success-note recommendation-source-note">
                {suppressedDuplicateCount} duplicate-looking{" "}
                {suppressedDuplicateCount === 1 ? "recommendation was" : "recommendations were"} hidden because related tests
                already exist.
              </p>
            ) : null}
            <input name="repositoryId" type="hidden" value={selectedRepositoryId} />
            <input name="targetBranch" type="hidden" value={selectedBranch} />
            <input name="pageUrl" type="hidden" value={pageUrl} />
            <input name="notes" type="hidden" value={notes} />
            <ol className="recommendation-list">
              {recommendations.map((recommendation) => (
                <li key={recommendation.title}>
                  <label className="recommendation-check">
                    <input name="recommendation" type="checkbox" value={JSON.stringify(recommendation)} />
                    <span>Implement Test</span>
                  </label>
                  <div className="recommendation-copy">
                    <div>
                      <h3>{recommendation.title}</h3>
                      <span className={`impact-pill ${recommendation.impact.toLowerCase()}`}>
                        {recommendation.impact} impact
                      </span>
                    </div>
                    <p>{recommendation.reason}</p>
                    <pre>{recommendation.scenario.join("\n")}</pre>
                    <div className="tag-row compact">
                      {recommendation.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </form>
        ) : (
          <section className="panel detail-empty">
            <h2>No page analyzed yet</h2>
            <p>Enter a page URL to generate candidate tests.</p>
          </section>
        )}
      </section>
    </AppShell>
  );
}
