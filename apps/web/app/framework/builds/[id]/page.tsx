import type { FrameworkBuildResponse } from "@flawferret2/job-schemas";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "../../../app-shell";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type FrameworkBuildPageParams = Promise<{
  id: string;
}>;

async function getFrameworkBuild(id: string): Promise<FrameworkBuildResponse | null> {
  try {
    const response = await fetch(`${apiUrl}/frameworks/builds/${id}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<FrameworkBuildResponse>;
  } catch {
    return null;
  }
}

const formatBuildDate = (value: string) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const formatStatus = (value: string | null | undefined, fallback = "Not requested") =>
  value ? value.replace(/_/g, " ") : fallback;

type FrameworkActionResult = {
  command?: string;
  durationMs?: number;
  exitCode?: number | null;
  message?: string;
  status?: string;
  stderr?: string;
  stdout?: string;
  targetDirectory?: string;
};

const isActionResult = (value: unknown): value is FrameworkActionResult =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getActionResult = (value: unknown): FrameworkActionResult | null => (isActionResult(value) ? value : null);

const formatDuration = (durationMs: number | undefined) => {
  if (durationMs === undefined) {
    return "No timing recorded";
  }

  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
};

const buildBuilderHref = (build: FrameworkBuildResponse) => {
  const next = new URLSearchParams({
    baseUrl: build.baseUrl,
    created: String(build.createdFileCount),
    destinationType: build.destinationType,
    frameworkBuildId: build.id,
    githubBranch: build.targetBranch,
    initializeGitRepository: build.localGitStatus ? "true" : "false",
    overwritten: String(build.overwrittenFileCount),
    packageName: build.packageName,
    preview: "true",
    projectName: build.projectName,
    skipped: String(build.skippedFileCount),
    step: "validate",
    targetDirectory: build.targetDirectory,
  });

  if (build.githubOwner) {
    next.set("githubOwner", build.githubOwner);
  }

  if (build.githubRepository) {
    next.set("githubRepository", build.githubRepository);
  }

  if (build.githubPullRequestUrl) {
    next.set("prUrl", build.githubPullRequestUrl);
  }

  if (build.githubRemoteStatus) {
    next.set("githubRemoteStatus", build.githubRemoteStatus);
  }

  if (build.localGitStatus) {
    next.set("localGitStatus", build.localGitStatus);
  }

  if (build.registeredRepositoryId) {
    next.set("registeredRepositoryId", build.registeredRepositoryId);
  }

  return `/framework/new?${next.toString()}`;
};

async function removeRegisteredFramework(formData: FormData) {
  "use server";

  const buildId = String(formData.get("buildId") ?? "");
  const repositoryId = String(formData.get("repositoryId") ?? "");

  if (!buildId || !repositoryId) {
    redirect(buildId ? `/framework/builds/${buildId}` : "/framework/builds");
  }

  const response = await fetch(`${apiUrl}/repositories/${repositoryId}`, {
    cache: "no-store",
    method: "DELETE",
  });

  if (!response.ok && response.status !== 404) {
    throw new Error((await response.text()) || "Unable to remove framework from FF2.");
  }

  revalidatePath("/");
  revalidatePath("/features");
  revalidatePath("/framework/builds");
  revalidatePath(`/framework/builds/${buildId}`);
  revalidatePath("/framework/new");
  revalidatePath("/repositories");
  redirect(`/framework/builds/${buildId}?removedRepository=1`);
}

export default async function FrameworkBuildDetailPage({
  params,
  searchParams,
}: {
  params: FrameworkBuildPageParams;
  searchParams: Promise<{
    removedRepository?: string;
  }>;
}) {
  const { id } = await params;
  const { removedRepository } = await searchParams;
  const build = await getFrameworkBuild(id);

  if (!build) {
    notFound();
  }

  const githubRepository =
    build.githubOwner && build.githubRepository ? `${build.githubOwner}/${build.githubRepository}` : "Not connected";
  const actionResults = [
    {
      label: "Install Dependencies",
      result: getActionResult(build.installResult),
      status: build.installStatus,
    },
    {
      label: "Open Folder",
      result: getActionResult(build.openFolderResult),
      status: build.openFolderStatus,
    },
    {
      label: "Smoke Validation",
      result: getActionResult(build.smokeValidationResult),
      status: build.smokeValidationStatus,
    },
  ];

  return (
    <AppShell active="framework">
      <section className="workspace">
        <a className="back-link" href="/framework/new">
          Back to Framework Builder
        </a>

        <header className="topbar framework-build-detail-topbar">
          <div>
            <p className="eyebrow">Framework Build</p>
            <h1>{build.projectName}</h1>
            <p>{build.targetDirectory}</p>
          </div>
          <span className="status-pill neutral">{build.destinationType === "github" ? "GitHub" : "Local"}</span>
        </header>

        <section className="panel framework-build-detail-actions">
          <div>
            <h2>Build History</h2>
            <p>
              Created {formatBuildDate(build.createdAt)}. Last updated {formatBuildDate(build.updatedAt)}.
            </p>
            {removedRepository === "1" ? (
              <p className="framework-build-success">Framework removed from FF2 repository tracking.</p>
            ) : null}
          </div>
          <div className="framework-build-action-list">
            <a className="secondary-button" href={buildBuilderHref(build)}>
              Reopen in Builder
            </a>
            {build.registeredRepositoryId ? (
              <a className="secondary-button" href={`/features?repositoryId=${build.registeredRepositoryId}`}>
                Feature Catalog
              </a>
            ) : null}
            {build.githubPullRequestUrl ? (
              <a className="primary-link" href={build.githubPullRequestUrl}>
                Open PR
              </a>
            ) : null}
          </div>
        </section>

        <section className="panel framework-build-detail-summary">
          <div className="stat-card">
            <span>Files created</span>
            <strong>{build.createdFileCount}</strong>
          </div>
          <div className="stat-card">
            <span>Overwritten</span>
            <strong>{build.overwrittenFileCount}</strong>
          </div>
          <div className="stat-card">
            <span>Skipped</span>
            <strong>{build.skippedFileCount}</strong>
          </div>
          <div className="stat-card">
            <span>Total files</span>
            <strong>{build.totalFileCount}</strong>
          </div>
        </section>

        <section className="panel framework-build-action-results">
          <div className="panel-header">
            <div>
              <h2>Follow-Up Actions</h2>
              <p>Dependency installation, folder open, and smoke validation results recorded after creation.</p>
            </div>
          </div>
          <div className="framework-build-action-results-list">
            {actionResults.map(({ label, result, status }) => (
              <article key={label} className="framework-build-action-result">
                <div>
                  <span className="eyebrow">{label}</span>
                  <h3>{formatStatus(status)}</h3>
                  <p>{result?.message ?? "This action has not been run for this build."}</p>
                </div>
                <dl>
                  <div>
                    <dt>Command</dt>
                    <dd>{result?.command ?? "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt>Exit</dt>
                    <dd>{result?.exitCode ?? "N/A"}</dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{formatDuration(result?.durationMs)}</dd>
                  </div>
                </dl>
                {result?.stdout || result?.stderr ? (
                  <details>
                    <summary>View output</summary>
                    {result.stdout ? (
                      <>
                        <strong>stdout</strong>
                        <pre>{result.stdout}</pre>
                      </>
                    ) : null}
                    {result.stderr ? (
                      <>
                        <strong>stderr</strong>
                        <pre>{result.stderr}</pre>
                      </>
                    ) : null}
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section className="page-grid framework-build-detail-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Project</h2>
                <p>Framework identity and runtime defaults.</p>
              </div>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Project Name</dt>
                <dd>{build.projectName}</dd>
              </div>
              <div>
                <dt>Package Name</dt>
                <dd>{build.packageName}</dd>
              </div>
              <div>
                <dt>Base URL</dt>
                <dd>{build.baseUrl}</dd>
              </div>
              <div>
                <dt>Target Branch</dt>
                <dd>{build.targetBranch}</dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Connections</h2>
                <p>Local and remote setup recorded during creation.</p>
              </div>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Local Git</dt>
                <dd>{formatStatus(build.localGitStatus, "Not initialized")}</dd>
              </div>
              <div>
                <dt>GitHub Repository</dt>
                <dd>{githubRepository}</dd>
              </div>
              <div>
                <dt>GitHub Remote</dt>
                <dd>{formatStatus(build.githubRemoteStatus)}</dd>
              </div>
              <div>
                <dt>Registered Repository</dt>
                <dd>
                  {build.registeredRepositoryId ? (
                    <span className="framework-registered-repository">
                      <span>{build.registeredRepositoryId}</span>
                      <form action={removeRegisteredFramework}>
                        <input name="buildId" type="hidden" value={build.id} />
                        <input name="repositoryId" type="hidden" value={build.registeredRepositoryId} />
                        <button className="danger-button" type="submit">
                          Remove from FF2
                        </button>
                      </form>
                    </span>
                  ) : (
                    "Not registered"
                  )}
                </dd>
              </div>
            </dl>
          </section>
        </section>
      </section>
    </AppShell>
  );
}
