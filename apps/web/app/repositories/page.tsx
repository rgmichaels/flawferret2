import type { RepositoryResponse } from "@flawferret2/job-schemas";
import { revalidatePath } from "next/cache";
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

async function registerRepository(formData: FormData) {
  "use server";

  const fullName = String(formData.get("fullName") ?? "").trim();
  const [owner, name, ...extraParts] = fullName.split("/");

  if (!owner || !name || extraParts.length > 0) {
    throw new Error("Repository must use owner/name format.");
  }

  const response = await fetch(`${apiUrl}/repositories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider: "GITHUB",
      owner,
      name,
      defaultBranch: formData.get("defaultBranch"),
      localPath: formData.get("localPath"),
    }),
  });

  if (!response.ok) {
    throw new Error("Unable to register repository.");
  }

  revalidatePath("/");
  revalidatePath("/repositories");
  revalidatePath("/jobs/new");
}

const repositoryLabel = (repository: RepositoryResponse) =>
  `${repository.owner}/${repository.name}`;

export default async function RepositoriesPage() {
  const repositories = await getRepositories();

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
                    <div>
                      <a href={repository.webUrl}>{repositoryLabel(repository)}</a>
                      <code>{repository.localPath ?? "No local checkout configured"}</code>
                    </div>
                    <span>{repository.defaultBranch}</span>
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
              <button type="submit">Register Repository</button>
            </form>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
