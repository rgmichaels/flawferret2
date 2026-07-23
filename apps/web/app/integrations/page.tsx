import type {
  TrackerIntegrationResponse,
  TrackerIntegrationTestResponse,
} from "@flawferret2/job-schemas";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppShell } from "../app-shell";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type IntegrationsSearchParams = Promise<{
  message?: string;
  status?: "error" | "success";
  tested?: string;
}>;

const getApiErrorMessage = async (response: Response, fallback: string) => {
  try {
    const body = (await response.json()) as { message?: string; issues?: Array<{ message?: string }> };
    const issueMessage = body.issues?.map((issue) => issue.message).filter(Boolean).join("; ");

    return issueMessage || body.message || fallback;
  } catch {
    return fallback;
  }
};

const redirectWithMessage = ({
  message,
  status,
  tested,
}: {
  message: string;
  status: "error" | "success";
  tested?: string;
}) => {
  const params = new URLSearchParams({
    message,
    status,
  });

  if (tested) {
    params.set("tested", tested);
  }

  redirect(`/integrations?${params.toString()}`);
};

const trackerPayloadFromForm = (formData: FormData) => ({
  apiToken: String(formData.get("apiToken") ?? "").trim(),
  baseUrl: String(formData.get("baseUrl") ?? "").trim(),
  email: String(formData.get("email") ?? "").trim(),
  issueType: String(formData.get("issueType") ?? "Task").trim(),
  name: String(formData.get("name") ?? "").trim(),
  projectKey: String(formData.get("projectKey") ?? "").trim().toUpperCase(),
  provider: "JIRA",
});

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

async function saveTrackerIntegration(formData: FormData) {
  "use server";

  const payload = trackerPayloadFromForm(formData);
  const response = await fetch(`${apiUrl}/tracker-integrations`, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    redirectWithMessage({
      message: await getApiErrorMessage(response, "Unable to save tracker integration."),
      status: "error",
    });
  }

  revalidatePath("/integrations");
  redirectWithMessage({
    message: "Jira integration saved.",
    status: "success",
  });
}

async function updateTrackerIntegration(formData: FormData) {
  "use server";

  const integrationId = String(formData.get("integrationId") ?? "");

  if (!integrationId) {
    redirectWithMessage({
      message: "Tracker integration is required.",
      status: "error",
    });
  }

  const response = await fetch(`${apiUrl}/tracker-integrations/${integrationId}`, {
    body: JSON.stringify(trackerPayloadFromForm(formData)),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });

  if (!response.ok) {
    redirectWithMessage({
      message: await getApiErrorMessage(response, "Unable to update tracker integration."),
      status: "error",
      tested: integrationId,
    });
  }

  revalidatePath("/integrations");
  redirectWithMessage({
    message: "Jira integration updated.",
    status: "success",
    tested: integrationId,
  });
}

