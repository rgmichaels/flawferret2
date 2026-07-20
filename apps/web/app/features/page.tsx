import type {
  CucumberFeatureCatalogResponse,
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

const repositoryLabel = (repository: RepositoryResponse) => `${repository.owner}/${repository.name}`;

const featureDetailHref = (repositoryId: string, path: string) =>
  `/features/${repositoryId}/${path.split("/").map(encodeURIComponent).join("/")}`;

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export default async function FeaturesPage({
  searchParams,
}: {
  searchParams: Promise<{ repositoryId?: string }>;
}) {
  const [{ repositoryId }, repositories] = await Promise.all([searchParams, getRepositories()]);
  const selectedRepository = repositories.find((repository) => repository.id === repositoryId) ?? repositories[0] ?? null;
  const catalog = selectedRepository ? await getFeatureCatalog(selectedRepository.id) : null;

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
            <button type="submit" disabled={repositories.length === 0}>
              View Features
            </button>
          </form>
          {catalog ? (
            <dl>
              <div>
                <dt>Features</dt>
                <dd>{catalog.features.length}</dd>
              </div>
              <div>
                <dt>Scenarios</dt>
                <dd>{catalog.totalScenarios}</dd>
              </div>
              <div>
                <dt>Root</dt>
                <dd>{catalog.root ?? "Not found"}</dd>
              </div>
            </dl>
          ) : null}
        </section>

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
        ) : (
          <section className="feature-grid" aria-label="Cucumber feature files">
            {catalog.features.map((feature) => (
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
