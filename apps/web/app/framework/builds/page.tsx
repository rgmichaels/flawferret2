import type { FrameworkBuildResponse, PaginatedFrameworkBuildsResponse } from "@flawferret2/job-schemas";
import { AppShell } from "../../app-shell";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type FrameworkBuildsPageSearchParams = Promise<{
  page?: string;
  pageSize?: string;
}>;

const getSelectedPage = (value: string | undefined) => Math.max(1, Number.parseInt(value ?? "1", 10) || 1);

const getSelectedPageSize = (value: string | undefined) => {
  const pageSize = Number(value);

  return [10, 25, 50].includes(pageSize) ? pageSize : 25;
};

async function getFrameworkBuilds(page: number, pageSize: number): Promise<PaginatedFrameworkBuildsResponse> {
  try {
    const buildsUrl = new URL(`${apiUrl}/frameworks/builds`);
    buildsUrl.searchParams.set("page", String(page));
    buildsUrl.searchParams.set("pageSize", String(pageSize));
    buildsUrl.searchParams.set("paginated", "true");

    const response = await fetch(buildsUrl, {
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        builds: [],
        page,
        pageSize,
        total: 0,
      };
    }

    return response.json() as Promise<PaginatedFrameworkBuildsResponse>;
  } catch {
    return {
      builds: [],
      page,
      pageSize,
      total: 0,
    };
  }
}

const formatBuildDate = (value: string) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const formatBuildStatus = (value: string | null, fallback = "Not run") => value?.replace(/_/g, " ") ?? fallback;

const buildHistoryHref = (page: number, pageSize: number) => {
  const params = new URLSearchParams({
    page: String(page),
  });

  if (pageSize !== 25) {
    params.set("pageSize", String(pageSize));
  }

  return `/framework/builds?${params.toString()}`;
};

const buildDestinationLabel = (build: FrameworkBuildResponse) => {
  if (build.destinationType === "github" && build.githubOwner && build.githubRepository) {
    return `${build.githubOwner}/${build.githubRepository}`;
  }

  return build.destinationType === "github" ? "GitHub" : "Local folder";
};

export default async function FrameworkBuildsPage({
  searchParams,
}: {
  searchParams: FrameworkBuildsPageSearchParams;
}) {
  const { page: pageParam, pageSize: pageSizeParam } = await searchParams;
  const selectedPage = getSelectedPage(pageParam);
  const selectedPageSize = getSelectedPageSize(pageSizeParam);
  const { builds, page, pageSize, total } = await getFrameworkBuilds(selectedPage, selectedPageSize);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const firstShown = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const lastShown = Math.min(total, safePage * pageSize);

  return (
    <AppShell active="framework">
      <section className="workspace">
        <a className="back-link" href="/framework/new">
          Back to Framework Builder
        </a>

        <header className="topbar">
          <div>
            <p className="eyebrow">Framework History</p>
            <h1>Framework Builds</h1>
            <p>Saved framework creation runs and follow-up action results.</p>
          </div>
          <a className="primary-link" href="/framework/new">
            Create Framework
          </a>
        </header>

        <section className="panel framework-builds-panel">
          <div className="panel-header">
            <div>
              <h2>Saved Builds</h2>
              <p>
                Showing {firstShown}-{lastShown} of {total}.
              </p>
            </div>
            <form action="/framework/builds" className="framework-builds-filter">
              <label>
                <span>Page Size</span>
                <select defaultValue={selectedPageSize} name="pageSize">
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                </select>
              </label>
              <button type="submit">Apply</button>
            </form>
          </div>

          {builds.length > 0 ? (
            <>
              <ol className="framework-builds-list">
                {builds.map((build) => (
                  <li key={build.id}>
                    <div>
                      <a href={`/framework/builds/${build.id}`}>{build.projectName}</a>
                      <span>
                        {build.packageName} / {buildDestinationLabel(build)} / {formatBuildDate(build.createdAt)}
                      </span>
                      <code>{build.targetDirectory}</code>
                    </div>
                    <dl>
                      <div>
                        <dt>Files</dt>
                        <dd>{build.totalFileCount}</dd>
                      </div>
                      <div>
                        <dt>Git</dt>
                        <dd>{formatBuildStatus(build.localGitStatus)}</dd>
                      </div>
                      <div>
                        <dt>Install</dt>
                        <dd>{formatBuildStatus(build.installStatus)}</dd>
                      </div>
                      <div>
                        <dt>Smoke</dt>
                        <dd>{formatBuildStatus(build.smokeValidationStatus)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ol>
              <nav className="pagination-bar" aria-label="Framework build pagination">
                <span>
                  Page {safePage} of {totalPages}
                </span>
                <div>
                  {safePage > 1 ? (
                    <a className="secondary-button" href={buildHistoryHref(safePage - 1, pageSize)}>
                      Previous
                    </a>
                  ) : (
                    <span className="pagination-disabled">Previous</span>
                  )}
                  {safePage < totalPages ? (
                    <a className="secondary-button" href={buildHistoryHref(safePage + 1, pageSize)}>
                      Next
                    </a>
                  ) : (
                    <span className="pagination-disabled">Next</span>
                  )}
                </div>
              </nav>
            </>
          ) : (
            <p className="empty">No framework builds have been saved yet.</p>
          )}
        </section>
      </section>
    </AppShell>
  );
}
