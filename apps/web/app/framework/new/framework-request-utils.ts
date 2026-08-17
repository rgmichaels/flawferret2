import type { FrameworkTemplateDestinationType } from "@flawferret2/job-schemas";

// Shared, framework-agnostic (no Next.js / DOM dependency) helpers for building a
// FrameworkTemplateRequest-shaped payload from user input. Kept separate from page.tsx so that
// client components (e.g. the live Files preview) can import them without pulling in
// page.tsx's server-only exports (server actions, `redirect`, etc).

export const getDestinationType = (value: string | undefined): FrameworkTemplateDestinationType =>
  value === "github" ? "github" : "local";

// The "Then" cell of the sticky build bar: the post-build steps the current toggle state will run,
// in the order they happen. Shared so the server render and the live client refresh format it the
// same way.
export const formatAfterBuildSteps = ({
  initializeGitRepository,
  createGithubRepository,
  registerLocalRepository,
}: {
  initializeGitRepository: boolean;
  createGithubRepository: boolean;
  registerLocalRepository: boolean;
}): string => {
  const steps = [
    initializeGitRepository ? "git init" : null,
    createGithubRepository ? "push to GitHub" : null,
    registerLocalRepository ? "register" : null,
  ].filter((step): step is string => Boolean(step));

  return steps.length > 0 ? steps.join(" · ") : "nothing";
};

// Produces a value that always matches the npm package-name pattern enforced server-side by
// `frameworkTemplateRequestSchema.packageName` in `packages/job-schemas`:
// /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const npmPackageNameMaxLength = 80;

export const toNpmPackageName = (value: string, fallback: string): string => {
  const lower = value.trim().toLowerCase();

  const sanitizeSegment = (segment: string) =>
    segment.replace(/[^a-z0-9._-]/g, "-").replace(/^[^a-z0-9]+/, "");

  // Truncating a segment can leave a trailing separator (e.g. "foo-"), which is invalid as the
  // last character of a segment, so trim it off after slicing.
  const clampSegment = (segment: string, maxLen: number) =>
    segment.slice(0, Math.max(maxLen, 0)).replace(/[._-]+$/, "");

  let normalized: string;

  if (lower.startsWith("@") && lower.includes("/")) {
    const slashIndex = lower.indexOf("/");
    const scope = sanitizeSegment(lower.slice(1, slashIndex));
    const name = sanitizeSegment(lower.slice(slashIndex + 1));

    if (scope && name) {
      // Truncate the scope and name segments independently (rather than truncating the joined
      // "@scope/name" string) so a long scope can't crowd the name segment out entirely. Split
      // the budget roughly in half, biased toward whichever segment is actually shorter.
      const budget = npmPackageNameMaxLength - 2; // reserve "@" and "/"
      const scopeMax = Math.min(scope.length, Math.floor(budget / 2));
      const nameMax = budget - scopeMax;
      const clampedScope = clampSegment(scope, scopeMax);
      const clampedName = clampSegment(name, nameMax);
      normalized =
        clampedScope && clampedName ? `@${clampedScope}/${clampedName}` : clampedName || clampedScope;
    } else {
      normalized = clampSegment(name || scope, npmPackageNameMaxLength);
    }
  } else {
    normalized = clampSegment(sanitizeSegment(lower), npmPackageNameMaxLength);
  }

  return normalized || fallback;
};
