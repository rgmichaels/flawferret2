import type { RepositoryResponse, TrackerIntegrationResponse } from "@flawferret2/job-schemas";
import { revalidatePath } from "next/cache";
import { AppShell } from "../app-shell";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const getApiErrorMessage = async (response: Response, fallback: string) => {
  try {
    const body = (await response.json()) as { message?: string; issues?: Array<{ message?: string }> };
    const issueMessage = body.issues?.map((issue) => issue.message).filter(Boolean).join("; ");

    return issueMessage || body.message || fallback;
  } catch {
    return fallback;
  }
};

const repositoryPayloadFromForm = (formData: FormData) => {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const [owner, name, ...extraParts] = fullName.split("/");

  if (!owner || !name || extraParts.length > 0) {
    throw new Error("Repository must use owner/name format.");
  }

  return {
    defaultBranch: formData.get("defaultBranch"),
    localPath: formData.get("localPath"),
    name,
    owner,
    provider: "GITHUB",
    trackerIntegrationId: String(formData.get("trackerIntegrationId") ?? "") || null,
    validationCommand: formData.get("validationCommand"),
  };
};

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

async function getTrackerIntegrations(): Promise<TrackerIntegrationResponse[]> {
  try {
    const response = await fetch(`${apiUrl}/tracker-integrations`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    return response.json() as Promise<TrackerIntegrationResponse[]>;
  } catch {
    return [];
  }
}

async function registerRepository(formData: FormData) {
  "use server";

  const payload = repositoryPayloadFromForm(formData);

  const response = await fetch(`${apiUrl}/repositories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, "Unable to register repository."));
  }

  revalidatePath("/");
  revalidatePath("/repositories");
  revalidatePath("/jobs/new");
}

async function updateRepository(formData: FormData) {
  "use server";

  const repositoryId = String(formData.get("repositoryId") ?? "");
  const payload = repositoryPayloadFromForm(formData);

  if (!repositoryId) {
    throw new Error("Repository is required.");
  }

  const response = await fetch(`${apiUrl}/repositories/${repositoryId}`, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, "Unable to update repository."));
  }

  revalidatePath("/");
  revalidatePath("/repositories");
  revalidatePath("/jobs/new");
  revalidatePath("/discover");
}

async function deleteRepository(formData: FormData) {
  "use server";

  const repositoryId = String(formData.get("repositoryId") ?? "");

  if (!repositoryId) {
    throw new Error("Repository is required.");
  }

  const response = await fetch(`${apiUrl}/repositories/${repositoryId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, "Unable to delete repository."));
  }

  revalidatePath("/");
  revalidatePath("/repositories");
  revalidatePath("/jobs/new");
  revalidatePath("/discover");
  revalidatePath("/features");
}

const repositoryLabel = (repository: RepositoryResponse) =>
  `${repository.owner}/${repository.name}`;

export default async function RepositoriesPage() {
  const [repositories, trackerIntegrations] = await Promise.all([
    getRepositories(),
    getTrackerIntegrations(),
  ]);

  return (
    <AppShell active="repositories">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Repository Registry</p>
            <h1>Repositories</h1>
          </div>
          <a className="primary-link" href="/jobs/new">
            New Job
          </a>
        </header>

        <div className="page-grid two-column">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Registered Repositories</h2>
                <p>Explicit local checkouts available to ferret-runner.</p>
              </div>
              <span>{repositories.length} total</span>
            </div>

            {repositories.length === 0 ? (
              <p className="empty">No repositories registered yet.</p>
            ) : (
              <ul className="repository-list">
                {repositories.map((repository) => (
                  <li key={repository.id}>
                    <details>
                      <summary>
                        <div>
                          <a href={repository.webUrl}>{repositoryLabel(repository)}</a>
                          <code>{repository.localPath ?? "No local checkout configured"}</code>
                          <span>
                            Validation:{" "}
                            {repository.validationCommand ? (
                              <code>{repository.validationCommand}</code>
                            ) : (
                              "Change detection only"
                            )}
                          </span>
                          <span>
                            Tracker:{" "}
                            {repository.trackerIntegration
                              ? `${repository.trackerIntegration.name} (${repository.trackerIntegration.projectKey})`
                              : "None"}
                          </span>
                        </div>
                        <span>{repository.defaultBranch}</span>
                      </summary>
                      <form action={updateRepository} className="repository-edit-form">
                        <input name="repositoryId" type="hidden" value={repository.id} />
                        <label>
                          GitHub Repository
                          <input name="fullName" defaultValue={repositoryLabel(repository)} required />
                        </label>
                        <label>
                          Default Branch
                          <input name="defaultBranch" defaultValue={repository.defaultBranch} required />
                        </label>
                        <label>
                          Local Checkout Path
                          <input name="localPath" defaultValue={repository.localPath ?? ""} required />
                        </label>
                        <label>
                          Validation Command
                          <input name="validationCommand" defaultValue={repository.validationCommand ?? ""} />
                        </label>
                        <label>
                          Work Tracker
                          <select name="trackerIntegrationId" defaultValue={repository.trackerIntegrationId ?? ""}>
                            <option value="">None</option>
                            {trackerIntegrations.map((integration) => (
                              <option key={integration.id} value={integration.id}>
                                {integration.name} ({integration.projectKey})
                              </option>
                            ))}
                          </select>
                          <span className="field-hint">
                            Queued jobs for this repository will create Jira tickets when a tracker is selected.
                          </span>
                        </label>
                        <div className="repository-edit-actions">
                          <button type="submit">Save Changes</button>
                          <button
                            className="danger-button"
                            form={`delete-repository-${repository.id}`}
                            type="submit"
                          >
                            Delete
                          </button>
                        </div>
                      </form>
                      <form action={deleteRepository} id={`delete-repository-${repository.id}`}>
                        <input name="repositoryId" type="hidden" value={repository.id} />
                      </form>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Register Repository</h2>
                <p>Add or update a GitHub repository and local checkout path.</p>
              </div>
            </div>
            <form action={registerRepository} className="repository-form standalone-form">
              <label>
                GitHub Repository
                <input name="fullName" placeholder="rgmichaels/playwright-tests" required />
              </label>
              <label>
                Default Branch
                <input name="defaultBranch" defaultValue="main" required />
              </label>
              <label>
                Local Checkout Path
                <input
                  name="localPath"
                  placeholder="/Users/robertmichaels/Documents/code/playwright-tests"
                  required
                />
              </label>
              <label>
                Validation Command
                <input
                  defaultValue="npx playwright test"
                  name="validationCommand"
                  placeholder="npx playwright test"
                />
                <span className="field-hint">
                  Defaults to Playwright. Edit or clear it if this repo needs a different check.
                </span>
              </label>
              <label>
                Work Tracker
                <select name="trackerIntegrationId" defaultValue="">
                  <option value="">None</option>
                  {trackerIntegrations.map((integration) => (
                    <option key={integration.id} value={integration.id}>
                      {integration.name} ({integration.projectKey})
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  Select Jira here when jobs for this repo should create tickets automatically.
                </span>
              </label>
              <button type="submit">Register Repository</button>
            </form>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
