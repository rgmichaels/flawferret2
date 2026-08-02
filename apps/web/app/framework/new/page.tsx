import type {
  CreateFrameworkRequest,
  CreateFrameworkResponse,
  FrameworkDependencyInstallResponse,
  FrameworkTemplateDestinationType,
  FrameworkTemplateFeature,
  FrameworkTemplatePreviewResponse,
  FrameworkTemplateRequest,
  FrameworkSmokeValidationResponse,
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
  createGithubRepository?: string | string[];
  createError?: string;
  created?: string;
  destinationType?: string;
  features?: string | string[];
  githubBranch?: string;
  githubOwner?: string;
  githubRepositoryId?: string;
  githubRepository?: string;
  githubRemoteMessage?: string;
  githubRemoteRepository?: string;
  githubRemoteStatus?: string;
  githubRemoteUrl?: string;
  githubRemoteWebUrl?: string;
  initializeGitRepository?: string | string[];
  installCommand?: string;
  installDurationMs?: string;
  installExitCode?: string;
  installMessage?: string;
  installStatus?: string;
  installStderr?: string;
  installStdout?: string;
  localGitMessage?: string;
  localGitStatus?: string;
  prBranch?: string;
  prCommitSha?: string;
  prNumber?: string;
  prUrl?: string;
  registeredRepositoryId?: string;
  registeredRepositoryName?: string;
  registerLocalRepository?: string | string[];
  overwritten?: string;
  packageName?: string;
  preview?: string;
  projectName?: string;
  skipped?: string;
  step?: string;
  targetDirectory?: string;
  validationCommand?: string;
  validationDurationMs?: string;
  validationExitCode?: string;
  validationMessage?: string;
  validationStatus?: string;
  validationStderr?: string;
  validationStdout?: string;
};

type FrameworkWizardStep = "framework" | "local-git" | "github" | "register" | "validate";

const wizardSteps: Array<{
  description: string;
  label: string;
  value: FrameworkWizardStep;
}> = [
  {
    description: "Create files",
    label: "Framework",
    value: "framework",
  },
  {
    description: "Initialize repo",
    label: "Local Git",
    value: "local-git",
  },
  {
    description: "Remote project",
    label: "GitHub",
    value: "github",
  },
  {
    description: "Track in FF2",
    label: "Register",
    value: "register",
  },
  {
    description: "Run smoke test",
    label: "Validate",
    value: "validate",
  },
];

const wizardStepOrder = wizardSteps.map((step) => step.value);

const getWizardStep = (value: string | undefined, hasCreateResult: boolean): FrameworkWizardStep => {
  if (hasCreateResult) {
    return "validate";
  }

  return wizardStepOrder.includes(value as FrameworkWizardStep) ? (value as FrameworkWizardStep) : "framework";
};

const appendParam = (params: URLSearchParams, name: string, value: string | string[] | undefined) => {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item) {
        params.append(name, item);
      }
    }

    return;
  }

  if (value) {
    params.set(name, value);
  }
};

const buildFrameworkHref = (params: FrameworkNewSearchParams, step: FrameworkWizardStep) => {
  const next = new URLSearchParams();
  const keys: Array<keyof FrameworkNewSearchParams> = [
    "baseUrl",
    "createGithubRepository",
    "destinationType",
    "features",
    "githubBranch",
    "githubOwner",
    "githubRepositoryId",
    "githubRepository",
    "initializeGitRepository",
    "packageName",
    "preview",
    "projectName",
    "registerLocalRepository",
    "targetDirectory",
  ];

  for (const key of keys) {
    appendParam(next, key, params[key]);
  }

  next.set("step", step);

  if (step === "validate") {
    next.set("preview", "true");
  } else {
    next.delete("preview");
  }

  if (step === "validate") {
    const resultKeys: Array<keyof FrameworkNewSearchParams> = [
      "created",
      "githubRemoteMessage",
      "githubRemoteRepository",
      "githubRemoteStatus",
      "githubRemoteUrl",
      "githubRemoteWebUrl",
      "installCommand",
      "installDurationMs",
      "installExitCode",
      "installMessage",
      "installStatus",
      "installStderr",
      "installStdout",
      "overwritten",
      "prBranch",
      "prCommitSha",
      "prNumber",
      "prUrl",
      "registeredRepositoryId",
      "registeredRepositoryName",
      "skipped",
      "localGitMessage",
      "localGitStatus",
      "validationCommand",
      "validationDurationMs",
      "validationExitCode",
      "validationMessage",
      "validationStatus",
      "validationStderr",
      "validationStdout",
    ];

    for (const key of resultKeys) {
      appendParam(next, key, params[key]);
    }
  }

  return `/framework/new?${next.toString()}`;
};

const getFeatureValues = (value: string | string[] | undefined): FrameworkTemplateFeature[] => {
  const values = Array.isArray(value) ? value : value ? [value] : defaultFeatures;
  const allowed = new Set(featureOptions.map((option) => option.value));

  return values.filter((feature): feature is FrameworkTemplateFeature => allowed.has(feature as FrameworkTemplateFeature));
};

