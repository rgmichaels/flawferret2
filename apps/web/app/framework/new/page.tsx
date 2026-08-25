import {
  frameworkDependencyInstallResponseSchema,
  frameworkOpenFolderResponseSchema,
  frameworkSmokeValidationResponseSchema,
  type CreateFrameworkRequest,
  type CreateFrameworkResponse,
  type CreateRepositoryRequest,
  type FrameworkBuildResponse,
  type FrameworkDependencyInstallResponse,
  type FrameworkGithubRepositoryVisibility,
  type FrameworkOpenFolderResponse,
  type FrameworkSmokeValidationResponse,
  type FrameworkTemplateFeature,
  type FrameworkTemplatePreviewResponse,
  type FrameworkTemplateRequest,
  type RepositoryResponse,
} from "@flawferret2/job-schemas";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "../../app-shell";
import { FrameworkAutoRunToggle } from "./framework-auto-run-toggle";
import { FrameworkBuilderForm } from "./framework-builder-form";
import { FrameworkFilePreviewDetails } from "./framework-file-preview-details";
import { FrameworkFilesPreview } from "./framework-files-preview";
import { FrameworkFolderPicker } from "./framework-folder-picker";
import { FrameworkGithubPushToggle } from "./framework-github-push-toggle";
import { getDestinationType, parseApiErrorMessage, toNpmPackageName } from "./framework-request-utils";
import { formatPostBuildActions } from "./post-build-summary";

// Nothing other than the default export may be exported from this module. A named re-export here
// ("export { toNpmPackageName } from ...") stopped Next from registering this file's server actions
// at all, so every form on this page failed at submit with "Server Action ... was not found on the
// server" (FLW-14/FLW-15). Shared helpers belong in framework-request-utils.ts.

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
  autoRunDependenciesAndSmoke?: string | string[];
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
  githubRepositoryVisibility?: string;
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
  targetDirectory?: string;
  validationCommand?: string;
  validationDurationMs?: string;
  validationExitCode?: string;
  validationMessage?: string;
  validationStatus?: string;
  validationStderr?: string;
  validationStdout?: string;
};

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
  "githubRepositoryVisibility",
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

const getGithubRepositoryVisibility = (value: string | undefined): FrameworkGithubRepositoryVisibility =>
  value === "public" ? "public" : "private";

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

const buildFrameworkResultHref = (buildId: string) => `/framework/new?frameworkBuildId=${buildId}&preview=true`;

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
    githubRepositoryVisibility: params.githubRepositoryVisibility,
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

