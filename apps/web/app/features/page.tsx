import type {
  CucumberFeatureCatalogResponse,
  CucumberFeatureSummary,
  RepositoryResponse,
} from "@flawferret2/job-schemas";
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
  searchParams: Promise<{ feature?: string; repositoryId?: string; q?: string; tag?: string; unmatched?: string }>;
}) {
  const [{ feature: selectedFeaturePathParam, q, repositoryId, tag, unmatched }, repositories] = await Promise.all([
    searchParams,
    getRepositories(),
  ]);
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
            <label>
              Repository
              <select name="repositoryId" defaultValue={selectedRepository?.id ?? ""}>
                {repositories.length === 0 ? <option value="">No repositories registered</option> : null}
                {repositories.map((repository) => (
                  <option key={repository.id} value={repository.id}>
                    {repositoryLabel(repository)}
                  </option>
                ))}
              </select>
            </label>
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
            <button type="submit" disabled={repositories.length === 0}>
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
                    <dd>No data</dd>
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
                  <p>No feature run history has been recorded yet.</p>
                  <a className="secondary-button" href="/jobs/new">
                    Create Run Job
                  </a>
                </section>
              </article>
            ) : null}
          </section>
        )}
      </section>
    </AppShell>
  );
}
