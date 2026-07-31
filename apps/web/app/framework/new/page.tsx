import type {
  CreateFrameworkResponse,
  FrameworkTemplateDestinationType,
  FrameworkTemplateFeature,
  FrameworkTemplatePreviewResponse,
  FrameworkTemplateRequest,
  RepositoryResponse,
} from "@flawferret2/job-schemas";
import { redirect } from "next/navigation";
import { AppShell } from "../../app-shell";
import { FrameworkFolderPicker } from "./framework-folder-picker";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const defaultFeatures: FrameworkTemplateFeature[] = [
  "pageObjects",
  "apiTesting",
  "accessibility",
  "githubActions",
  "sampleFeature",
];

const featureOptions: Array<{
  description: string;
  label: string;
  value: FrameworkTemplateFeature;
}> = [
  {
    description: "BasePage, HomePage, and page-backed navigation steps.",
    label: "Page objects",
    value: "pageObjects",
  },
  {
    description: "Reusable Playwright APIRequestContext client.",
    label: "API testing helper",
    value: "apiTesting",
  },
  {
    description: "Axe-powered accessibility scan helper.",
    label: "Accessibility helper",
    value: "accessibility",
  },
  {
    description: "Pull request workflow with browser install and report artifacts.",
    label: "GitHub Actions",
    value: "githubActions",
  },
  {
    description: "Focused smoke feature and matching step definitions.",
    label: "Sample smoke test",
    value: "sampleFeature",
  },
];

type FrameworkNewSearchParams = {
  baseUrl?: string;
  createError?: string;
  created?: string;
  destinationType?: string;
  features?: string | string[];
  githubBranch?: string;
  githubOwner?: string;
  githubRepositoryId?: string;
  githubRepository?: string;
  overwritten?: string;
  packageName?: string;
  preview?: string;
  projectName?: string;
  skipped?: string;
  targetDirectory?: string;
};

const getFeatureValues = (value: string | string[] | undefined): FrameworkTemplateFeature[] => {
  const values = Array.isArray(value) ? value : value ? [value] : defaultFeatures;
  const allowed = new Set(featureOptions.map((option) => option.value));

  return values.filter((feature): feature is FrameworkTemplateFeature => allowed.has(feature as FrameworkTemplateFeature));
};

const getDestinationType = (value: string | undefined): FrameworkTemplateDestinationType =>
  value === "github" ? "github" : "local";

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

const buildPreviewRequest = (params: FrameworkNewSearchParams): FrameworkTemplateRequest => ({
  baseUrl: params.baseUrl?.trim() || "https://example.com",
  destinationType: getDestinationType(params.destinationType),
  features: getFeatureValues(params.features),
  githubBranch: params.githubBranch?.trim() || "main",
  githubOwner: params.githubOwner?.trim() || "",
  githubRepositoryId: params.githubRepositoryId?.trim() || "",
  githubRepository: params.githubRepository?.trim() || "",
  packageName: params.packageName?.trim() || "playwright-cucumber-tests",
  projectName: params.projectName?.trim() || "Playwright Cucumber Tests",
  targetDirectory: params.targetDirectory?.trim() || (params.destinationType === "github" ? "." : "qa/e2e"),
});

