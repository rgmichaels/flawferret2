import type { QueueControlResponse, RepositoryResponse } from "@flawferret2/job-schemas";
import { revalidatePath } from "next/cache";
import { AppShell } from "../../app-shell";

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

async function queueJob(formData: FormData) {
  "use server";

  const response = await fetch(`${apiUrl}/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jobType: "ADD_PLAYWRIGHT_TEST",
      priority: formData.get("priority"),
      payload: {
        repositoryId: formData.get("repositoryId"),
        targetBranch: formData.get("targetBranch"),
        featureArea: formData.get("featureArea"),
        goal: formData.get("goal"),
        acceptanceCriteria: formData.get("acceptanceCriteria"),
        runAffectedTests: formData.get("runAffectedTests") === "on",
        createDraftPr: formData.get("createDraftPr") === "on",
      },
    }),
  });

  if (!response.ok) {
    throw new Error("Unable to queue job.");
  }

  revalidatePath("/");
  revalidatePath("/jobs/new");
}

const repositoryLabel = (repository: RepositoryResponse) =>
  `${repository.owner}/${repository.name}`;

export default async function NewJobPage() {
  const [repositories, queueControl] = await Promise.all([
    getRepositories(),
    getQueueControl(),
  ]);

  return (
    <AppShell active="new-job">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Create</p>
            <h1>New Job</h1>
          </div>
          <a className="primary-link" href="/repositories">
            Repositories
          </a>
        </header>

        <section className="panel form-page-panel">
          <div className="panel-header">
            <div>
              <h2>Create New Job</h2>
              <p>Queue an Add Playwright Test request.</p>
            </div>
          </div>
          <form action={queueJob} className="job-form standalone-form">
            <label>
              Test Suite Repository
              <select name="repositoryId" required disabled={repositories.length === 0}>
                <option value="">Select repository</option>
                {repositories.map((repository) => (
                  <option key={repository.id} value={repository.id}>
                    {repositoryLabel(repository)}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                Register a repository before queueing work for ferret-runner.
              </span>
            </label>
            {queueControl.paused ? (
              <p className="queue-paused-note">
                Queue is paused. New jobs will wait until you resume it.
              </p>
            ) : null}
            <label>
              Target Branch
              <input name="targetBranch" defaultValue="main" required />
            </label>
            <label>
              Feature Area
              <input name="featureArea" placeholder="Login flow" required />
            </label>
            <label>
              Goal
              <textarea
                name="goal"
                placeholder="Verify login fails with an invalid password..."
                required
              />
            </label>
            <label>
              Acceptance Criteria
              <textarea
                name="acceptanceCriteria"
                placeholder="The test should verify the error message..."
                required
              />
            </label>
            <label>
              Priority
              <select name="priority" defaultValue="NORMAL">
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </label>
            <div className="toggles">
              <label>
                <input name="runAffectedTests" type="checkbox" defaultChecked />
                Run affected tests only
              </label>
              <label>
                <input name="createDraftPr" type="checkbox" defaultChecked />
                Create draft PR
              </label>
            </div>
            <button type="submit" disabled={repositories.length === 0}>
              Queue Job
            </button>
          </form>
        </section>
      </section>
    </AppShell>
  );
}
