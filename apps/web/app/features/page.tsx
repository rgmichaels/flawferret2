import type {
  CucumberFeatureCatalogResponse,
  CucumberFeatureSummary,
  LocalTestRunResponse,
  LocalTestRunStatsResponse,
  ReadinessResponse,
  RepositoryResponse,
} from "@flawferret2/job-schemas";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppShell } from "../app-shell";

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

  revalidatePath("/features");
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}${response.ok ? "localRunQueued=1" : "localRunError=1"}`);
}

async function getFeatureHasUnmatchedSteps(repositoryId: string, featurePath: string) {
  try {
    const response = await fetch(
      `${apiUrl}/repositories/${repositoryId}/features/detail?path=${encodeURIComponent(featurePath)}`,
      {
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return false;
    }

    const detail = (await response.json()) as { feature?: CucumberFeatureSummary };

    return Boolean(detail.feature?.scenarios.some((scenario) => scenario.unmatchedStepCount > 0));
  } catch {
    return false;
  }
}

const repositoryLabel = (repository: RepositoryResponse) => `${repository.owner}/${repository.name}`;

const featureDetailHref = (repositoryId: string, path: string) =>
  `/features/${repositoryId}/${path.split("/").map(encodeURIComponent).join("/")}`;

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const formatLocalRunStatus = (status: LocalTestRunResponse["status"]) =>
  status.charAt(0) + status.slice(1).toLowerCase();

const localRunLabel = (run: LocalTestRunResponse, scenarios: CucumberFeatureSummary["scenarios"]) => {
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

const normalizeSearch = (value: string | undefined) => value?.trim().toLowerCase() ?? "";

const getAllTags = (features: CucumberFeatureSummary[]) =>
  [...new Set(features.flatMap((feature) => feature.tags))].sort((left, right) => left.localeCompare(right));

const featureMatchesSearch = (feature: CucumberFeatureSummary, search: string) => {
  if (!search) {
    return true;
  }

  return [
    feature.feature,
    feature.description ?? "",
    feature.path,
    feature.tags.join(" "),
    ...feature.scenarios.flatMap((scenario) => [
      scenario.name,
      scenario.tags.join(" "),
      ...scenario.steps.map((step) => step.text),
    ]),
  ]
    .join(" ")
    .toLowerCase()
    .includes(search);
};

const filterFeatures = async ({
  catalog,
  repositoryId,
  search,
  tag,
  unmatchedOnly,
}: {
  catalog: CucumberFeatureCatalogResponse;
  repositoryId: string;
  search: string;
  tag: string;
  unmatchedOnly: boolean;
}) => {
  const baseMatches = catalog.features.filter(
    (feature) =>
      featureMatchesSearch(feature, search) &&
      (!tag || feature.tags.includes(tag) || feature.scenarios.some((scenario) => scenario.tags.includes(tag))),
  );

  if (!unmatchedOnly) {
    return baseMatches;
  }

  const unmatchedFlags = await Promise.all(
    baseMatches.map(async (feature) => ({
      feature,
      hasUnmatchedSteps: await getFeatureHasUnmatchedSteps(repositoryId, feature.path),
    })),
  );

  return unmatchedFlags.filter((item) => item.hasUnmatchedSteps).map((item) => item.feature);
};

type FeatureTreeNode = {
  children: Map<string, FeatureTreeNode>;
  feature: CucumberFeatureSummary | null;
  name: string;
  path: string;
  scenarioCount: number;
  type: "folder" | "feature";
  unmatchedStepCount: number;
};

const createTreeNode = ({
  name,
  path,
  type,
}: {
  name: string;
  path: string;
  type: FeatureTreeNode["type"];
}): FeatureTreeNode => ({
  children: new Map(),
  feature: null,
  name,
  path,
  scenarioCount: 0,
  type,
  unmatchedStepCount: 0,
});

const getFeatureUnmatchedStepCount = (feature: CucumberFeatureSummary) =>
  feature.scenarios.reduce((total, scenario) => total + scenario.unmatchedStepCount, 0);

const buildFeatureTree = ({
  features,
  root,
}: {
  features: CucumberFeatureSummary[];
  root: string | null;
}) => {
  const rootName = root?.trim() || "Feature files";
  const rootNode = createTreeNode({
    name: rootName,
    path: rootName,
    type: "folder",
  });

  for (const feature of features) {
    const parts = feature.path.split("/").filter(Boolean);
    const relativeParts = parts[0] === rootName ? parts.slice(1) : parts;
    const pathParts = relativeParts.length > 0 ? relativeParts : parts;
    let currentNode = rootNode;
    const unmatchedStepCount = getFeatureUnmatchedStepCount(feature);

    currentNode.scenarioCount += feature.scenarioCount;
    currentNode.unmatchedStepCount += unmatchedStepCount;

    pathParts.forEach((part, index) => {
      const isFeatureFile = index === pathParts.length - 1;
      const nodePath = pathParts.slice(0, index + 1).join("/");
      const existingNode = currentNode.children.get(part);
      const nextNode =
        existingNode ??
        createTreeNode({
          name: part,
          path: nodePath,
          type: isFeatureFile ? "feature" : "folder",
        });

      nextNode.scenarioCount += feature.scenarioCount;
      nextNode.unmatchedStepCount += unmatchedStepCount;

      if (isFeatureFile) {
        nextNode.feature = feature;
        nextNode.path = feature.path;
        nextNode.type = "feature";
      }

      currentNode.children.set(part, nextNode);
      currentNode = nextNode;
    });
  }

  return rootNode;
};

const sortFeatureTreeNodes = (nodes: Iterable<FeatureTreeNode>) =>
  [...nodes].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "folder" ? -1 : 1;
    }

    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

const buildFeaturesHref = ({
  featurePath,
  repositoryId,
  search,
  tag,
  unmatchedOnly,
}: {
  featurePath?: string;
  repositoryId: string;
  search: string;
  tag: string;
  unmatchedOnly: boolean;
}) => {
  const params = new URLSearchParams();

  params.set("repositoryId", repositoryId);
  if (search) {
    params.set("q", search);
  }
  if (tag) {
    params.set("tag", tag);
  }
  if (unmatchedOnly) {
    params.set("unmatched", "true");
  }
  if (featurePath) {
    params.set("feature", featurePath);
  }

  return `/features?${params.toString()}`;
};

const renderFeatureTree = ({
  activeFeaturePath,
  node,
  repositoryId,
  search,
  tag,
  unmatchedOnly,
}: {
  activeFeaturePath: string;
  node: FeatureTreeNode;
  repositoryId: string;
  search: string;
  tag: string;
  unmatchedOnly: boolean;
}) => {
  const children = sortFeatureTreeNodes(node.children.values());

  return (
    <ol className="feature-tree-list">
      {children.map((child) => {
        const isActive = child.feature?.path === activeFeaturePath;

        return (
          <li className={`feature-tree-node ${child.type}${isActive ? " active" : ""}`} key={`${child.type}:${child.path}`}>
            {child.type === "folder" ? (
              <details open>
                <summary>
                  <span className="feature-tree-icon" aria-hidden="true">
                    /
                  </span>
                  <span>{child.name}</span>
                  <small>
                    {child.children.size} {child.children.size === 1 ? "item" : "items"} / {child.scenarioCount}{" "}
                    {child.scenarioCount === 1 ? "scenario" : "scenarios"}
                  </small>
                  {child.unmatchedStepCount > 0 ? <em>{child.unmatchedStepCount} unmatched</em> : null}
                </summary>
                {renderFeatureTree({
                  activeFeaturePath,
                  node: child,
                  repositoryId,
                  search,
                  tag,
                  unmatchedOnly,
                })}
              </details>
            ) : child.feature ? (
              <a
                href={buildFeaturesHref({
                  featurePath: child.feature.path,
                  repositoryId,
                  search,
                  tag,
                  unmatchedOnly,
                })}
              >
                <span className="feature-tree-icon" aria-hidden="true">
                  .feature
                </span>
                <span>{child.feature.feature}</span>
                <small>{child.feature.path}</small>
                {child.unmatchedStepCount > 0 ? <em>{child.unmatchedStepCount} unmatched</em> : null}
              </a>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
};

export default async function FeaturesPage({
  searchParams,
}: {
  searchParams: Promise<{
    feature?: string;
    localRunError?: string;
    localRunQueued?: string;
    repositoryId?: string;
    q?: string;
    tag?: string;
    unmatched?: string;
  }>;
}) {
  const [
    { feature: selectedFeaturePathParam, localRunError, localRunQueued, q, repositoryId, tag, unmatched },
    [repositories, readiness],
  ] = await Promise.all([searchParams, Promise.all([getRepositories(), getReadiness()])]);
  const selectedRepository = repositories.find((repository) => repository.id === repositoryId) ?? repositories[0] ?? null;
  const catalog = selectedRepository ? await getFeatureCatalog(selectedRepository.id) : null;
  const search = normalizeSearch(q);
  const selectedTag = tag?.trim() ?? "";
  const unmatchedOnly = unmatched === "true";
  const allTags = catalog ? getAllTags(catalog.features) : [];
  const filteredFeatures = catalog
    ? await filterFeatures({
        catalog,
        repositoryId: catalog.repository.id,
        search,
        tag: selectedTag,
        unmatchedOnly,
      })
    : [];
  const filteredScenarios = filteredFeatures.reduce((total, feature) => total + feature.scenarioCount, 0);
  const selectedFeature =
    filteredFeatures.find((feature) => feature.path === selectedFeaturePathParam) ?? filteredFeatures[0] ?? null;
  const featureTree = catalog
    ? buildFeatureTree({
        features: filteredFeatures,
        root: catalog.root,
      })
    : null;
  const selectedFeatureUnmatchedStepCount = selectedFeature ? getFeatureUnmatchedStepCount(selectedFeature) : 0;
  const selectedFeatureLocalTestRunList =
    selectedFeature && catalog
      ? await getLocalTestRuns(catalog.repository.id, selectedFeature.path)
      : { runs: [], totalRuns: 0 };
  const selectedFeatureLocalTestRuns = selectedFeatureLocalTestRunList.runs;
  const selectedFeatureLocalTestStats =
    selectedFeature && catalog ? await getLocalTestRunStats(catalog.repository.id, selectedFeature.path) : null;
  const selectedFeatureHref =
    selectedFeature && catalog
      ? buildFeaturesHref({
          featurePath: selectedFeature.path,
          repositoryId: catalog.repository.id,
          search,
          tag: selectedTag,
          unmatchedOnly,
        })
      : "/features";
  const selectedFeatureLocalTestRunsHref =
    selectedFeature && catalog
      ? `/local-test-runs?repositoryId=${encodeURIComponent(catalog.repository.id)}&featurePath=${encodeURIComponent(
          selectedFeature.path,
        )}`
      : "/local-test-runs";

  return (
    <AppShell active="features">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Cucumber Catalog</p>
            <h1>Features</h1>
          </div>
          <a className="primary-link" href="/repositories">
            Manage Repositories
          </a>
        </header>

        <section className="panel feature-toolbar">
          <form>
            <div className="scoped-repository-field">
              <span>Repository</span>
              {selectedRepository ? (
                <>
                  <input name="repositoryId" type="hidden" value={selectedRepository.id} />
                  <div className="locked-scope-value">
                    <strong>{repositoryLabel(selectedRepository)}</strong>
                    <small>{selectedRepository.defaultBranch}</small>
                  </div>
                  <span className="field-hint">Locked to the sidebar scope.</span>
                </>
              ) : (
                <div className="locked-scope-value missing">
                  <strong>No repository scope selected</strong>
                  <small>{repositories.length === 0 ? "Register a repository first" : "Choose a Scope in the sidebar"}</small>
                </div>
              )}
            </div>
            <label>
              Search
              <input
                defaultValue={q ?? ""}
                name="q"
                placeholder="Feature, scenario, step, tag, or file"
                type="search"
              />
            </label>
            <label>
              Tag
              <select name="tag" defaultValue={selectedTag}>
                <option value="">All tags</option>
                {allTags.map((tagValue) => (
                  <option key={tagValue} value={tagValue}>
                    {tagValue}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-filter">
              <input
                defaultChecked={unmatchedOnly}
                name="unmatched"
                type="checkbox"
                value="true"
              />
              Unmatched only
            </label>
            <button type="submit" disabled={!selectedRepository}>
              Apply
            </button>
            {(q || selectedTag || unmatchedOnly) && selectedRepository ? (
              <a className="filter-reset" href={`/features?repositoryId=${selectedRepository.id}`}>
                Reset
              </a>
            ) : null}
          </form>
          {catalog ? (
            <dl>
              <div>
                <dt>Features</dt>
                <dd>{filteredFeatures.length}</dd>
              </div>
              <div>
                <dt>Scenarios</dt>
                <dd>{filteredScenarios}</dd>
              </div>
              <div>
                <dt>Root</dt>
                <dd>{catalog.root ?? "Not found"}</dd>
              </div>
            </dl>
          ) : null}
        </section>

        {catalog ? (
          <section className="feature-filter-summary" aria-label="Feature filter summary">
            <strong>
              Showing {filteredFeatures.length} of {catalog.features.length} features
            </strong>
            <span>{filteredScenarios} of {catalog.totalScenarios} scenarios</span>
            {search ? <code>Search: {q}</code> : null}
            {selectedTag ? <code>Tag: {selectedTag}</code> : null}
            {unmatchedOnly ? <code>Unmatched steps only</code> : null}
          </section>
        ) : null}

        {!selectedRepository ? (
          <section className="panel detail-empty">
            <h2>No repositories registered</h2>
            <p>Register a local checkout before browsing feature files.</p>
          </section>
        ) : !catalog ? (
          <section className="panel detail-empty">
            <h2>Feature catalog unavailable</h2>
            <p>FlawFerret2 could not read feature files from this repository checkout.</p>
          </section>
        ) : catalog.features.length === 0 ? (
          <section className="panel detail-empty">
            <h2>No feature files found</h2>
            <p>No `.feature` files were found below the registered local checkout.</p>
          </section>
        ) : filteredFeatures.length === 0 ? (
          <section className="panel detail-empty">
            <h2>No matching features</h2>
            <p>Adjust the search, tag, or unmatched-step filter.</p>
          </section>
        ) : (
          <section className="feature-explorer" aria-label="Cucumber feature file explorer">
            <aside className="panel feature-tree-panel">
              <div className="panel-header">
                <div>
                  <h2>{catalog.root ?? "Feature Tree"}</h2>
                  <p>
                    {filteredFeatures.length} {filteredFeatures.length === 1 ? "file" : "files"} / {filteredScenarios}{" "}
                    {filteredScenarios === 1 ? "scenario" : "scenarios"}
                  </p>
                </div>
              </div>
              {featureTree
                ? renderFeatureTree({
                    activeFeaturePath: selectedFeature?.path ?? "",
                    node: featureTree,
                    repositoryId: catalog.repository.id,
                    search,
                    tag: selectedTag,
                    unmatchedOnly,
                  })
                : null}
            </aside>

            {selectedFeature ? (
              <article className="panel feature-preview-panel">
                <div className="panel-header">
                  <div>
                    <span className="feature-preview-kicker">Selected Feature</span>
                    <h2>{selectedFeature.feature}</h2>
                    <p>{selectedFeature.path}</p>
                  </div>
                  <a className="primary-link" href={featureDetailHref(catalog.repository.id, selectedFeature.path)}>
                    Open Feature
                  </a>
                </div>

                <p className="feature-preview-description">
                  {selectedFeature.description ?? "No feature description recorded."}
                </p>

                <dl className="feature-preview-stats">
                  <div>
                    <dt>Scenarios</dt>
                    <dd>{selectedFeature.scenarioCount}</dd>
                  </div>
                  <div>
                    <dt>Unmatched Steps</dt>
                    <dd>{selectedFeatureUnmatchedStepCount}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatDate(selectedFeature.modifiedAt)}</dd>
                  </div>
                  <div>
                    <dt>Runs</dt>
                    <dd>{selectedFeatureLocalTestStats?.totalRuns ?? 0}</dd>
                  </div>
                </dl>

                {selectedFeature.tags.length > 0 ? (
                  <div className="tag-row">
                    {selectedFeature.tags.slice(0, 10).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                ) : null}

                <section className="feature-preview-section">
                  <div>
                    <h3>Scenarios</h3>
                    <span>{selectedFeature.scenarios.length} parsed</span>
                  </div>
                  <ol className="feature-preview-scenario-list">
                    {selectedFeature.scenarios.slice(0, 8).map((scenario) => (
                      <li key={`${scenario.line}-${scenario.name}`}>
                        <div>
                          <strong>{scenario.name}</strong>
                          <span>
                            {scenario.keyword} on line {scenario.line}
                          </span>
                        </div>
                        {scenario.unmatchedStepCount > 0 ? (
                          <em>{scenario.unmatchedStepCount} unmatched</em>
                        ) : (
                          <span>Matched</span>
                        )}
                      </li>
                    ))}
                  </ol>
                  {selectedFeature.scenarios.length > 8 ? (
                    <p>{selectedFeature.scenarios.length - 8} more scenarios in feature detail.</p>
                  ) : null}
                </section>

                <section className="feature-preview-section feature-run-placeholder">
                  <div>
                    <h3>Run Readiness</h3>
                    <span>Feature-level actions</span>
                  </div>
                  {localRunQueued === "1" ? (
                    <p className="local-test-run-confirmation">Local test run queued.</p>
                  ) : null}
                  {localRunError === "1" ? (
                    <p className="local-test-run-error">Unable to queue local test run.</p>
                  ) : null}
                  <div className="local-test-run-runner-hint">
                    <strong>Runner</strong>
                    <span>{readiness?.runner.healthText ?? "Runner status unavailable."}</span>
                  </div>
                  <dl className="local-test-run-stats">
                    <div>
                      <dt>Total Runs</dt>
                      <dd>{selectedFeatureLocalTestStats?.totalRuns ?? 0}</dd>
                    </div>
                    <div>
                      <dt>Failed</dt>
                      <dd>{selectedFeatureLocalTestStats?.failedRuns ?? 0}</dd>
                    </div>
                    <div>
                      <dt>Pass Rate</dt>
                      <dd>{formatRate(selectedFeatureLocalTestStats?.passRate ?? null)}</dd>
                    </div>
                    <div>
                      <dt>Avg Time</dt>
                      <dd>{formatDuration(selectedFeatureLocalTestStats?.averageDurationMs ?? null)}</dd>
                    </div>
                  </dl>
                  {selectedFeatureLocalTestRuns.length > 0 ? (
                    <>
                      <ol className="local-test-run-list">
                        {selectedFeatureLocalTestRuns.map((run) => {
                          const label = localRunLabel(run, selectedFeature.scenarios);

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
                      <a className="local-test-run-history-link" href={selectedFeatureLocalTestRunsHref}>
                        View all {selectedFeatureLocalTestRunList.totalRuns} runs
                      </a>
                    </>
                  ) : (
                    <p>No feature run history has been recorded yet.</p>
                  )}
                  <form action={createLocalTestRun} className="local-test-run-form">
                    <input name="repositoryId" type="hidden" value={catalog.repository.id} />
                    <input name="featurePath" type="hidden" value={selectedFeature.path} />
                    <input name="returnTo" type="hidden" value={selectedFeatureHref} />
                    <button type="submit">Test Local</button>
                  </form>
                </section>
              </article>
            ) : null}
          </section>
        )}
      </section>
    </AppShell>
  );
}