async function deleteTrackerIntegration(formData: FormData) {
  "use server";

  const integrationId = String(formData.get("integrationId") ?? "");

  if (!integrationId) {
    redirectWithMessage({
      message: "Tracker integration is required.",
      status: "error",
    });
  }

  const response = await fetch(`${apiUrl}/tracker-integrations/${integrationId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    redirectWithMessage({
      message: await getApiErrorMessage(response, "Unable to delete tracker integration."),
      status: "error",
    });
  }

  revalidatePath("/integrations");
  redirectWithMessage({
    message: "Jira integration deleted.",
    status: "success",
  });
}

async function testTrackerIntegration(formData: FormData) {
  "use server";

  const integrationId = String(formData.get("integrationId") ?? "");

  if (!integrationId) {
    redirectWithMessage({
      message: "Tracker integration is required.",
      status: "error",
    });
  }

  const response = await fetch(`${apiUrl}/tracker-integrations/${integrationId}/test`, {
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as TrackerIntegrationTestResponse | null;

  redirectWithMessage({
    message: body?.message ?? "Unable to test tracker integration.",
    status: response.ok && body?.ok ? "success" : "error",
    tested: integrationId,
  });
}

const integrationLabel = (integration: TrackerIntegrationResponse) =>
  `${integration.name} (${integration.projectKey})`;

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: IntegrationsSearchParams;
}) {
  const [{ message, status, tested }, integrations] = await Promise.all([
    searchParams,
    getTrackerIntegrations(),
  ]);

  return (
    <AppShell active="integrations">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Work Trackers</p>
            <h1>Integrations</h1>
          </div>
          <a className="primary-link" href="/repositories">
            Repositories
          </a>
        </header>

        {message ? (
          <div className={`notice ${status === "success" ? "success" : "error"}`}>
            <strong>{status === "success" ? "Success" : "Needs attention"}</strong>
            <span>{message}</span>
          </div>
        ) : null}

        <div className="page-grid two-column">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Configured Trackers</h2>
                <p>Saved work-tracker connections available to FlawFerret.</p>
              </div>
              <span>{integrations.length} total</span>
            </div>

            {integrations.length === 0 ? (
              <p className="empty">No tracker integrations configured yet.</p>
            ) : (
              <ul className="repository-list">
                {integrations.map((integration) => (
                  <li key={integration.id}>
                    <details open={tested === integration.id}>
                      <summary>
                        <div>
                          <strong>{integrationLabel(integration)}</strong>
                          <code>{integration.baseUrl}</code>
                          <span>
                            Jira: {integration.email} · {integration.issueType} ·{" "}
                            {integration.hasApiToken ? "token saved" : "token missing"}
                          </span>
                        </div>
                        <span>{integration.provider}</span>
                      </summary>
                      <form action={updateTrackerIntegration} className="repository-edit-form">
                        <input name="integrationId" type="hidden" value={integration.id} />
                        <label>
                          Integration Name
                          <input name="name" defaultValue={integration.name} required />
                        </label>
                        <label>
                          Jira Project URL
                          <input
                            name="baseUrl"
                            defaultValue={integration.baseUrl}
                            placeholder="https://your-domain.atlassian.net"
                            required
                          />
                        </label>
                        <label>
                          Jira Email
                          <input name="email" defaultValue={integration.email} type="email" required />
                        </label>
                        <label>
                          Jira API Token
                          <input name="apiToken" placeholder="Leave blank to keep current token" type="password" />
                          <span className="field-hint">
                            Stored server-side and never returned by the API.
                          </span>
                        </label>
                        <label>
                          Jira Project Key
                          <input name="projectKey" defaultValue={integration.projectKey} required />
                          <span className="field-hint">
                            Use the short project code before the dash, like IPCT from IPCT-4.
                          </span>
                        </label>
                        <label>
                          Jira Issue Type
                          <input name="issueType" defaultValue={integration.issueType} required />
                        </label>
                        <div className="repository-edit-actions">
                          <button type="submit">Save Changes</button>
                          <button form={`test-integration-${integration.id}`} type="submit">
                            Test Jira
                          </button>
                          <button
                            className="danger-button"
                            form={`delete-integration-${integration.id}`}
                            type="submit"
                          >
                            Delete
                          </button>
                        </div>
                      </form>
                      <form action={testTrackerIntegration} id={`test-integration-${integration.id}`}>
                        <input name="integrationId" type="hidden" value={integration.id} />
                      </form>
                      <form action={deleteTrackerIntegration} id={`delete-integration-${integration.id}`}>
                        <input name="integrationId" type="hidden" value={integration.id} />
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
                <h2>Add Jira</h2>
                <p>Configure Jira once, then attach repositories and queue jobs to it later.</p>
              </div>
            </div>
            <form action={saveTrackerIntegration} className="repository-form standalone-form">
              <label>
                Integration Name
                <input name="name" placeholder="QA Jira" required />
              </label>
              <label>
                Jira Project URL
                <input name="baseUrl" placeholder="https://your-domain.atlassian.net" required />
              </label>
              <label>
                Jira Email
                <input name="email" placeholder="you@example.com" type="email" required />
              </label>
              <label>
                Jira API Token
                <input name="apiToken" type="password" required />
                <span className="field-hint">
                  Create this in Atlassian account settings. It stays on the API side.
                </span>
              </label>
              <label>
                Jira Project Key
                <input name="projectKey" placeholder="IPCT" required />
                <span className="field-hint">
                  Use the short project code before the dash, like IPCT from IPCT-4.
                </span>
              </label>
              <label>
                Jira Issue Type
                <input name="issueType" defaultValue="Task" required />
              </label>
              <button type="submit">Save Jira Integration</button>
            </form>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