const getLastParamValue = (value: string | string[] | undefined) => (Array.isArray(value) ? value.at(-1) : value);

const getCheckedParam = (value: string | string[] | undefined, defaultValue: boolean) => {
  const lastValue = getLastParamValue(value);

  if (lastValue === undefined) {
    return defaultValue;
  }

  return lastValue === "true" || lastValue === "on";
};

const getDestinationType = (value: string | undefined): FrameworkTemplateDestinationType =>
  value === "github" ? "github" : "local";

const queryOutputLimit = 4_000;

const trimQueryOutput = (value: string) =>
  value.length > queryOutputLimit ? `${value.slice(0, queryOutputLimit)}\n... truncated ...` : value;

const getCheckedFormValue = (formData: FormData, name: string) => {
  const values = formData.getAll(name).map(String);
  const lastValue = values.at(-1);

  return lastValue === "true" || lastValue === "on";
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

const toCreateRequest = (formData: FormData): CreateFrameworkRequest => ({
  baseUrl: String(formData.get("baseUrl") ?? "").trim() || "https://example.com",
  createGithubRepository: getCheckedFormValue(formData, "createGithubRepository"),
  destinationType: getDestinationType(String(formData.get("destinationType") ?? "")),
  features: getFeatureValues(formData.getAll("features").map(String)),
  githubBranch: String(formData.get("githubBranch") ?? "").trim() || "main",
  githubOwner: String(formData.get("githubOwner") ?? "").trim(),
  githubRepositoryId: String(formData.get("githubRepositoryId") ?? "").trim(),
  githubRepository: String(formData.get("githubRepository") ?? "").trim(),
  initializeGitRepository: getCheckedFormValue(formData, "initializeGitRepository"),
  overwriteExisting: getCheckedFormValue(formData, "overwriteExisting"),
  packageName: String(formData.get("packageName") ?? "").trim() || "playwright-cucumber-tests",
  projectName: String(formData.get("projectName") ?? "").trim() || "Playwright Cucumber Tests",
  registerLocalRepository: getCheckedFormValue(formData, "registerLocalRepository"),
  targetDirectory: String(formData.get("targetDirectory") ?? "").trim() || "qa/e2e",
});

async function createFramework(formData: FormData) {
  "use server";

  const request = toCreateRequest(formData);
  const params = new URLSearchParams({
    baseUrl: request.baseUrl,
    createGithubRepository: String(request.createGithubRepository),
    destinationType: request.destinationType,
    githubBranch: request.githubBranch,
    githubOwner: request.githubOwner,
    githubRepositoryId: request.githubRepositoryId,
    githubRepository: request.githubRepository,
    initializeGitRepository: String(request.initializeGitRepository),
    packageName: request.packageName,
    preview: "true",
    projectName: request.projectName,
    registerLocalRepository: String(request.registerLocalRepository),
    step: "validate",
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
    if (result.githubPullRequest) {
      params.set("prBranch", result.githubPullRequest.branchName);
      params.set("prCommitSha", result.githubPullRequest.commitSha);
      params.set("prNumber", String(result.githubPullRequest.prNumber));
      params.set("prUrl", result.githubPullRequest.prUrl);
    }
    if (result.localGit) {
      params.set("localGitMessage", result.localGit.message);
      params.set("localGitStatus", result.localGit.status);
    }
    if (result.githubRemote) {
      params.set("githubRemoteMessage", result.githubRemote.message);
      params.set("githubRemoteStatus", result.githubRemote.status);
      if (result.githubRemote.remoteUrl) {
        params.set("githubRemoteUrl", result.githubRemote.remoteUrl);
      }
      if (result.githubRemote.repository) {
        params.set("githubRemoteRepository", result.githubRemote.repository);
      }
      if (result.githubRemote.webUrl) {
        params.set("githubRemoteWebUrl", result.githubRemote.webUrl);
      }
    }
    if (result.registeredRepository) {
      params.set("registeredRepositoryId", result.registeredRepository.id);
      params.set("registeredRepositoryName", `${result.registeredRepository.owner}/${result.registeredRepository.name}`);
    }
  } catch (error) {
    params.set("createError", error instanceof Error ? error.message : "Unable to create framework files.");
    params.set("step", "validate");
  }

  redirect(`/framework/new?${params.toString()}`);
}

async function installFrameworkDependencies(formData: FormData) {
  "use server";

  const params = new URLSearchParams();
  const passthroughKeys = [
    "baseUrl",
    "createGithubRepository",
    "created",
    "destinationType",
    "githubBranch",
    "githubOwner",
    "githubRemoteMessage",
    "githubRemoteRepository",
    "githubRemoteStatus",
    "githubRemoteUrl",
    "githubRemoteWebUrl",
    "githubRepository",
    "githubRepositoryId",
    "initializeGitRepository",
    "localGitMessage",
    "localGitStatus",
    "overwritten",
    "packageName",
    "preview",
    "projectName",
    "prBranch",
    "prCommitSha",
    "prNumber",
    "prUrl",
    "registeredRepositoryId",
    "registeredRepositoryName",
    "registerLocalRepository",
    "skipped",
    "targetDirectory",
  ];

  for (const key of passthroughKeys) {
    const value = formData.get(key);
    if (value) {
      params.set(key, String(value));
    }
  }

  for (const feature of formData.getAll("features")) {
    params.append("features", String(feature));
  }

  params.set("preview", "true");
  params.set("step", "validate");

  try {
    const response = await fetch(`${apiUrl}/frameworks/install-dependencies`, {
      body: JSON.stringify({
        targetDirectory: String(formData.get("targetDirectory") ?? ""),
      }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error((await response.text()) || "Unable to install framework dependencies.");
    }

    const result = (await response.json()) as FrameworkDependencyInstallResponse;
    params.set("installCommand", result.command);
    params.set("installDurationMs", String(result.durationMs));
    params.set("installMessage", result.message);
    params.set("installStatus", result.status);
    params.set("installStderr", trimQueryOutput(result.stderr));
    params.set("installStdout", trimQueryOutput(result.stdout));
    if (result.exitCode !== null) {
      params.set("installExitCode", String(result.exitCode));
    }
  } catch (error) {
    params.set("installMessage", error instanceof Error ? error.message : "Unable to install framework dependencies.");
    params.set("installStatus", "failed");
  }

  redirect(`/framework/new?${params.toString()}`);
}

async function validateFramework(formData: FormData) {
  "use server";

  const params = new URLSearchParams();
  const passthroughKeys = [
    "baseUrl",
    "createGithubRepository",
    "created",
    "destinationType",
    "githubBranch",
    "githubOwner",
    "githubRemoteMessage",
    "githubRemoteRepository",
    "githubRemoteStatus",
    "githubRemoteUrl",
    "githubRemoteWebUrl",
    "githubRepository",
    "githubRepositoryId",
    "initializeGitRepository",
    "installCommand",
    "installDurationMs",
    "installExitCode",
    "installMessage",
    "installStatus",
    "installStderr",
    "installStdout",
    "localGitMessage",
    "localGitStatus",
    "overwritten",
    "packageName",
    "preview",
    "projectName",
    "prBranch",
    "prCommitSha",
    "prNumber",
    "prUrl",
    "registeredRepositoryId",
    "registeredRepositoryName",
    "registerLocalRepository",
    "skipped",
    "targetDirectory",
  ];

  for (const key of passthroughKeys) {
    const value = formData.get(key);
    if (value) {
      params.set(key, String(value));
    }
  }

  for (const feature of formData.getAll("features")) {
    params.append("features", String(feature));
  }

  params.set("preview", "true");
  params.set("step", "validate");

  try {
    const response = await fetch(`${apiUrl}/frameworks/validate-smoke`, {
      body: JSON.stringify({
        targetDirectory: String(formData.get("targetDirectory") ?? ""),
      }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error((await response.text()) || "Unable to validate framework.");
    }

    const result = (await response.json()) as FrameworkSmokeValidationResponse;
    params.set("validationCommand", result.command);
    params.set("validationDurationMs", String(result.durationMs));
    params.set("validationMessage", result.message);
    params.set("validationStatus", result.status);
    params.set("validationStderr", trimQueryOutput(result.stderr));
    params.set("validationStdout", trimQueryOutput(result.stdout));
    if (result.exitCode !== null) {
      params.set("validationExitCode", String(result.exitCode));
    }
  } catch (error) {
    params.set("validationMessage", error instanceof Error ? error.message : "Unable to validate framework.");
    params.set("validationStatus", "failed");
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
  const createdCount = Number(params.created ?? 0);
  const skippedCount = Number(params.skipped ?? 0);
  const overwrittenCount = Number(params.overwritten ?? 0);
  const hasCreateResult = createdCount > 0 || skippedCount > 0 || overwrittenCount > 0;
  const currentStep = getWizardStep(params.step, hasCreateResult);
  const currentStepIndex = wizardStepOrder.indexOf(currentStep);
  const shouldPreview = params.preview === "true" || currentStep === "validate";
  const [{ error, preview }, repositories] = await Promise.all([
    shouldPreview
      ? getFrameworkPreview(request)
      : Promise.resolve({ error: null, preview: null }),
    getRepositories(),
  ]);
  const createCount = preview?.files.filter((file) => file.status === "create").length ?? 0;
  const existingCount = preview?.files.filter((file) => file.status === "exists").length ?? 0;
  const destinationLabel = request.destinationType === "github" ? "GitHub pull request" : "Local folder";
  const includedFeatureLabels = featureOptions
    .filter((option) => selectedFeatures.has(option.value))
    .map((option) => option.label);
  const shouldInitializeGit = getCheckedParam(params.initializeGitRepository, true);
  const shouldRegisterLocalRepository = getCheckedParam(params.registerLocalRepository, true);
  const shouldCreateGithubRepository = getCheckedParam(params.createGithubRepository, false);
  const nextStep: FrameworkWizardStep =
    currentStep === "framework"
      ? "local-git"
      : currentStep === "local-git"
        ? "github"
        : currentStep === "github"
          ? "register"
          : "validate";
  const previousStep: FrameworkWizardStep | null =
    currentStep === "local-git"
      ? "framework"
      : currentStep === "github"
        ? "local-git"
        : currentStep === "register"
          ? "github"
          : currentStep === "validate"
            ? "register"
            : null;
  const formSubmitLabel =
    currentStep === "framework"
      ? "Continue to Local Git"
      : currentStep === "local-git"
        ? "Continue to GitHub"
        : currentStep === "github"
          ? "Continue to Register"
          : "Review & Validate";
  const hiddenDestinationInputs =
    currentStep === "framework" ? null : (
      <>
        <input name="destinationType" type="hidden" value={request.destinationType} />
        <input name="targetDirectory" type="hidden" value={request.targetDirectory} />
      </>
    );
  const hiddenGithubInputs =
    currentStep === "github" ? null : (
      <>
        <input name="createGithubRepository" type="hidden" value={String(shouldCreateGithubRepository)} />
        <input name="githubBranch" type="hidden" value={request.githubBranch} />
        <input name="githubOwner" type="hidden" value={request.githubOwner} />
        <input name="githubRepositoryId" type="hidden" value={request.githubRepositoryId} />
        <input name="githubRepository" type="hidden" value={request.githubRepository} />
      </>
    );
  const hiddenBasicsInputs =
    currentStep === "framework" ? null : (
      <>
        <input name="baseUrl" type="hidden" value={request.baseUrl} />
        <input name="packageName" type="hidden" value={request.packageName} />
        <input name="projectName" type="hidden" value={request.projectName} />
      </>
    );
  const hiddenFeatureInputs =
    currentStep === "framework"
      ? null
      : request.features.map((feature) => <input key={feature} name="features" type="hidden" value={feature} />);
  const hiddenGitInput =
    currentStep === "local-git" ? null : (
      <input name="initializeGitRepository" type="hidden" value={String(shouldInitializeGit)} />
    );
  const hiddenRegisterInput =
    currentStep === "register" ? null : (
      <input name="registerLocalRepository" type="hidden" value={String(shouldRegisterLocalRepository)} />
    );

  return (
    <AppShell active="framework">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Create</p>
            <h1>Framework Builder</h1>
          </div>
        </header>

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
          <div className={`notice success framework-create-result ${params.prUrl ? "framework-pr-success" : ""}`}>
            <div>
              <strong>{params.prUrl ? "Framework pull request created" : "Framework files created"}</strong>
              <span>
                {createdCount} created, {overwrittenCount} overwritten, {skippedCount} skipped.
              </span>
              {params.prBranch || params.prCommitSha ? (
                <dl className="framework-pr-meta">
                  {params.prBranch ? (
                    <div>
                      <dt>Branch</dt>
                      <dd>{params.prBranch}</dd>
                    </div>
                  ) : null}
                  {params.prCommitSha ? (
                    <div>
                      <dt>Commit</dt>
                      <dd>{params.prCommitSha.slice(0, 12)}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              {params.registeredRepositoryId ? (
                <span>
                  Registered as{" "}
                  <a href={`/features?repositoryId=${params.registeredRepositoryId}`}>
                    {params.registeredRepositoryName ?? "new repository"}
                  </a>
                  .
                </span>
              ) : null}
            </div>
            {params.prUrl ? (
              <a className="primary-link" href={params.prUrl}>
                View PR #{params.prNumber}
              </a>
            ) : null}
          </div>
        ) : null}

        <nav aria-label="Framework builder steps" className="framework-wizard-steps">
          {wizardSteps.map((step, index) => {
            const isCurrent = step.value === currentStep;
            const isComplete = index < currentStepIndex || (step.value === "validate" && hasCreateResult);

            return (
              <a
                aria-current={isCurrent ? "step" : undefined}
                className={`${isCurrent ? "active" : ""} ${isComplete ? "complete" : ""}`}
                href={buildFrameworkHref(params, step.value)}
                key={step.value}
              >
                <span>{index + 1}</span>
                <strong>{step.label}</strong>
                <small>{step.description}</small>
              </a>
            );
          })}
        </nav>

        <section className="page-grid two-column framework-builder-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>
                  {currentStep === "framework"
                    ? "Create Local Framework"
                    : currentStep === "local-git"
                      ? "Create Local Git Repo"
                      : currentStep === "github"
                        ? "Create GitHub Project"
                        : currentStep === "register"
                          ? "Register in FF2"
                          : "Validate Framework"}
                </h2>
                <p>Build a usable automation project one pipeline step at a time.</p>
              </div>
            </div>

            {currentStep === "validate" ? (
              <div className="framework-step-placeholder">
                <p className="eyebrow">Step 5</p>
                <h3>{hasCreateResult ? "Framework creation is complete." : "Review, create, then validate."}</h3>
                <p>
                  {hasCreateResult
                    ? "Use the results and generated commands below to continue from the framework folder."
                    : "Create the local framework first. Dependency install and smoke-test execution will become a dedicated validation action next."}
                </p>
                {previousStep ? (
                  <a className="secondary-button" href={buildFrameworkHref(params, previousStep)}>
                    Back to Register
                  </a>
                ) : null}
              </div>
            ) : (
              <form className="job-form standalone-form" method="get">
                <input name="step" type="hidden" value={nextStep} />
                {currentStep === "register" ? <input name="preview" type="hidden" value="true" /> : null}
                {hiddenDestinationInputs}
                {hiddenGithubInputs}
                {hiddenBasicsInputs}
                {hiddenFeatureInputs}
                {hiddenGitInput}
                {hiddenRegisterInput}

                {currentStep === "framework" ? (
                  <section className="framework-wizard-section">
                    <div className="framework-wizard-section-header">
                      <span>1</span>
                      <div>
                        <h3>Framework Details</h3>
                        <p>Choose the folder, naming, base URL, and generated framework capabilities.</p>
                      </div>
                    </div>
                    <FrameworkFolderPicker
                      defaultDestinationType={request.destinationType}
                      defaultGithubBranch={request.githubBranch}
                      defaultGithubOwner={request.githubOwner}
                      defaultGithubRepositoryId={request.githubRepositoryId}
                      defaultGithubRepository={request.githubRepository}
                      defaultValue={request.targetDirectory}
                      repositories={repositories}
                    />
                    <div className="framework-basics-grid">
                      <label>
                        Project Name
                        <input name="projectName" defaultValue={request.projectName} required />
                      </label>
                      <label>
                        Package Name
                        <input name="packageName" defaultValue={request.packageName} required />
                      </label>
                      <label>
                        Base URL
                        <input name="baseUrl" defaultValue={request.baseUrl} required type="url" />
                      </label>
                    </div>
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
                  </section>
                ) : null}

                {currentStep === "local-git" ? (
                  <section className="framework-wizard-section">
                    <div className="framework-wizard-section-header">
                      <span>2</span>
                      <div>
                        <h3>Initialize Local Git</h3>
                        <p>After files are generated, FF2 can create the first local commit for the framework.</p>
                      </div>
                    </div>
                    <label className="framework-overwrite-option">
                      <input name="initializeGitRepository" type="hidden" value="false" />
                      <input defaultChecked={shouldInitializeGit} name="initializeGitRepository" type="checkbox" value="true" />
                      <span>
                        <strong>Initialize git repository</strong>
                        <small>Create a local git repo and initial commit after files are generated.</small>
                      </span>
                    </label>
                  </section>
                ) : null}

                {currentStep === "github" ? (
                  <section className="framework-wizard-section">
                    <div className="framework-wizard-section-header">
                      <span>3</span>
                      <div>
                        <h3>GitHub Project</h3>
                        <p>Create or connect a GitHub remote after the local project exists.</p>
                      </div>
                    </div>
                    <label className="framework-overwrite-option">
                      <input name="createGithubRepository" type="hidden" value="false" />
                      <input defaultChecked={shouldCreateGithubRepository} name="createGithubRepository" type="checkbox" value="true" />
                      <span>
                        <strong>Create GitHub repository</strong>
                        <small>Create a private GitHub repository, add it as origin, and push the initial branch.</small>
                      </span>
                    </label>
                    <div className="framework-basics-grid">
                      <label>
                        Owner
                        <input name="githubOwner" defaultValue={request.githubOwner} placeholder="rgmichaels" />
                      </label>
                      <label>
                        Repository
                        <input
                          name="githubRepository"
                          defaultValue={request.githubRepository}
                          placeholder={request.packageName.replace(/^@[^/]+\//, "")}
                        />
                      </label>
                      <label>
                        Initial Branch
                        <input name="githubBranch" defaultValue={request.githubBranch} placeholder="main" />
                      </label>
                    </div>
                    <div className="framework-pipeline-note">
                      <strong>Optional</strong>
                      <p>Leave this off to keep the generated framework local. Existing remote connection is still a later slice.</p>
                    </div>
                  </section>
                ) : null}

                {currentStep === "register" ? (
                  <section className="framework-wizard-section">
                    <div className="framework-wizard-section-header">
                      <span>4</span>
                      <div>
                        <h3>Track This Framework in FF2</h3>
                        <p>Register the generated local folder so Features, Discover, and Jobs can use it immediately.</p>
                      </div>
                    </div>
                    <label className="framework-overwrite-option">
                      <input name="registerLocalRepository" type="hidden" value="false" />
                      <input defaultChecked={shouldRegisterLocalRepository} name="registerLocalRepository" type="checkbox" value="true" />
                      <span>
                        <strong>Register in FF2</strong>
                        <small>Add this generated folder to Repositories after files are created.</small>
                      </span>
                    </label>
                  </section>
                ) : null}

                <div className="framework-wizard-actions">
                  {previousStep ? (
                    <a className="secondary-button" href={buildFrameworkHref(params, previousStep)}>
                      Back
                    </a>
                  ) : null}
                  <button type="submit">{formSubmitLabel}</button>
                </div>
              </form>
            )}
          </section>

          <aside className="panel framework-builder-summary">
            <div className="panel-header">
              <div>
                <h2>Build Plan</h2>
                <p>Current choices before preview and creation.</p>
              </div>
            </div>
            <dl className="framework-plan-list">
              <div>
                <dt>Destination</dt>
                <dd>{destinationLabel}</dd>
              </div>
              <div>
                <dt>Target</dt>
                <dd>{request.destinationType === "github" ? `${request.githubOwner}/${request.githubRepository}` : request.targetDirectory}</dd>
              </div>
              <div>
                <dt>Base URL</dt>
                <dd>{request.baseUrl}</dd>
              </div>
              <div>
                <dt>Capabilities</dt>
                <dd>{includedFeatureLabels.join(", ") || "None selected"}</dd>
              </div>
              <div>
                <dt>Local Git</dt>
                <dd>{shouldInitializeGit ? "Initialize after file creation" : "Skip git initialization"}</dd>
              </div>
              <div>
                <dt>GitHub</dt>
                <dd>
                  {shouldCreateGithubRepository
                    ? `Create ${request.githubOwner || "authenticated user"}/${request.githubRepository || request.packageName.replace(/^@[^/]+\//, "")}`
                    : "Keep local only"}
                </dd>
              </div>
              <div>
                <dt>FF2 Registration</dt>
                <dd>{shouldRegisterLocalRepository ? "Register generated repository" : "Do not register automatically"}</dd>
              </div>
            </dl>
            <section className="framework-roadmap">
              <h3>Pipeline Progress</h3>
              <ol className="framework-pipeline-list">
                <li className="ready">
                  <strong>Framework</strong>
                  <span>Generate Playwright, TypeScript, Cucumber files.</span>
                </li>
                <li className={shouldInitializeGit ? "ready" : "muted"}>
                  <strong>Local Git</strong>
                  <span>{shouldInitializeGit ? "Initialize repo and commit generated files." : "Skipped by current plan."}</span>
                </li>
                <li className="future">
                  <strong>GitHub</strong>
                  <span>{shouldCreateGithubRepository ? "Create private remote and push initial branch." : "Skipped by current plan."}</span>
                </li>
                <li className={shouldRegisterLocalRepository ? "ready" : "muted"}>
                  <strong>Register</strong>
                  <span>{shouldRegisterLocalRepository ? "Add generated repo to FF2." : "Skipped by current plan."}</span>
                </li>
                <li className="future">
                  <strong>Validate</strong>
                  <span>Install dependencies and run the sample smoke test.</span>
                </li>
              </ol>
            </section>
          </aside>
        </section>

        {preview && currentStep === "validate" ? (
          <section className="panel framework-preview">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Step 5</p>
                <h2>{hasCreateResult ? "Results & Next Steps" : "Review & Create"}</h2>
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

            {hasCreateResult ? (
              <section className="framework-results-panel">
                <div>
                  <strong>{params.prUrl ? "Pull request is ready for review." : "Files are ready locally."}</strong>
                  <span>
                    {createdCount} created, {overwrittenCount} overwritten, {skippedCount} skipped.
                  </span>
                  {params.localGitStatus ? (
                    <span>
                      Git: {params.localGitStatus.replace(/_/g, " ")}. {params.localGitMessage}
                    </span>
                  ) : null}
                  {params.githubRemoteStatus ? (
                    <span>
                      GitHub: {params.githubRemoteStatus.replace(/_/g, " ")}. {params.githubRemoteMessage}
                    </span>
                  ) : null}
                </div>
                <div className="framework-wizard-actions">
                  {request.destinationType === "local" ? (
                    <>
                      <form action={installFrameworkDependencies} className="framework-inline-action-form">
                        <input name="baseUrl" type="hidden" value={request.baseUrl} />
                        <input name="createGithubRepository" type="hidden" value={String(shouldCreateGithubRepository)} />
                        <input name="created" type="hidden" value={String(createdCount)} />
                        <input name="destinationType" type="hidden" value={request.destinationType} />
                        <input name="githubBranch" type="hidden" value={request.githubBranch} />
                        <input name="githubOwner" type="hidden" value={request.githubOwner} />
                        <input name="githubRepositoryId" type="hidden" value={request.githubRepositoryId} />
                        <input name="githubRepository" type="hidden" value={request.githubRepository} />
                        <input name="initializeGitRepository" type="hidden" value={String(shouldInitializeGit)} />
                        <input name="overwritten" type="hidden" value={String(overwrittenCount)} />
                        <input name="packageName" type="hidden" value={request.packageName} />
                        <input name="projectName" type="hidden" value={request.projectName} />
                        <input name="registerLocalRepository" type="hidden" value={String(shouldRegisterLocalRepository)} />
                        <input name="skipped" type="hidden" value={String(skippedCount)} />
                        <input name="targetDirectory" type="hidden" value={request.targetDirectory} />
                        {params.githubRemoteMessage ? (
                          <input name="githubRemoteMessage" type="hidden" value={params.githubRemoteMessage} />
                        ) : null}
                        {params.githubRemoteRepository ? (
                          <input name="githubRemoteRepository" type="hidden" value={params.githubRemoteRepository} />
                        ) : null}
                        {params.githubRemoteStatus ? (
                          <input name="githubRemoteStatus" type="hidden" value={params.githubRemoteStatus} />
                        ) : null}
                        {params.githubRemoteUrl ? (
                          <input name="githubRemoteUrl" type="hidden" value={params.githubRemoteUrl} />
                        ) : null}
                        {params.githubRemoteWebUrl ? (
                          <input name="githubRemoteWebUrl" type="hidden" value={params.githubRemoteWebUrl} />
                        ) : null}
                        {params.localGitMessage ? <input name="localGitMessage" type="hidden" value={params.localGitMessage} /> : null}
                        {params.localGitStatus ? <input name="localGitStatus" type="hidden" value={params.localGitStatus} /> : null}
                        {params.registeredRepositoryId ? (
                          <input name="registeredRepositoryId" type="hidden" value={params.registeredRepositoryId} />
                        ) : null}
                        {params.registeredRepositoryName ? (
                          <input name="registeredRepositoryName" type="hidden" value={params.registeredRepositoryName} />
                        ) : null}
                        {request.features.map((feature) => (
                          <input key={feature} name="features" type="hidden" value={feature} />
                        ))}
                        <button type="submit">Install Dependencies</button>
                      </form>
                      <form action={validateFramework} className="framework-inline-action-form">
                        <input name="baseUrl" type="hidden" value={request.baseUrl} />
                        <input name="createGithubRepository" type="hidden" value={String(shouldCreateGithubRepository)} />
                        <input name="created" type="hidden" value={String(createdCount)} />
                        <input name="destinationType" type="hidden" value={request.destinationType} />
                        <input name="githubBranch" type="hidden" value={request.githubBranch} />
                        <input name="githubOwner" type="hidden" value={request.githubOwner} />
                        <input name="githubRepositoryId" type="hidden" value={request.githubRepositoryId} />
                        <input name="githubRepository" type="hidden" value={request.githubRepository} />
                        <input name="initializeGitRepository" type="hidden" value={String(shouldInitializeGit)} />
                        <input name="overwritten" type="hidden" value={String(overwrittenCount)} />
                        <input name="packageName" type="hidden" value={request.packageName} />
                        <input name="projectName" type="hidden" value={request.projectName} />
                        <input name="registerLocalRepository" type="hidden" value={String(shouldRegisterLocalRepository)} />
                        <input name="skipped" type="hidden" value={String(skippedCount)} />
                        <input name="targetDirectory" type="hidden" value={request.targetDirectory} />
                        {params.githubRemoteMessage ? (
                          <input name="githubRemoteMessage" type="hidden" value={params.githubRemoteMessage} />
                        ) : null}
                        {params.githubRemoteRepository ? (
                          <input name="githubRemoteRepository" type="hidden" value={params.githubRemoteRepository} />
                        ) : null}
                        {params.githubRemoteStatus ? (
                          <input name="githubRemoteStatus" type="hidden" value={params.githubRemoteStatus} />
                        ) : null}
                        {params.githubRemoteUrl ? (
                          <input name="githubRemoteUrl" type="hidden" value={params.githubRemoteUrl} />
                        ) : null}
                        {params.githubRemoteWebUrl ? (
                          <input name="githubRemoteWebUrl" type="hidden" value={params.githubRemoteWebUrl} />
                        ) : null}
                        {params.installCommand ? <input name="installCommand" type="hidden" value={params.installCommand} /> : null}
                        {params.installDurationMs ? (
                          <input name="installDurationMs" type="hidden" value={params.installDurationMs} />
                        ) : null}
                        {params.installExitCode ? <input name="installExitCode" type="hidden" value={params.installExitCode} /> : null}
                        {params.installMessage ? <input name="installMessage" type="hidden" value={params.installMessage} /> : null}
                        {params.installStatus ? <input name="installStatus" type="hidden" value={params.installStatus} /> : null}
                        {params.installStderr ? <input name="installStderr" type="hidden" value={params.installStderr} /> : null}
                        {params.installStdout ? <input name="installStdout" type="hidden" value={params.installStdout} /> : null}
                        {params.localGitMessage ? <input name="localGitMessage" type="hidden" value={params.localGitMessage} /> : null}
                        {params.localGitStatus ? <input name="localGitStatus" type="hidden" value={params.localGitStatus} /> : null}
                        {params.registeredRepositoryId ? (
                          <input name="registeredRepositoryId" type="hidden" value={params.registeredRepositoryId} />
                        ) : null}
                        {params.registeredRepositoryName ? (
                          <input name="registeredRepositoryName" type="hidden" value={params.registeredRepositoryName} />
                        ) : null}
                        {request.features.map((feature) => (
                          <input key={feature} name="features" type="hidden" value={feature} />
                        ))}
                        <button type="submit">Run Smoke Validation</button>
                      </form>
                    </>
                  ) : null}
                  {params.githubRemoteWebUrl ? (
                    <a className="primary-link" href={params.githubRemoteWebUrl}>
                      Open GitHub Repo
                    </a>
                  ) : null}
                  {params.prUrl ? (
                    <a className="primary-link" href={params.prUrl}>
                      Open Pull Request
                    </a>
                  ) : null}
                  {params.registeredRepositoryId ? (
                    <a className="secondary-button" href={`/features?repositoryId=${params.registeredRepositoryId}`}>
                      Open Feature Catalog
                    </a>
                  ) : null}
                </div>
              </section>
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
                    <small>
                      {request.destinationType === "github"
                        ? "Leave unchecked to skip files that already exist in the target branch."
                        : "Leave unchecked to create missing files and skip conflicts."}
                    </small>
                  </span>
                </label>
                {request.destinationType === "local" ? (
                  <>
                    <label className="framework-overwrite-option">
                      <input defaultChecked={shouldInitializeGit} name="initializeGitRepository" type="checkbox" />
                      <span>
                        <strong>Initialize git repository</strong>
                        <small>Create a local git repo and initial commit after files are generated.</small>
                      </span>
                    </label>
                    <label className="framework-overwrite-option">
                      <input defaultChecked={shouldCreateGithubRepository} name="createGithubRepository" type="checkbox" />
                      <span>
                        <strong>Create GitHub repository</strong>
                        <small>Create a private remote, add origin, and push the initial branch.</small>
                      </span>
                    </label>
                    <label className="framework-overwrite-option">
                      <input defaultChecked={shouldRegisterLocalRepository} name="registerLocalRepository" type="checkbox" />
                      <span>
                        <strong>Register in FF2</strong>
                        <small>Add this generated folder to Repositories after files are created.</small>
                      </span>
                    </label>
                  </>
                ) : null}
                <div className="framework-create-actions">
                  <a className="secondary-button" href={buildFrameworkHref(params, "register")}>
                    Back
                  </a>
                  <button type="submit">
                    {request.destinationType === "github" ? "Create Pull Request" : "Create from Target Directory"}
                  </button>
                </div>
              </form>
            )}

            {hasCreateResult && params.installStatus ? (
              <section className={`framework-validation-panel ${params.installStatus}`}>
                <div className="framework-validation-summary">
                  <span>{params.installStatus}</span>
                  <div>
                    <strong>{params.installMessage ?? "Dependency install finished."}</strong>
                    <small>
                      {params.installCommand ?? "pnpm install"}
                      {params.installExitCode ? ` · exit ${params.installExitCode}` : ""}
                      {params.installDurationMs ? ` · ${params.installDurationMs}ms` : ""}
                    </small>
                  </div>
                </div>
                {params.installStdout || params.installStderr ? (
                  <div className="framework-validation-output">
                    {params.installStdout ? (
                      <div>
                        <strong>stdout</strong>
                        <pre>{params.installStdout}</pre>
                      </div>
                    ) : null}
                    {params.installStderr ? (
                      <div>
                        <strong>stderr</strong>
                        <pre>{params.installStderr}</pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {hasCreateResult && params.validationStatus ? (
              <section className={`framework-validation-panel ${params.validationStatus}`}>
                <div className="framework-validation-summary">
                  <span>{params.validationStatus}</span>
                  <div>
                    <strong>{params.validationMessage ?? "Validation finished."}</strong>
                    <small>
                      {params.validationCommand ?? "pnpm test:smoke"}
                      {params.validationExitCode ? ` · exit ${params.validationExitCode}` : ""}
                      {params.validationDurationMs ? ` · ${params.validationDurationMs}ms` : ""}
                    </small>
                  </div>
                </div>
                {params.validationStdout || params.validationStderr ? (
                  <div className="framework-validation-output">
                    {params.validationStdout ? (
                      <div>
                        <strong>stdout</strong>
                        <pre>{params.validationStdout}</pre>
                      </div>
                    ) : null}
                    {params.validationStderr ? (
                      <div>
                        <strong>stderr</strong>
                        <pre>{params.validationStderr}</pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

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
