import {
  frameworkDependencyInstallResponseSchema,
  frameworkOpenFolderResponseSchema,
  frameworkSmokeValidationResponseSchema,
  type CreateFrameworkRequest,
  type CreateFrameworkResponse,
  type CreateRepositoryRequest,
  type FrameworkBuildResponse,
  type FrameworkDependencyInstallResponse,
  type FrameworkOpenFolderResponse,
  type FrameworkSmokeValidationResponse,
  type FrameworkTemplateDestinationType,
  type FrameworkTemplateFeature,
  type FrameworkTemplatePreviewResponse,
  type FrameworkTemplateRequest,
  type RepositoryResponse,
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
  frameworkBuildId?: string;
  localGitMessage?: string;
  localGitStatus?: string;
  openFolderDurationMs?: string;
  openFolderMessage?: string;
  openFolderStatus?: string;
  prBranch?: string;
  prCommitSha?: string;
  prNumber?: string;
  prUrl?: string;
  registeredRepositoryId?: string;
  registeredRepositoryName?: string;
  registerLocalRepository?: string | string[];
  registrationMessage?: string;
  registrationStatus?: string;
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

const frameworkActionPassthroughKeys: Array<keyof FrameworkNewSearchParams> = [
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
  "frameworkBuildId",
  "localGitMessage",
  "localGitStatus",
  "openFolderDurationMs",
  "openFolderMessage",
  "openFolderStatus",
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
  "registrationMessage",
  "registrationStatus",
  "skipped",
  "targetDirectory",
  "validationCommand",
  "validationDurationMs",
  "validationExitCode",
  "validationMessage",
  "validationStatus",
  "validationStderr",
  "validationStdout",
];

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
    for (const key of frameworkActionPassthroughKeys) {
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

const slugValue = (value: string, fallback: string) => {
  const slug = value
    .trim()
    .replace(/^@/, "")
    .replace(/\//g, "-")
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || fallback;
};

const getCheckedFormValue = (formData: FormData, name: string) => {
  const values = formData.getAll(name).map(String);
  const lastValue = values.at(-1);

  return lastValue === "true" || lastValue === "on";
};

const formatFrameworkBuildDate = (value: string) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const buildFrameworkResultHref = (buildId: string) => `/framework/new?frameworkBuildId=${buildId}&preview=true&step=validate`;

const appendFrameworkActionState = (params: URLSearchParams, formData: FormData) => {
  for (const key of frameworkActionPassthroughKeys) {
    const value = formData.get(key);
    if (value) {
      params.set(key, String(value));
    }
  }

  for (const feature of formData.getAll("features")) {
    params.append("features", String(feature));
  }
};

function FrameworkActionHiddenFields({
  createdCount,
  overwrittenCount,
  overrides,
  params,
  request,
  skippedCount,
}: {
  createdCount: number;
  overwrittenCount: number;
  overrides?: Partial<Record<keyof FrameworkNewSearchParams, string>>;
  params: FrameworkNewSearchParams;
  request: FrameworkTemplateRequest;
  skippedCount: number;
}) {
  const values: Partial<Record<keyof FrameworkNewSearchParams, string>> = {
    baseUrl: request.baseUrl,
    createGithubRepository: String(getCheckedParam(params.createGithubRepository, false)),
    created: String(createdCount),
    destinationType: request.destinationType,
    githubBranch: request.githubBranch,
    githubOwner: request.githubOwner,
    githubRemoteMessage: params.githubRemoteMessage,
    githubRemoteRepository: params.githubRemoteRepository,
    githubRemoteStatus: params.githubRemoteStatus,
    githubRemoteUrl: params.githubRemoteUrl,
    githubRemoteWebUrl: params.githubRemoteWebUrl,
    githubRepository: request.githubRepository,
    githubRepositoryId: request.githubRepositoryId,
    initializeGitRepository: String(getCheckedParam(params.initializeGitRepository, true)),
    installCommand: params.installCommand,
    installDurationMs: params.installDurationMs,
    installExitCode: params.installExitCode,
    installMessage: params.installMessage,
    installStatus: params.installStatus,
    installStderr: params.installStderr,
    installStdout: params.installStdout,
    frameworkBuildId: params.frameworkBuildId,
    localGitMessage: params.localGitMessage,
    localGitStatus: params.localGitStatus,
    openFolderDurationMs: params.openFolderDurationMs,
    openFolderMessage: params.openFolderMessage,
    openFolderStatus: params.openFolderStatus,
    overwritten: String(overwrittenCount),
    packageName: request.packageName,
    preview: "true",
    projectName: request.projectName,
    prBranch: params.prBranch,
    prCommitSha: params.prCommitSha,
    prNumber: params.prNumber,
    prUrl: params.prUrl,
    registeredRepositoryId: params.registeredRepositoryId,
    registeredRepositoryName: params.registeredRepositoryName,
    registerLocalRepository: String(getCheckedParam(params.registerLocalRepository, true)),
    registrationMessage: params.registrationMessage,
    registrationStatus: params.registrationStatus,
    skipped: String(skippedCount),
    targetDirectory: request.targetDirectory,
    validationCommand: params.validationCommand,
    validationDurationMs: params.validationDurationMs,
    validationExitCode: params.validationExitCode,
    validationMessage: params.validationMessage,
    validationStatus: params.validationStatus,
    validationStderr: params.validationStderr,
    validationStdout: params.validationStdout,
    ...overrides,
  };

  return (
    <>
      {frameworkActionPassthroughKeys.map((key) => {
        const value = values[key];

        return value ? <input key={key} name={key} type="hidden" value={value} /> : null;
      })}
      {request.features.map((feature) => (
        <input key={feature} name="features" type="hidden" value={feature} />
      ))}
    </>
  );
}

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

async function getFrameworkBuilds(): Promise<FrameworkBuildResponse[]> {
  try {
    const response = await fetch(`${apiUrl}/frameworks/builds`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return [];
    }

    return response.json() as Promise<FrameworkBuildResponse[]>;
  } catch {
    return [];
  }
}

async function getFrameworkBuild(id: string | undefined): Promise<FrameworkBuildResponse | null> {
  if (!id) {
    return null;
  }

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

const parseFrameworkInstallResult = (value: unknown): FrameworkDependencyInstallResponse | null => {
  const result = frameworkDependencyInstallResponseSchema.safeParse(value);

  return result.success ? result.data : null;
};

const parseFrameworkOpenFolderResult = (value: unknown): FrameworkOpenFolderResponse | null => {
  const result = frameworkOpenFolderResponseSchema.safeParse(value);

  return result.success ? result.data : null;
};

const parseFrameworkSmokeResult = (value: unknown): FrameworkSmokeValidationResponse | null => {
  const result = frameworkSmokeValidationResponseSchema.safeParse(value);

  return result.success ? result.data : null;
};

const buildPreviewRequest = (
  params: FrameworkNewSearchParams,
  savedBuild?: FrameworkBuildResponse | null,
): FrameworkTemplateRequest => ({
  baseUrl: params.baseUrl?.trim() || savedBuild?.baseUrl || "https://example.com",
  destinationType: getDestinationType(params.destinationType ?? savedBuild?.destinationType),
  features: getFeatureValues(params.features),
  githubBranch: params.githubBranch?.trim() || savedBuild?.targetBranch || "main",
  githubOwner: params.githubOwner?.trim() || savedBuild?.githubOwner || "",
  githubRepositoryId: params.githubRepositoryId?.trim() || "",
  githubRepository: params.githubRepository?.trim() || savedBuild?.githubRepository || "",
  packageName: params.packageName?.trim() || savedBuild?.packageName || "playwright-cucumber-tests",
  projectName: params.projectName?.trim() || savedBuild?.projectName || "Playwright Cucumber Tests",
  targetDirectory:
    params.targetDirectory?.trim() ||
    savedBuild?.targetDirectory ||
    (params.destinationType === "github" || savedBuild?.destinationType === "github" ? "." : "qa/e2e"),
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
    if (result.buildRecord) {
      params.set("frameworkBuildId", result.buildRecord.id);
    }
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
  appendFrameworkActionState(params, formData);

  params.set("preview", "true");
  params.set("step", "validate");

  try {
    const response = await fetch(`${apiUrl}/frameworks/install-dependencies`, {
      body: JSON.stringify({
        frameworkBuildId: String(formData.get("frameworkBuildId") ?? "") || undefined,
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

async function openGeneratedFrameworkFolder(formData: FormData) {
  "use server";

  const params = new URLSearchParams();
  appendFrameworkActionState(params, formData);

  params.set("preview", "true");
  params.set("step", "validate");

  try {
    const response = await fetch(`${apiUrl}/frameworks/open-folder`, {
      body: JSON.stringify({
        frameworkBuildId: String(formData.get("frameworkBuildId") ?? "") || undefined,
        targetDirectory: String(formData.get("targetDirectory") ?? ""),
      }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error((await response.text()) || "Unable to open generated framework folder.");
    }

    const result = (await response.json()) as FrameworkOpenFolderResponse;
    params.set("openFolderDurationMs", String(result.durationMs));
    params.set("openFolderMessage", result.message);
    params.set("openFolderStatus", result.status);
  } catch (error) {
    params.set("openFolderMessage", error instanceof Error ? error.message : "Unable to open generated framework folder.");
    params.set("openFolderStatus", "failed");
  }

  redirect(`/framework/new?${params.toString()}`);
}

async function registerGeneratedFramework(formData: FormData) {
  "use server";

  const params = new URLSearchParams();
  appendFrameworkActionState(params, formData);

  params.set("preview", "true");
  params.set("step", "validate");

  const packageName = String(formData.get("packageName") ?? "").trim();
  const targetDirectory = String(formData.get("targetDirectory") ?? "").trim();
  const payload: CreateRepositoryRequest = {
    defaultBranch: String(formData.get("githubBranch") ?? "").trim() || "main",
    localPath: targetDirectory,
    name: slugValue(packageName.split("/").at(-1) ?? packageName, "generated-framework"),
    owner: "local",
    provider: "GITHUB",
    validationCommand: "pnpm test",
  };

  try {
    const response = await fetch(`${apiUrl}/repositories`, {
      body: JSON.stringify(payload),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error((await response.text()) || "Unable to register generated framework.");
    }

    const repository = (await response.json()) as RepositoryResponse;
    params.set("registeredRepositoryId", repository.id);
    params.set("registeredRepositoryName", `${repository.owner}/${repository.name}`);
    params.set("registrationMessage", "Generated framework registered in FF2.");
    params.set("registrationStatus", "registered");
  } catch (error) {
    params.set("registrationMessage", error instanceof Error ? error.message : "Unable to register generated framework.");
    params.set("registrationStatus", "failed");
  }

  redirect(`/framework/new?${params.toString()}`);
}

async function validateFramework(formData: FormData) {
  "use server";

  const params = new URLSearchParams();
  appendFrameworkActionState(params, formData);

  params.set("preview", "true");
  params.set("step", "validate");

  try {
    const response = await fetch(`${apiUrl}/frameworks/validate-smoke`, {
      body: JSON.stringify({
        frameworkBuildId: String(formData.get("frameworkBuildId") ?? "") || undefined,
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
  const frameworkBuildId = getLastParamValue(params.frameworkBuildId);
  const savedBuild = await getFrameworkBuild(frameworkBuildId);
  const request = buildPreviewRequest(params, savedBuild);
  const selectedFeatures = new Set(request.features);
  const hasCreateResultFromQuery =
    Number(params.created ?? 0) > 0 || Number(params.skipped ?? 0) > 0 || Number(params.overwritten ?? 0) > 0;
  const hasSavedCreateResult = Boolean(savedBuild);
  const currentStep = getWizardStep(params.step, hasCreateResultFromQuery || hasSavedCreateResult);
  const currentStepIndex = wizardStepOrder.indexOf(currentStep);
  const shouldPreview = params.preview === "true" || currentStep === "validate";
  const [{ error, preview }, repositories, frameworkBuilds] = await Promise.all([
    shouldPreview
      ? getFrameworkPreview(request)
      : Promise.resolve({ error: null, preview: null }),
    getRepositories(),
    getFrameworkBuilds(),
  ]);
  const createdCount = Number(params.created ?? savedBuild?.createdFileCount ?? 0);
  const skippedCount = Number(params.skipped ?? savedBuild?.skippedFileCount ?? 0);
  const overwrittenCount = Number(params.overwritten ?? savedBuild?.overwrittenFileCount ?? 0);
  const hasCreateResult = hasCreateResultFromQuery || Boolean(savedBuild) || createdCount > 0 || skippedCount > 0 || overwrittenCount > 0;
  const savedInstallResult = parseFrameworkInstallResult(savedBuild?.installResult);
  const savedOpenFolderResult = parseFrameworkOpenFolderResult(savedBuild?.openFolderResult);
  const savedValidationResult = parseFrameworkSmokeResult(savedBuild?.smokeValidationResult);
  const openFolderStatus = params.openFolderStatus ?? savedOpenFolderResult?.status ?? savedBuild?.openFolderStatus ?? undefined;
  const openFolderMessage = params.openFolderMessage ?? savedOpenFolderResult?.message;
  const openFolderDurationMs =
    params.openFolderDurationMs ?? (savedOpenFolderResult ? String(savedOpenFolderResult.durationMs) : undefined);
  const installStatus = params.installStatus ?? savedInstallResult?.status ?? savedBuild?.installStatus ?? undefined;
  const installCommand = params.installCommand ?? savedInstallResult?.command;
  const installDurationMs = params.installDurationMs ?? (savedInstallResult ? String(savedInstallResult.durationMs) : undefined);
  const installExitCode =
    params.installExitCode ?? (savedInstallResult?.exitCode !== null && savedInstallResult?.exitCode !== undefined
      ? String(savedInstallResult.exitCode)
      : undefined);
  const installMessage = params.installMessage ?? savedInstallResult?.message;
  const installStderr = params.installStderr ?? savedInstallResult?.stderr;
  const installStdout = params.installStdout ?? savedInstallResult?.stdout;
  const validationStatus = params.validationStatus ?? savedValidationResult?.status ?? savedBuild?.smokeValidationStatus ?? undefined;
  const validationCommand = params.validationCommand ?? savedValidationResult?.command;
  const validationDurationMs =
    params.validationDurationMs ?? (savedValidationResult ? String(savedValidationResult.durationMs) : undefined);
  const validationExitCode =
    params.validationExitCode ?? (savedValidationResult?.exitCode !== null && savedValidationResult?.exitCode !== undefined
      ? String(savedValidationResult.exitCode)
      : undefined);
  const validationMessage = params.validationMessage ?? savedValidationResult?.message;
  const validationStderr = params.validationStderr ?? savedValidationResult?.stderr;
  const validationStdout = params.validationStdout ?? savedValidationResult?.stdout;
  const latestFrameworkBuild = frameworkBuilds.at(0);
  const latestFrameworkBuildIsCurrent = Boolean(frameworkBuildId && latestFrameworkBuild?.id === frameworkBuildId);
  const createCount = preview?.files.filter((file) => file.status === "create").length ?? 0;
  const existingCount = preview?.files.filter((file) => file.status === "exists").length ?? 0;
  const destinationLabel = request.destinationType === "github" ? "GitHub pull request" : "Local folder";
  const includedFeatureLabels = featureOptions
    .filter((option) => selectedFeatures.has(option.value))
    .map((option) => option.label);
  const shouldInitializeGit = getCheckedParam(params.initializeGitRepository, true);
  const shouldRegisterLocalRepository = getCheckedParam(params.registerLocalRepository, true);
  const shouldCreateGithubRepository = getCheckedParam(params.createGithubRepository, false);
  const localGitStatus = (params.localGitStatus ?? savedBuild?.localGitStatus ?? undefined)?.replace(/_/g, " ");
  const githubRemoteStatus = (params.githubRemoteStatus ?? savedBuild?.githubRemoteStatus ?? undefined)?.replace(/_/g, " ");
  const registeredRepositoryId = params.registeredRepositoryId ?? savedBuild?.registeredRepositoryId ?? undefined;
  const registeredRepositoryName =
    params.registeredRepositoryName ?? (registeredRepositoryId ? `Repository ${registeredRepositoryId.slice(0, 8)}` : undefined);
  const recommendedNextAction =
    !hasCreateResult
      ? "Create the framework files to unlock install, validation, and registration actions."
      : request.destinationType === "local" && !openFolderStatus
        ? "Open the generated folder and inspect the files that were created."
        : !installStatus
          ? "Install dependencies so the generated framework can run locally."
          : installStatus !== "installed"
            ? "Review the dependency install output before running smoke validation."
            : !validationStatus
              ? "Run smoke validation to prove the generated sample test works."
              : validationStatus !== "passed"
                ? "Review the smoke validation output before using this framework."
                : shouldRegisterLocalRepository && !registeredRepositoryId
                  ? "Register this framework in FF2 so Features, Discover, and Jobs can use it."
                  : "Framework is ready for the next setup slice.";
  const pipelineSteps = [
    {
      detail: hasCreateResult
        ? `${createdCount} created, ${overwrittenCount} overwritten, ${skippedCount} skipped.`
        : "Generate the framework files first.",
      label: "Framework files",
      state: hasCreateResult ? "complete" : "pending",
      status: hasCreateResult ? "Complete" : "Pending",
    },
    {
      detail: shouldInitializeGit
        ? params.localGitMessage || "Create a local git repo and initial framework commit."
        : "Skipped by current plan.",
      label: "Local git repo",
      state: shouldInitializeGit ? (params.localGitStatus ? "complete" : "pending") : "skipped",
      status: shouldInitializeGit ? localGitStatus || "Pending" : "Skipped",
    },
    {
      detail:
        request.destinationType === "github"
          ? params.prUrl || "Create a pull request in the selected GitHub repository."
          : shouldCreateGithubRepository
            ? params.githubRemoteMessage || "Create a GitHub repository and push the generated framework."
            : "Skipped by current plan.",
      label: request.destinationType === "github" ? "GitHub pull request" : "GitHub repository",
      state:
        request.destinationType === "github"
          ? params.prUrl
            ? "complete"
            : "pending"
          : shouldCreateGithubRepository
            ? params.githubRemoteStatus === "failed"
              ? "attention"
              : params.githubRemoteStatus
                ? "complete"
                : "pending"
            : "skipped",
      status:
        request.destinationType === "github"
          ? params.prUrl
            ? `PR #${params.prNumber ?? ""}`.trim()
            : "Pending"
          : shouldCreateGithubRepository
            ? githubRemoteStatus || "Pending"
            : "Skipped",
    },
    {
      detail: shouldRegisterLocalRepository
        ? params.registrationMessage || registeredRepositoryName || "Register the generated local folder so FF2 can use it."
        : "Skipped by current plan.",
      label: "FF2 registration",
      state: shouldRegisterLocalRepository
        ? registeredRepositoryId
          ? "complete"
          : params.registrationStatus === "failed"
            ? "attention"
            : "pending"
        : "skipped",
      status: shouldRegisterLocalRepository
        ? registeredRepositoryId
          ? "Registered"
          : params.registrationStatus ?? "Pending"
        : "Skipped",
    },
    {
      detail: installMessage || "Run pnpm install from the generated framework folder.",
      label: "Dependencies",
      state:
        installStatus === "installed"
          ? "complete"
          : installStatus === "failed" || installStatus === "skipped"
            ? "attention"
            : "pending",
      status: installStatus ?? "Pending",
    },
    {
      detail: validationMessage || "Run the generated sample smoke test.",
      label: "Smoke validation",
      state:
        validationStatus === "passed"
          ? "complete"
          : validationStatus === "failed" || validationStatus === "skipped"
            ? "attention"
            : "pending",
      status: validationStatus ?? "Pending",
    },
  ];
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
              {registeredRepositoryId ? (
                <span>
                  Registered as{" "}
                  <a href={`/features?repositoryId=${registeredRepositoryId}`}>
                    {registeredRepositoryName ?? "new repository"}
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
              <section className="framework-results-panel framework-results-checklist-panel">
                <div className="framework-results-heading">
                  <strong>{params.prUrl ? "Pull request is ready for review." : "Framework action center"}</strong>
                  <span>
                    {recommendedNextAction}
                    {frameworkBuildId ? ` Saved build ${frameworkBuildId.slice(0, 8)}.` : ""}
                  </span>
                </div>
                <div className="framework-results-hero">
                  <div>
                    <span>Created</span>
                    <strong>{createdCount}</strong>
                  </div>
                  <div>
                    <span>Overwritten</span>
                    <strong>{overwrittenCount}</strong>
                  </div>
                  <div>
                    <span>Skipped</span>
                    <strong>{skippedCount}</strong>
                  </div>
                  <div>
                    <span>Target</span>
                    <strong>{request.targetDirectory}</strong>
                  </div>
                </div>
                <ol className="framework-results-checklist">
                  {pipelineSteps.map((step) => (
                    <li className={step.state} key={step.label}>
                      <span aria-hidden="true" className="framework-results-checkmark">
                        {step.state === "complete" ? "OK" : step.state === "attention" ? "!" : step.state === "skipped" ? "SKIP" : ""}
                      </span>
                      <div>
                        <strong>{step.label}</strong>
                        <small>{step.detail}</small>
                      </div>
                      <mark>{step.status}</mark>
                    </li>
                  ))}
                </ol>
                <dl className="framework-generated-repo-card">
                  <div>
                    <dt>Generated framework</dt>
                    <dd>{request.projectName}</dd>
                  </div>
                  <div>
                    <dt>Local path</dt>
                    <dd>{request.targetDirectory}</dd>
                  </div>
                  <div>
                    <dt>FF2 repository</dt>
                    <dd>{registeredRepositoryName ?? "Not registered"}</dd>
                  </div>
                </dl>
                <div className="framework-build-shortcuts">
                  <div>
                    <strong>Build history</strong>
                    <span>
                      {frameworkBuildId
                        ? `Current build ${frameworkBuildId.slice(0, 8)} is available for detailed review.`
                        : "Save a framework build to reopen results and action output later."}
                    </span>
                  </div>
                  <nav aria-label="Framework build shortcuts">
                    {frameworkBuildId ? (
                      <>
                        <a className="secondary-button" href={`/framework/builds/${frameworkBuildId}`}>
                          Current Details
                        </a>
                        <a className="secondary-button" href={buildFrameworkResultHref(frameworkBuildId)}>
                          Reopen Current
                        </a>
                      </>
                    ) : null}
                    {latestFrameworkBuild && !latestFrameworkBuildIsCurrent ? (
                      <a className="secondary-button" href={buildFrameworkResultHref(latestFrameworkBuild.id)}>
                        Reopen Latest
                      </a>
                    ) : null}
                    <a className="secondary-button" href="/framework/builds">
                      All Builds
                    </a>
                  </nav>
                  {latestFrameworkBuild ? (
                    <small>
                      Latest: {latestFrameworkBuild.projectName} · {formatFrameworkBuildDate(latestFrameworkBuild.createdAt)}
                    </small>
                  ) : null}
                </div>
                <div className={`framework-smoke-result-card ${validationStatus ?? "pending"}`}>
                  <div className="framework-smoke-result-summary">
                    <span>{validationStatus ?? "not run"}</span>
                    <div>
                      <strong>{validationMessage ?? "Smoke validation has not run yet."}</strong>
                      <small>
                        {validationCommand ?? "pnpm test:smoke"}
                        {validationExitCode !== undefined ? ` · exit ${validationExitCode}` : ""}
                        {validationDurationMs ? ` · ${validationDurationMs}ms` : ""}
                      </small>
                    </div>
                  </div>
                  <div className="framework-smoke-result-actions">
                    {(validationStdout || validationStderr) && frameworkBuildId ? (
                      <a className="secondary-button" href={`/framework/builds/${frameworkBuildId}`}>
                        View Output
                      </a>
                    ) : null}
                    {request.destinationType === "local" ? (
                      <form action={validateFramework} className="framework-inline-action-form">
                        <FrameworkActionHiddenFields
                          createdCount={createdCount}
                          overwrittenCount={overwrittenCount}
                          params={params}
                          request={request}
                          skippedCount={skippedCount}
                        />
                        <button type="submit">{validationStatus ? "Rerun Smoke" : "Run Smoke"}</button>
                      </form>
                    ) : null}
                  </div>
                  {validationStdout || validationStderr ? (
                    <details className="framework-smoke-output-preview">
                      <summary>Preview smoke output</summary>
                      {validationStdout ? (
                        <div>
                          <strong>stdout</strong>
                          <pre>{validationStdout}</pre>
                        </div>
                      ) : null}
                      {validationStderr ? (
                        <div>
                          <strong>stderr</strong>
                          <pre>{validationStderr}</pre>
                        </div>
                      ) : null}
                    </details>
                  ) : null}
                </div>
                {openFolderStatus ? (
                  <div className={`framework-folder-open-status ${openFolderStatus}`}>
                    <strong>{openFolderStatus}</strong>
                    <span>
                      {openFolderMessage ?? "Folder action finished."}
                      {openFolderDurationMs ? ` (${openFolderDurationMs}ms)` : ""}
                    </span>
                  </div>
                ) : null}
                <div className="framework-action-center">
                  {request.destinationType === "local" ? (
                    <>
                      <article className="framework-action-card">
                        <div>
                          <strong>Inspect Files</strong>
                          <span>Open the generated framework folder locally.</span>
                        </div>
                        <form action={openGeneratedFrameworkFolder} className="framework-inline-action-form">
                          <FrameworkActionHiddenFields
                            createdCount={createdCount}
                            overwrittenCount={overwrittenCount}
                            params={params}
                            request={request}
                            skippedCount={skippedCount}
                          />
                          <button type="submit">Open Folder</button>
                        </form>
                      </article>
                      <article className="framework-action-card">
                        <div>
                          <strong>Install Dependencies</strong>
                          <span>Run <code>pnpm install</code> in the framework folder.</span>
                        </div>
                        <form action={installFrameworkDependencies} className="framework-inline-action-form">
                          <FrameworkActionHiddenFields
                            createdCount={createdCount}
                            overwrittenCount={overwrittenCount}
                            params={params}
                            request={request}
                            skippedCount={skippedCount}
                          />
                          <button type="submit">Install</button>
                        </form>
                      </article>
                      <article className="framework-action-card">
                        <div>
                          <strong>Smoke Validation</strong>
                          <span>
                            {validationStatus
                              ? "Smoke result is summarized above. Rerun it after local edits."
                              : "Run the generated sample Cucumber smoke test."}
                          </span>
                        </div>
                        <form action={validateFramework} className="framework-inline-action-form">
                          <FrameworkActionHiddenFields
                            createdCount={createdCount}
                            overwrittenCount={overwrittenCount}
                            params={params}
                            request={request}
                            skippedCount={skippedCount}
                          />
                          <button type="submit">{validationStatus ? "Rerun Smoke" : "Run Smoke"}</button>
                        </form>
                      </article>
                    </>
                  ) : null}
                  {params.githubRemoteWebUrl ? (
                    <article className="framework-action-card">
                      <div>
                        <strong>GitHub Repository</strong>
                        <span>Open the remote project created for this framework.</span>
                      </div>
                      <a className="primary-link" href={params.githubRemoteWebUrl}>
                        Open Repo
                      </a>
                    </article>
                  ) : null}
                  {params.prUrl ? (
                    <article className="framework-action-card">
                      <div>
                        <strong>Pull Request</strong>
                        <span>Review the generated framework changes in GitHub.</span>
                      </div>
                      <a className="primary-link" href={params.prUrl}>
                        Open PR
                      </a>
                    </article>
                  ) : null}
                  {registeredRepositoryId ? (
                    <>
                      <article className="framework-action-card">
                        <div>
                          <strong>FF2 Repository</strong>
                          <span>Manage how this generated framework is tracked.</span>
                        </div>
                        <a className="secondary-button" href="/repositories">
                          Settings
                        </a>
                      </article>
                      <article className="framework-action-card">
                        <div>
                          <strong>Feature Catalog</strong>
                          <span>Open parsed Cucumber features for this framework.</span>
                        </div>
                        <a className="secondary-button" href={`/features?repositoryId=${registeredRepositoryId}`}>
                          Open Catalog
                        </a>
                      </article>
                    </>
                  ) : request.destinationType === "local" ? (
                    <article className="framework-action-card">
                      <div>
                        <strong>Register in FF2</strong>
                        <span>Add this local folder to the repository catalog.</span>
                      </div>
                      <form action={registerGeneratedFramework} className="framework-inline-action-form">
                        <FrameworkActionHiddenFields
                          createdCount={createdCount}
                          overwrittenCount={overwrittenCount}
                          overrides={{
                            registerLocalRepository: "true",
                          }}
                          params={params}
                          request={request}
                          skippedCount={skippedCount}
                        />
                        <button type="submit">Register</button>
                      </form>
                    </article>
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

            {hasCreateResult && installStatus ? (
              <section className={`framework-validation-panel ${installStatus}`}>
                <div className="framework-validation-summary">
                  <span>{installStatus}</span>
                  <div>
                    <strong>{installMessage ?? "Dependency install finished."}</strong>
                    <small>
                      {installCommand ?? "pnpm install"}
                      {installExitCode !== undefined ? ` · exit ${installExitCode}` : ""}
                      {installDurationMs ? ` · ${installDurationMs}ms` : ""}
                    </small>
                  </div>
                </div>
                {installStdout || installStderr ? (
                  <div className="framework-validation-output">
                    {installStdout ? (
                      <div>
                        <strong>stdout</strong>
                        <pre>{installStdout}</pre>
                      </div>
                    ) : null}
                    {installStderr ? (
                      <div>
                        <strong>stderr</strong>
                        <pre>{installStderr}</pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {hasCreateResult && validationStatus ? (
              <section className={`framework-validation-panel ${validationStatus}`}>
                <div className="framework-validation-summary">
                  <span>{validationStatus}</span>
                  <div>
                    <strong>{validationMessage ?? "Validation finished."}</strong>
                    <small>
                      {validationCommand ?? "pnpm test:smoke"}
                      {validationExitCode !== undefined ? ` · exit ${validationExitCode}` : ""}
                      {validationDurationMs ? ` · ${validationDurationMs}ms` : ""}
                    </small>
                  </div>
                </div>
                {validationStdout || validationStderr ? (
                  <div className="framework-validation-output">
                    {validationStdout ? (
                      <div>
                        <strong>stdout</strong>
                        <pre>{validationStdout}</pre>
                      </div>
                    ) : null}
                    {validationStderr ? (
                      <div>
                        <strong>stderr</strong>
                        <pre>{validationStderr}</pre>
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

        <section className="panel framework-build-history">
          <div className="panel-header">
            <div>
              <h2>Recent Framework Builds</h2>
              <p>Reopen recent framework creation results without recreating files.</p>
            </div>
            <a className="secondary-button" href="/framework/builds">
              View all
            </a>
          </div>
          {frameworkBuilds.length > 0 ? (
            <div className="framework-build-history-list">
              {frameworkBuilds.map((build) => (
                <article key={build.id} className="framework-build-history-card">
                  <div>
                    <a href={`/framework/builds/${build.id}`}>{build.projectName}</a>
                    <span>
                      {build.packageName} · {build.destinationType === "github" ? "GitHub" : "Local"} ·{" "}
                      {formatFrameworkBuildDate(build.createdAt)}
                    </span>
                    <code>{build.targetDirectory}</code>
                  </div>
                  <dl>
                    <div>
                      <dt>Created</dt>
                      <dd>{build.createdFileCount}</dd>
                    </div>
                    <div>
                      <dt>Overwritten</dt>
                      <dd>{build.overwrittenFileCount}</dd>
                    </div>
                    <div>
                      <dt>Skipped</dt>
                      <dd>{build.skippedFileCount}</dd>
                    </div>
                    <div>
                      <dt>Git</dt>
                      <dd>{build.localGitStatus?.replace(/_/g, " ") ?? "not tracked"}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          ) : (
            <p className="framework-build-history-empty">No framework builds have been saved yet.</p>
          )}
        </section>
      </section>
    </AppShell>
  );
}
