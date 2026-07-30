import type {
  FrameworkTemplateFeature,
  FrameworkTemplatePreviewResponse,
  FrameworkTemplateRequest,
} from "@flawferret2/job-schemas";
import { AppShell } from "../../app-shell";

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
  features?: string | string[];
  packageName?: string;
  preview?: string;
  projectName?: string;
  targetDirectory?: string;
};

const getFeatureValues = (value: string | string[] | undefined): FrameworkTemplateFeature[] => {
  const values = Array.isArray(value) ? value : value ? [value] : defaultFeatures;
  const allowed = new Set(featureOptions.map((option) => option.value));

  return values.filter((feature): feature is FrameworkTemplateFeature => allowed.has(feature as FrameworkTemplateFeature));
};

const buildPreviewRequest = (params: FrameworkNewSearchParams): FrameworkTemplateRequest => ({
  baseUrl: params.baseUrl?.trim() || "https://example.com",
  features: getFeatureValues(params.features),
  packageName: params.packageName?.trim() || "playwright-cucumber-tests",
  projectName: params.projectName?.trim() || "Playwright Cucumber Tests",
  targetDirectory: params.targetDirectory?.trim() || ".",
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

export default async function NewFrameworkPage({
  searchParams,
}: {
  searchParams: Promise<FrameworkNewSearchParams>;
}) {
  const params = await searchParams;
  const request = buildPreviewRequest(params);
  const selectedFeatures = new Set(request.features);
  const shouldPreview = params.preview === "true";
  const { error, preview } = shouldPreview
    ? await getFrameworkPreview(request)
    : { error: null, preview: null };

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
              <label>
                Target Directory
                <input name="targetDirectory" defaultValue={request.targetDirectory} required />
              </label>
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

        {preview ? (
          <section className="panel framework-preview">
            <div className="panel-header">
              <div>
                <h2>Preview</h2>
                <p>
                  {preview.totalFiles} files under <code>{preview.targetDirectory}</code>. This slice only previews the
                  framework; it does not write files yet.
                </p>
              </div>
              <span>{preview.packageName}</span>
            </div>

            <div className="framework-command-grid">
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
