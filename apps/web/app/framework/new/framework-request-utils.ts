import type { FrameworkTemplateDestinationType } from "@flawferret2/job-schemas";

// Shared, framework-agnostic (no Next.js / DOM dependency) helpers for building a
// FrameworkTemplateRequest-shaped payload from user input. Kept separate from page.tsx so that
// client components (e.g. the live Files preview) can import them without pulling in
// page.tsx's server-only exports (server actions, `redirect`, etc).

export const getDestinationType = (value: string | undefined): FrameworkTemplateDestinationType =>
  value === "github" ? "github" : "local";

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

// Formats the API's known JSON error response shapes into a plain-English message. Falls back to
// the raw (trimmed) response text for any shape it doesn't recognize, and to `fallback` if that's
// also empty, so no error information is silently dropped.
export const parseApiErrorMessage = (text: string, fallback: string): string => {
  const trimmedText = text.trim();

  try {
    const parsed = JSON.parse(text) as unknown;

    if (parsed && typeof parsed === "object") {
      const body = parsed as { error?: unknown; issues?: unknown; message?: unknown };

      if (body.error === "ValidationError" && Array.isArray(body.issues)) {
        const messages = body.issues
          .map((issue) => {
            if (!issue || typeof issue !== "object") {
              return null;
            }

            const { path, message } = issue as { path?: unknown; message?: unknown };
            if (typeof message !== "string") {
              return null;
            }

            const field = Array.isArray(path) ? path.join(".") : "";
            return field ? `${field}: ${message}` : message;
          })
          .filter((message): message is string => Boolean(message));

        if (messages.length > 0) {
          return messages.join("\n");
        }
      }

      if (body.error === "InternalServerError" && typeof body.message === "string") {
        return body.message;
      }
    }
  } catch {
    // Not JSON — fall through to the raw text below.
  }

  return trimmedText || fallback;
};