const getFrameworkPreview = async (
  request: FrameworkTemplateRequest,
): Promise<{ error: string | null; preview: FrameworkTemplatePreviewResponse | null }> => {
  try {
    const response = await fetch(`${apiUrl}/frameworks/preview`, {
      body: JSON.stringify(request),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      const text = await response.text();

      return {
        error: text || "Unable to preview framework.",
        preview: null,
      };
    }

    return {
      error: null,
      preview: (await response.json()) as FrameworkTemplatePreviewResponse,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to preview framework.",
      preview: null,
    };
  }
};

const toCreateRequest = (formData: FormData): FrameworkTemplateRequest & { overwriteExisting: boolean } => ({
  baseUrl: String(formData.get("baseUrl") ?? "").trim() || "https://example.com",
  destinationType: getDestinationType(String(formData.get("destinationType") ?? "")),
  features: getFeatureValues(formData.getAll("features").map(String)),
  githubBranch: String(formData.get("githubBranch") ?? "").trim() || "main",
  githubOwner: String(formData.get("githubOwner") ?? "").trim(),
  githubRepositoryId: String(formData.get("githubRepositoryId") ?? "").trim(),
  githubRepository: String(formData.get("githubRepository") ?? "").trim(),
  overwriteExisting: formData.get("overwriteExisting") === "on",
  packageName: String(formData.get("packageName") ?? "").trim() || "playwright-cucumber-tests",
  projectName: String(formData.get("projectName") ?? "").trim() || "Playwright Cucumber Tests",
  targetDirectory: String(formData.get("targetDirectory") ?? "").trim() || "qa/e2e",
});

async function createFramework(formData: FormData) {
  "use server";

  const request = toCreateRequest(formData);
  const params = new URLSearchParams({
    baseUrl: request.baseUrl,
    destinationType: request.destinationType,
    githubBranch: request.githubBranch,
    githubOwner: request.githubOwner,
    githubRepositoryId: request.githubRepositoryId,
    githubRepository: request.githubRepository,
    packageName: request.packageName,
    preview: "true",
    projectName: request.projectName,
    targetDirectory: request.targetDirectory,
  });

  for (const feature of request.features) {
    params.append("features", feature);
  }

  try {
    const response = await fetch(`${apiUrl}/frameworks/create`, {
      body: JSON.stringify(request),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error((await response.text()) || "Unable to create framework files.");
    }

    const result = (await response.json()) as CreateFrameworkResponse;
    params.set("created", String(result.createdFiles.length));
    params.set("skipped", String(result.skippedFiles.length));
    params.set("overwritten", String(result.overwrittenFiles.length));
  } catch (error) {
    params.set("createError", error instanceof Error ? error.message : "Unable to create framework files.");
  }

  redirect(`/framework/new?${params.toString()}`);
}

export default async function NewFrameworkPage({
  searchParams,
}: {
  searchParams: Promise<FrameworkNewSearchParams>;
}) {
  const params = await searchParams;
  const request = buildPreviewRequest(params);
  const selectedFeatures = new Set(request.features);
  const shouldPreview = params.preview === "true";
  const [{ error, preview }, repositories] = await Promise.all([
    shouldPreview
      ? getFrameworkPreview(request)
      : Promise.resolve({ error: null, preview: null }),
    getRepositories(),
  ]);
  const createdCount = Number(params.created ?? 0);
  const skippedCount = Number(params.skipped ?? 0);
  const overwrittenCount = Number(params.overwritten ?? 0);
  const hasCreateResult = createdCount > 0 || skippedCount > 0 || overwrittenCount > 0;
  const createCount = preview?.files.filter((file) => file.status === "create").length ?? 0;
  const existingCount = preview?.files.filter((file) => file.status === "exists").length ?? 0;

  return (
    <AppShell active="framework">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Create</p>
            <h1>Create Framework</h1>
          </div>
        </header>

        <section className="page-grid two-column framework-builder-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Framework Blueprint</h2>
                <p>Preview a fresh Playwright, TypeScript, Cucumber, and page object framework.</p>
              </div>
            </div>

            <form className="job-form standalone-form" method="get">
              <input name="preview" type="hidden" value="true" />
              <label>
                Project Name
                <input name="projectName" defaultValue={request.projectName} required />
              </label>
              <label>
                Package Name
                <input name="packageName" defaultValue={request.packageName} required />
              </label>
              <FrameworkFolderPicker
                defaultDestinationType={request.destinationType}
                defaultGithubBranch={request.githubBranch}
                defaultGithubOwner={request.githubOwner}
                defaultGithubRepositoryId={request.githubRepositoryId}
                defaultGithubRepository={request.githubRepository}
                defaultValue={request.targetDirectory}
                repositories={repositories}
              />
              <label>
                Base URL
                <input name="baseUrl" defaultValue={request.baseUrl} required type="url" />
              </label>

              <fieldset className="framework-options">
                <legend>Include</legend>
                {featureOptions.map((option) => (
                  <label key={option.value} className="framework-option">
                    <input
                      defaultChecked={selectedFeatures.has(option.value)}
                      name="features"
                      type="checkbox"
                      value={option.value}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </fieldset>

              <button type="submit">Preview Framework</button>
            </form>
          </section>

          <aside className="panel framework-principles">
            <div className="panel-header">
              <div>
                <h2>Install Philosophy</h2>
                <p>The preview is intentionally deterministic.</p>
              </div>
            </div>
            <ul>
              <li>No arbitrary sleeps or brittle waits.</li>
              <li>Typed environment configuration with early failures.</li>
              <li>Page objects own page behavior; steps stay readable.</li>
              <li>Browser traces and screenshots are captured for failures.</li>
              <li>API and accessibility helpers are reusable first-class modules.</li>
              <li>CI runs typecheck before executing Cucumber tests.</li>
            </ul>
          </aside>
        </section>

        {error ? (
          <div className="notice error">
            <strong>Preview failed</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {params.createError ? (
          <div className="notice error">
            <strong>Create failed</strong>
            <span>{params.createError}</span>
          </div>
        ) : null}

        {hasCreateResult ? (
          <div className="notice success">
            <strong>Framework files created</strong>
            <span>
              {createdCount} created, {overwrittenCount} overwritten, {skippedCount} skipped.
            </span>
          </div>
        ) : null}

        {preview ? (
          <section className="panel framework-preview">
            <div className="panel-header">
              <div>
                <h2>Preview</h2>
                <p>
                  {request.destinationType === "github" ? (
                    <>
                      {preview.totalFiles} files previewed for{" "}
                      <code>
                        {request.githubOwner}/{request.githubRepository}:{request.githubBranch}
                      </code>{" "}
                      under <code>{preview.targetDirectory}</code>.
                    </>
                  ) : (
                    <>
                      {preview.totalFiles} files under <code>{preview.targetDirectory}</code>. {createCount} will be created
                      and {existingCount} already exist.
                    </>
                  )}
                </p>
              </div>
              <span>{preview.packageName}</span>
            </div>

            {request.destinationType === "github" ? (
              <div className="framework-create-form">
                <div>
                  <strong>GitHub creation coming next</strong>
                  <small>
                    This preview is ready for repository selection. The next slice will write these files to a branch or PR.
                  </small>
                </div>
              </div>
            ) : (
              <form action={createFramework} className="framework-create-form">
              <input name="baseUrl" type="hidden" value={request.baseUrl} />
              <input name="destinationType" type="hidden" value={request.destinationType} />
              <input name="githubBranch" type="hidden" value={request.githubBranch} />
              <input name="githubOwner" type="hidden" value={request.githubOwner} />
              <input name="githubRepositoryId" type="hidden" value={request.githubRepositoryId} />
              <input name="githubRepository" type="hidden" value={request.githubRepository} />
              <input name="packageName" type="hidden" value={request.packageName} />
              <input name="projectName" type="hidden" value={request.projectName} />
              <input name="targetDirectory" type="hidden" value={request.targetDirectory} />
              {request.features.map((feature) => (
                <input key={feature} name="features" type="hidden" value={feature} />
              ))}
              <label className="framework-overwrite-option">
                <input name="overwriteExisting" type="checkbox" />
                <span>
                  <strong>Overwrite existing files</strong>
                  <small>Server-path fallback only. Leave unchecked to create missing files and skip conflicts.</small>
                </span>
              </label>
              <button type="submit">Create from Target Directory</button>
              </form>
            )}

            <section className="framework-next-steps">
              <div>
                <h3>Next Steps</h3>
                <p>Run these from the generated framework folder after files are created.</p>
              </div>
              <ol>
                <li>
                  <span>Open folder</span>
                  <code>cd {preview.targetDirectory}</code>
                </li>
                <li>
                  <span>Install dependencies</span>
                  <code>pnpm install</code>
                </li>
                <li>
                  <span>Create local env</span>
                  <code>cp .env.example .env</code>
                </li>
                <li>
                  <span>Run smoke test</span>
                  <code>pnpm test:smoke</code>
                </li>
              </ol>
            </section>

            <div className="framework-command-grid">
              <div>
                <span>Base URL</span>
                <code>{request.baseUrl}</code>
              </div>
              <div>
                <span>Install</span>
                <code>{preview.installCommand}</code>
              </div>
              <div>
                <span>Run</span>
                <code>{preview.runCommand}</code>
              </div>
            </div>

            <div className="framework-file-list">
              {preview.files.map((file) => (
                <article key={file.path} className="framework-file-card">
                  <div>
                    <span>{file.category}</span>
                    <strong>{file.path}</strong>
                    <p>{file.description}</p>
                  </div>
                  {file.status ? <mark className={`framework-file-status ${file.status}`}>{file.status}</mark> : null}
                  <code>{file.contentPreview}</code>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </AppShell>
  );
}
