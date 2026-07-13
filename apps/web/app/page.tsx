import type { JobResponse } from "@flawferret2/job-schemas";
import { revalidatePath } from "next/cache";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function getJobs(): Promise<JobResponse[]> {
  try {
    const response = await fetch(`${apiUrl}/jobs`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    return response.json() as Promise<JobResponse[]>;
  } catch {
    return [];
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
        repository: formData.get("repository"),
        branch: formData.get("branch"),
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
}

export default async function Home() {
  const jobs = await getJobs();

  return (
    <main className="shell">
      <section className="intro">
        <p className="eyebrow">Milestone 1</p>
        <h1>FlawFerret2</h1>
        <p>
          Create an <code>ADD_PLAYWRIGHT_TEST</code> job and verify that the
          browser, Fastify API, Prisma, and Postgres database are connected.
        </p>
      </section>

      <section className="panel">
        <h2>Queue Job</h2>
        <form action={queueJob} className="job-form">
          <label>
            Repository
            <input name="repository" placeholder="rgmichaels/example-app" required />
          </label>
          <label>
            Branch
            <input name="branch" defaultValue="main" required />
          </label>
          <label>
            Feature Area
            <input name="featureArea" placeholder="Checkout" required />
          </label>
          <label>
            Goal
            <textarea name="goal" placeholder="Add coverage for..." required />
          </label>
          <label>
            Acceptance Criteria
            <textarea
              name="acceptanceCriteria"
              placeholder="The test should verify..."
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
              Run affected tests
            </label>
            <label>
              <input name="createDraftPr" type="checkbox" defaultChecked />
              Create draft PR
            </label>
          </div>
          <button type="submit">Queue Job</button>
        </form>
      </section>

      <section className="panel">
        <h2>Jobs</h2>
        {jobs.length === 0 ? (
          <p className="empty">No jobs have been queued yet.</p>
        ) : (
          <div className="job-list">
            {jobs.map((job) => (
              <article className="job" key={job.id}>
                <div>
                  <strong>{job.payload.featureArea}</strong>
                  <span>{job.payload.repository}</span>
                </div>
                <div>
                  <span>{job.status}</span>
                  <span>{job.priority}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
