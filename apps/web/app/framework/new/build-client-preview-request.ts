import type { FrameworkTemplateFeature, FrameworkTemplateRequest } from "@flawferret2/job-schemas";
import { getDestinationType, toNpmPackageName } from "./framework-request-utils";

const knownFeatures = new Set<FrameworkTemplateFeature>([
  "pageObjects",
  "apiTesting",
  "accessibility",
  "githubActions",
  "sampleFeature",
]);

const getTrimmedValue = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

// Builds a FrameworkTemplateRequest straight from the live <form> state (via FormData), mirroring
// the defaults used server-side in buildPreviewRequest/toCreateRequest (page.tsx), so the client
// can request a fresh preview without a page reload whenever a Naming/Include/Where field
// changes. Kept dependency-free (no DOM/React) so it's directly unit-testable.
export const buildClientPreviewRequest = (formData: FormData): FrameworkTemplateRequest => {
  const destinationType = getDestinationType(getTrimmedValue(formData, "destinationType"));
  const features = formData
    .getAll("features")
    .map(String)
    .filter((feature): feature is FrameworkTemplateFeature => knownFeatures.has(feature as FrameworkTemplateFeature));
  const packageNameInput = getTrimmedValue(formData, "packageName");
  const projectNameInput = getTrimmedValue(formData, "projectName");

  return {
    baseUrl: getTrimmedValue(formData, "baseUrl") || "https://example.com",
    destinationType,
    features,
    githubBranch: getTrimmedValue(formData, "githubBranch") || "main",
    githubOwner: getTrimmedValue(formData, "githubOwner"),
    githubRepositoryId: getTrimmedValue(formData, "githubRepositoryId"),
    githubRepository: getTrimmedValue(formData, "githubRepository"),
    packageName: toNpmPackageName(packageNameInput || projectNameInput, "playwright-cucumber-tests"),
    projectName: projectNameInput || "Playwright Cucumber Tests",
    targetDirectory: getTrimmedValue(formData, "targetDirectory") || (destinationType === "github" ? "." : "qa/e2e"),
  };
};
