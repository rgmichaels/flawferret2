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

export default async function FeaturesPage({
  searchParams,
}: {
  searchParams: Promise<{ repositoryId?: string; q?: string; tag?: string; unmatched?: string }>;
}) {
  const [{ q, repositoryId, tag, unmatched }, repositories] = await Promise.all([
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
          <section className="feature-grid" aria-label="Cucumber feature files">
            {filteredFeatures.map((feature) => (
              <article className="panel feature-card" key={feature.path}>
                <div>
                  <span>{feature.path}</span>
                  <h2>{feature.feature}</h2>
                  <p>{feature.description ?? "No feature description recorded."}</p>
                </div>
                <dl>
                  <div>
                    <dt>Scenarios</dt>
                    <dd>{feature.scenarioCount}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatDate(feature.modifiedAt)}</dd>
                  </div>
                </dl>
                {feature.tags.length > 0 ? (
                  <div className="tag-row">
                    {feature.tags.slice(0, 6).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                ) : null}
                <a className="secondary-button feature-card-link" href={featureDetailHref(catalog.repository.id, feature.path)}>
                  Open Feature
                </a>
              </article>
            ))}
          </section>
        )}
      </section>
    </AppShell>
  );
}