function FrameworkActionResultCard({
  actions,
  command,
  durationMs,
  exitCode,
  message,
  outputLabel = "Preview output",
  status,
  stderr,
  stdout,
}: {
  actions?: ReactNode;
  command: string;
  durationMs?: string;
  exitCode?: string;
  message: string;
  outputLabel?: string;
  status?: string;
  stderr?: string;
  stdout?: string;
}) {
  const displayStatus = status ?? "not run";
  const hasOutput = Boolean(stdout || stderr);

  return (
    <div className={`framework-action-result-card ${status ?? "pending"}`}>
      <div className="framework-action-result-summary">
        <span>{displayStatus}</span>
        <div>
          <strong>{message}</strong>
          <small>
            {command}
            {exitCode !== undefined ? ` · exit ${exitCode}` : ""}
            {durationMs ? ` · ${durationMs}ms` : ""}
          </small>
          <details className="framework-command-copy">
            <summary>Copy command</summary>
            <code>{command}</code>
          </details>
        </div>
      </div>
      {actions ? <div className="framework-action-result-actions">{actions}</div> : null}
      {hasOutput ? (
        <details className="framework-action-output-preview">
          <summary>{outputLabel}</summary>
          {stdout ? (
            <div>
              <strong>stdout</strong>
              <pre>{stdout}</pre>
            </div>
          ) : null}
          {stderr ? (
            <div>
              <strong>stderr</strong>
              <pre>{stderr}</pre>
            </div>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function FrameworkInlineActionOutput({
  actions,
  command,
  durationMs,
  exitCode,
  outputLabel,
  stderr,
  stdout,
  suggestedFix,
}: {
  actions?: ReactNode;
  command: string;
  durationMs?: string;
  exitCode?: string;
  outputLabel: string;
  stderr?: string;
  stdout?: string;
  suggestedFix?: string | null;
}) {
  const hasOutput = Boolean(stdout || stderr);

  return (
    <div className="framework-row-action-output">
      <div>
        <strong>Command</strong>
        <small>
          {command}
          {exitCode !== undefined ? ` · exit ${exitCode}` : ""}
          {durationMs ? ` · ${durationMs}ms` : ""}
        </small>
      </div>
      {suggestedFix ? (
        <div className="framework-row-suggested-fix">
          <strong>Try this</strong>
          <small>{suggestedFix}</small>
        </div>
      ) : null}
      <details className="framework-command-copy">
        <summary>Copy command</summary>
        <code>{command}</code>
      </details>
      {hasOutput ? (
        <details className="framework-action-output-preview">
          <summary>{outputLabel}</summary>
          {stdout ? (
            <div>
              <strong>stdout</strong>
              <pre>{stdout}</pre>
            </div>
          ) : null}
          {stderr ? (
            <div>
              <strong>stderr</strong>
              <pre>{stderr}</pre>
            </div>
          ) : null}
        </details>
      ) : null}
      {actions ? <div className="framework-row-action-output-actions">{actions}</div> : null}
    </div>
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

const outputContains = (pattern: RegExp, ...values: Array<string | undefined>) =>
  values.some((value) => Boolean(value && pattern.test(value)));

const getInstallDisplayStatus = (status: string | undefined, message: string | undefined, stdout: string | undefined, stderr: string | undefined) => {
  if (!status) {
    return "Pending";
  }

  if (status === "installed") {
    return "Installed";
  }

  if (outputContains(/ERR_PNPM_IGNORED_BUILDS|pnpm approve-builds/i, message, stdout, stderr)) {
    return "Needs approval";
  }

  if (status === "skipped") {
    return "Skipped";
  }

  return "Failed";
};

const getInstallDiagnosis = ({
  message,
  status,
  stderr,
  stdout,
}: {
  message?: string;
  status?: string;
  stderr?: string;
  stdout?: string;
}) => {
  if (!status || status === "installed") {
    return null;
  }

  if (outputContains(/pnpm: command not found|spawn pnpm ENOENT|env: pnpm/i, message, stdout, stderr)) {
    return "pnpm is not available to the process running this command. Install dependencies from FF2's action button, or install pnpm locally before running the generated framework by hand.";
  }

  if (outputContains(/Cannot find matching keyid|corepack/i, message, stdout, stderr)) {
    return "Corepack could not activate pnpm on this machine. Use the FF2 install action, or install pnpm with a user-writable npm prefix instead of the system Node location.";
  }

  if (outputContains(/EACCES|permission denied|\/usr\/local/i, message, stdout, stderr)) {
    return "The install tried to write somewhere your user cannot modify. Avoid global installs under /usr/local, or use a user-writable npm/pnpm location.";
  }

  if (outputContains(/ERR_PNPM_IGNORED_BUILDS|pnpm approve-builds/i, message, stdout, stderr)) {
    return "pnpm blocked a dependency build script. Retry Install; FF2 will approve required builds and rerun dependency installation.";
  }

  if (outputContains(/Executable doesn't exist|playwright install|browserType\.launch|chromium/i, message, stdout, stderr)) {
    return "Playwright browsers are missing. Retry Install so FF2 can run the Chromium browser install step.";
  }

  if (outputContains(/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|registry\.npmjs/i, message, stdout, stderr)) {
    return "The package install could not reach the registry or network target. Check network access, then retry Install.";
  }

  return "Review the install output below, fix the local environment issue, then retry Install.";
};

const getSmokeDisplayStatus = (status: string | undefined) => {
  if (!status) {
    return "Pending";
  }

  if (status === "passed") {
    return "Passed";
  }

  if (status === "skipped") {
    return "Blocked";
  }

  return "Failed";
};

const toManualFrameworkCommand = (command: string) =>
  command
    .replace(/^pnpm install && pnpm exec playwright install chromium$/, "npx pnpm@11.7.0 install && npx pnpm@11.7.0 exec playwright install chromium")
    .replace(/^pnpm test:smoke$/, "npx pnpm@11.7.0 test:smoke")
    .replace(/^pnpm test$/, "npx pnpm@11.7.0 test");

const getSmokeDiagnosis = ({
  installStatus,
  message,
  status,
  stderr,
  stdout,
}: {
  installStatus?: string;
  message?: string;
  status?: string;
  stderr?: string;
  stdout?: string;
}) => {
  if (!status && installStatus !== "installed") {
    return "Install dependencies and Chromium before running smoke validation.";
  }

  if (!status) {
    return "Run the generated sample smoke test.";
  }

  if (status === "passed") {
    return message || "Generated smoke test passed.";
  }

  if (status === "skipped") {
    return message || "Smoke validation is blocked until dependencies are installed.";
  }

  if (outputContains(/Executable doesn't exist|playwright install|browserType\.launch/i, message, stdout, stderr)) {
    return "Smoke failed because the Playwright browser is missing. Retry Install to install Chromium.";
  }

  if (outputContains(/Undefined\. Implement|undefined step|\\bUUU\\b/i, message, stdout, stderr)) {
    return "Smoke failed because Cucumber could not match one or more generated step definitions.";
  }

  if (outputContains(/expect\\(received\\)|assertion|AssertionError|toBe|toHave/i, message, stdout, stderr)) {
    return "Smoke failed on an assertion. Review the output to see which expectation failed.";
  }

  if (outputContains(/net::|ERR_|Timeout|navigation|goto|BASE_URL|ENOTFOUND|ECONNREFUSED/i, message, stdout, stderr)) {
    return "Smoke failed while opening the configured base URL. Check the URL and network accessibility.";
  }

  return message || "Generated smoke test failed. Review the output for details.";
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
  packageName: toNpmPackageName(
    params.packageName?.trim() ||
      savedBuild?.packageName ||
      params.projectName?.trim() ||
      savedBuild?.projectName ||
      "",
    "playwright-cucumber-tests",
  ),
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
        error: parseApiErrorMessage(text, "Unable to preview framework."),
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
  autoRunDependenciesAndSmoke: getCheckedFormValue(formData, "autoRunDependenciesAndSmoke"),
  baseUrl: String(formData.get("baseUrl") ?? "").trim() || "https://example.com",
  createGithubRepository: getCheckedFormValue(formData, "createGithubRepository"),
  destinationType: getDestinationType(String(formData.get("destinationType") ?? "")),
  features: getFeatureValues(formData.getAll("features").map(String)),
  githubBranch: String(formData.get("githubBranch") ?? "").trim() || "main",
  githubOwner: String(formData.get("githubOwner") ?? "").trim(),
  githubRepositoryId: String(formData.get("githubRepositoryId") ?? "").trim(),
  githubRepository: String(formData.get("githubRepository") ?? "").trim(),
  githubRepositoryVisibility: getGithubRepositoryVisibility(String(formData.get("githubRepositoryVisibility") ?? "")),
  initializeGitRepository: getCheckedFormValue(formData, "initializeGitRepository"),
  overwriteExisting: getCheckedFormValue(formData, "overwriteExisting"),
  packageName: toNpmPackageName(String(formData.get("packageName") ?? "").trim(), "playwright-cucumber-tests"),
  projectName: String(formData.get("projectName") ?? "").trim() || "Playwright Cucumber Tests",
  registerLocalRepository: getCheckedFormValue(formData, "registerLocalRepository"),
  targetDirectory: String(formData.get("targetDirectory") ?? "").trim() || "qa/e2e",
});

type FrameworkActionTarget = {
  frameworkBuildId: string | undefined;
  targetDirectory: string;
};

// Dependency install and smoke validation are shared by two callers: their own manual buttons on
// the results checklist, and the auto-run chain inside createFramework. Both write the same result
// params so the checklist renders identically no matter which path produced them. Neither helper
// throws — a failed auto-run must never take the framework build itself down with it.
const runFrameworkDependencyInstall = async (params: URLSearchParams, target: FrameworkActionTarget): Promise<string> => {
  try {
    const response = await fetch(`${apiUrl}/frameworks/install-dependencies`, {
      body: JSON.stringify({
        frameworkBuildId: target.frameworkBuildId,
        targetDirectory: target.targetDirectory,
      }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(parseApiErrorMessage(await response.text(), "Unable to install framework dependencies."));
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

    return result.status;
  } catch (error) {
    params.set("installMessage", error instanceof Error ? error.message : "Unable to install framework dependencies.");
    params.set("installStatus", "failed");

    return "failed";
  }
};

const runFrameworkSmokeValidation = async (params: URLSearchParams, target: FrameworkActionTarget): Promise<void> => {
  try {
    const response = await fetch(`${apiUrl}/frameworks/validate-smoke`, {
      body: JSON.stringify({
        frameworkBuildId: target.frameworkBuildId,
        targetDirectory: target.targetDirectory,
      }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(parseApiErrorMessage(await response.text(), "Unable to validate framework."));
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
};

const toFrameworkActionTarget = (formData: FormData): FrameworkActionTarget => ({
  frameworkBuildId: String(formData.get("frameworkBuildId") ?? "") || undefined,
  targetDirectory: String(formData.get("targetDirectory") ?? ""),
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
    githubRepositoryVisibility: request.githubRepositoryVisibility,
    initializeGitRepository: String(request.initializeGitRepository),
    packageName: request.packageName,
    preview: "true",
    projectName: request.projectName,
    registerLocalRepository: String(request.registerLocalRepository),
    targetDirectory: request.targetDirectory,
  });

  for (const feature of request.features) {
    params.append("features", feature);
  }

  let autoRunTarget: FrameworkActionTarget | null = null;

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
      throw new Error(parseApiErrorMessage(await response.text(), "Unable to create framework files."));
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

    if (request.destinationType === "local" && request.autoRunDependenciesAndSmoke) {
      autoRunTarget = {
        frameworkBuildId: result.buildRecord?.id,
        targetDirectory: request.targetDirectory,
      };
    }
  } catch (error) {
    params.set("createError", error instanceof Error ? error.message : "Unable to create framework files.");
  }

  // Chained outside the try/catch above so an install/smoke problem can never be reported as a
  // create failure. Smoke only runs after a successful install, mirroring the manual flow's
  // canRunSmoke gating; otherwise Dependencies lands in "attention" and Smoke stays pending.
  if (autoRunTarget) {
    const installStatus = await runFrameworkDependencyInstall(params, autoRunTarget);

    if (installStatus === "installed") {
      await runFrameworkSmokeValidation(params, autoRunTarget);
    }
  }

  redirect(`/framework/new?${params.toString()}`);
}

async function installFrameworkDependencies(formData: FormData) {
  "use server";

  const params = new URLSearchParams();
  appendFrameworkActionState(params, formData);

  params.set("preview", "true");

  await runFrameworkDependencyInstall(params, toFrameworkActionTarget(formData));

  redirect(`/framework/new?${params.toString()}`);
}

async function openGeneratedFrameworkFolder(formData: FormData) {
  "use server";

  const params = new URLSearchParams();
  appendFrameworkActionState(params, formData);

  params.set("preview", "true");

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
      throw new Error(parseApiErrorMessage(await response.text(), "Unable to open generated framework folder."));
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
      throw new Error(parseApiErrorMessage(await response.text(), "Unable to register generated framework."));
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

  await runFrameworkSmokeValidation(params, toFrameworkActionTarget(formData));

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
  // The build form and the file-count/conflict preview now live on the same page (no more
  // "validate" wizard step to gate this on), so the preview is always fetched.
  const [{ error, preview }, repositories, frameworkBuilds] = await Promise.all([
    getFrameworkPreview(request),
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
  const installDisplayStatus = getInstallDisplayStatus(installStatus, installMessage, installStdout, installStderr);
  const installDiagnosis = getInstallDiagnosis({
    message: installMessage,
    status: installStatus,
    stderr: installStderr,
    stdout: installStdout,
  });
  const smokeDisplayStatus = getSmokeDisplayStatus(validationStatus);
  const smokeDiagnosis = getSmokeDiagnosis({
    installStatus,
    message: validationMessage,
    status: validationStatus,
    stderr: validationStderr,
    stdout: validationStdout,
  });
  const canRunSmoke = request.destinationType === "local" && installStatus === "installed";
  const latestFrameworkBuild = frameworkBuilds.at(0);
  const latestFrameworkBuildIsCurrent = Boolean(frameworkBuildId && latestFrameworkBuild?.id === frameworkBuildId);
  const createCount = preview?.files.filter((file) => file.status === "create").length ?? 0;
  const existingCount = preview?.files.filter((file) => file.status === "exists").length ?? 0;
  const shouldInitializeGit = getCheckedParam(params.initializeGitRepository, true);
  const shouldRegisterLocalRepository = getCheckedParam(params.registerLocalRepository, true);
  const shouldCreateGithubRepository = getCheckedParam(params.createGithubRepository, false);
  const githubRepositoryVisibility = getGithubRepositoryVisibility(params.githubRepositoryVisibility);
  const shouldAutoRunDependenciesAndSmoke = getCheckedParam(params.autoRunDependenciesAndSmoke, true);
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
  const pipelineSteps: Array<{
    action?: "install" | "smoke";
    detail: string;
    label: string;
    state: "attention" | "complete" | "pending" | "skipped";
    status: string;
  }> = [
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
      action: request.destinationType === "local" ? "install" : undefined,
      detail: installMessage || "Install package dependencies, approve pnpm build scripts when needed, and install Chromium.",
      label: "Dependencies",
      state:
        installStatus === "installed"
          ? "complete"
          : installStatus === "failed" || installStatus === "skipped"
            ? "attention"
            : "pending",
      status: installDisplayStatus,
    },
    {
      action: request.destinationType === "local" ? "smoke" : undefined,
      detail: smokeDiagnosis,
      label: "Smoke validation",
      state:
        validationStatus === "passed"
          ? "complete"
          : validationStatus === "failed" || validationStatus === "skipped"
            ? "attention"
            : "pending",
      status: smokeDisplayStatus,
    },
  ];

  return (
    <AppShell active="framework">
      {/* framework-builder-page scopes this route's --font-display override — see styles.css. */}
      <section className="workspace framework-builder-page">
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

        <section className="page-grid framework-builder-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Framework Builder</h2>
                <p>Set the destination, naming, included capabilities, and post-build actions, then build.</p>
              </div>
            </div>

            {hasCreateResult ? (
              <div className="framework-step-placeholder">
                <h3>Framework creation is complete.</h3>
                <p>Use the results and generated commands below to continue from the framework folder.</p>
              </div>
            ) : (
              <FrameworkBuilderForm
                action={createFramework}
                className="job-form standalone-form framework-builder-form"
                initialDestinationType={request.destinationType}
              >
                <section className="framework-section">
                  <div className="framework-section-label">
                    <h5>Where</h5>
                    <p>Folder or GitHub repo.</p>
                  </div>
                  <div className="framework-section-body">
                    <FrameworkFolderPicker
                      defaultCreateGithubRepository={shouldCreateGithubRepository}
                      defaultGithubBranch={request.githubBranch}
                      defaultGithubOwner={request.githubOwner}
                      defaultGithubRepositoryId={request.githubRepositoryId}
                      defaultGithubRepository={request.githubRepository}
                      defaultGithubRepositoryVisibility={githubRepositoryVisibility}
                      defaultValue={request.targetDirectory}
                      packageName={request.packageName}
                      repositories={repositories}
                    />
                  </div>
                </section>

                <section className="framework-section">
                  <div className="framework-section-label">
                    <h5>Naming</h5>
                    <p>What the generated project is called, and what it points at.</p>
                  </div>
                  <div className="framework-section-body">
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
                  </div>
                </section>

                <section className="framework-section">
                  <div className="framework-section-label">
                    <h5>Include</h5>
                    <p>Capabilities generated into the new framework.</p>
                  </div>
                  <div className="framework-section-body">
                    <fieldset className="framework-chips">
                      <legend className="framework-field-label">Include</legend>
                      {/* Real checkboxes, kept for keyboard/screen-reader semantics and only
                          visually hidden; the checked state is carried by a fill *and* a checkmark
                          glyph so it never depends on color alone. Each feature's longer
                          description moves to the chip's title rather than being dropped. */}
                      <div className="framework-chip-row">
                        {featureOptions.map((option) => (
                          <label key={option.value} className="framework-chip" title={option.description}>
                            <input
                              defaultChecked={selectedFeatures.has(option.value)}
                              name="features"
                              type="checkbox"
                              value={option.value}
                            />
                            <span aria-hidden="true" className="framework-chip-mark" />
                            <span className="framework-chip-text">{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </div>
                </section>

                <section className="framework-section">
                  <div className="framework-section-label">
                    <h5>After building</h5>
                    <p>What FF2 does once the files are generated.</p>
                  </div>
                  <div className="framework-section-body">
                    <label className="framework-overwrite-option">
                      <input name="initializeGitRepository" type="hidden" value="false" />
                      <input defaultChecked={shouldInitializeGit} name="initializeGitRepository" type="checkbox" value="true" />
                      <span>
                        <strong>Initialize git repository</strong>
                        <small>Create a local git repo and initial commit after files are generated.</small>
                      </span>
                    </label>
                    <FrameworkGithubPushToggle
                      githubBranch={request.githubBranch}
                      githubOwner={request.githubOwner}
                      githubRepository={request.githubRepository}
                      packageName={request.packageName}
                      shouldCreateGithubRepository={shouldCreateGithubRepository}
                    />
                    <label className="framework-overwrite-option">
                      <input name="registerLocalRepository" type="hidden" value="false" />
                      <input defaultChecked={shouldRegisterLocalRepository} name="registerLocalRepository" type="checkbox" value="true" />
                      <span>
                        <strong>Register in FF2</strong>
                        <small>Add this generated folder to Repositories after files are created.</small>
                      </span>
                    </label>
                    <FrameworkAutoRunToggle shouldAutoRun={shouldAutoRunDependenciesAndSmoke} />
                  </div>
                </section>

                <FrameworkFilesPreview
                  initialError={error}
                  initialPostBuildActions={formatPostBuildActions({
                    createGithubRepository: shouldCreateGithubRepository,
                    initializeGitRepository: shouldInitializeGit,
                    registerLocalRepository: shouldRegisterLocalRepository,
                  })}
                  initialPreview={preview}
                  initialRequest={request}
                />
              </FrameworkBuilderForm>
            )}
          </section>
        </section>

        {preview && hasCreateResult ? (
          <section className="panel framework-preview">
            <div className="panel-header">
              <div>
                <h2>Results & Next Steps</h2>
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
                      {step.action === "install" ? (
                        <form action={installFrameworkDependencies} className="framework-inline-action-form">
                          <FrameworkActionHiddenFields
                            createdCount={createdCount}
                            overwrittenCount={overwrittenCount}
                            params={params}
                            request={request}
                            skippedCount={skippedCount}
                          />
                          <button className="framework-row-primary-action" type="submit">
                            {installStatus === "installed" ? "Reinstall" : installStatus ? "Retry Install" : "Install Dependencies"}
                          </button>
                        </form>
                      ) : null}
                      {step.action === "smoke" ? (
                        <form action={validateFramework} className="framework-inline-action-form">
                          <FrameworkActionHiddenFields
                            createdCount={createdCount}
                            overwrittenCount={overwrittenCount}
                            params={params}
                            request={request}
                            skippedCount={skippedCount}
                          />
                          <button
                            className="framework-row-primary-action"
                            disabled={!canRunSmoke}
                            title={canRunSmoke ? undefined : "Install dependencies before running smoke."}
                            type="submit"
                          >
                            {validationStatus ? "Rerun Smoke" : "Run Smoke"}
                          </button>
                        </form>
                      ) : null}
                      {step.action === "install" && installStatus ? (
                        <FrameworkInlineActionOutput
                          actions={
                            frameworkBuildId ? (
                              <a className="secondary-button" href={`/framework/builds/${frameworkBuildId}`}>
                                View Full Output
                              </a>
                            ) : null
                          }
                          command={toManualFrameworkCommand(installCommand ?? "pnpm install && pnpm exec playwright install chromium")}
                          durationMs={installDurationMs}
                          exitCode={installExitCode}
                          outputLabel="Preview install output"
                          stderr={installStderr}
                          suggestedFix={installDiagnosis}
                          stdout={installStdout}
                        />
                      ) : null}
                      {step.action === "smoke" && validationStatus ? (
                        <FrameworkInlineActionOutput
                          actions={
                            (validationStdout || validationStderr) && frameworkBuildId ? (
                              <a className="secondary-button" href={`/framework/builds/${frameworkBuildId}`}>
                                View Full Output
                              </a>
                            ) : null
                          }
                          command={toManualFrameworkCommand(validationCommand ?? "pnpm test:smoke")}
                          durationMs={validationDurationMs}
                          exitCode={validationExitCode}
                          outputLabel="Preview smoke output"
                          stderr={validationStderr}
                          stdout={validationStdout}
                        />
                      ) : null}
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

            <section className="framework-file-list-panel">
              <div>
                <h3>Files</h3>
                <p>
                  {existingCount > 0
                    ? `${preview.totalFiles} files, ${existingCount} conflicts.`
                    : `${preview.totalFiles} files.`}
                </p>
              </div>
              <FrameworkFilePreviewDetails existingCount={existingCount} preview={preview} />
            </section>

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
                  <code>npx pnpm@11.7.0 install && npx pnpm@11.7.0 exec playwright install chromium</code>
                </li>
                <li>
                  <span>Create local env</span>
                  <code>cp .env.example .env</code>
                </li>
                <li>
                  <span>Run smoke test</span>
                  <code>npx pnpm@11.7.0 test:smoke</code>
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
          </section>
        ) : null}

      </section>
    </AppShell>
  );
}
