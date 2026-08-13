# Framework Builder: Show Readable Errors Instead of Raw API Response Bodies

Status: Draft
Date: 2026-08-13

## Problem
When a request from the Framework Builder wizard (`apps/web/app/framework/new/page.tsx`) to the
API fails, the wizard displays the raw HTTP response body text directly as the error message.
For Zod validation failures, the API's global error handler
(`apps/api/src/server.ts`, `setErrorHandler`) returns a JSON body shaped like
`{"error":"ValidationError","issues":[{"path":["packageName"],"message":"Use a valid npm package
name", ...}]}`, and this raw JSON string is shown verbatim in the UI instead of a plain-English
message like "Package name: Use a valid npm package name."

This pattern is not unique to the preview step. The same raw-passthrough of
`(await response.text())` (or a caught `Error`'s `.message`, which is the raw text wrapped in an
`Error`) appears in every server action / fetch-error path in this file:
- `getFrameworkPreview` (line ~785, preview step) — direct raw text assignment.
- `createFramework` (line ~858, create step) — `throw new Error((await response.text()) || ...)`.
- `installFrameworkDependencies` (line ~926, install step).
- `openGeneratedFrameworkFolder` (line ~970, open-folder step).
- `registerFramework`-type handler (line ~1016, register step).
- framework validation handler (line ~1055, validate step).

All of these ultimately call `frameworkTemplateRequestSchema` / `createFrameworkRequestSchema` /
etc. server-side via `.parse(request.body)` in `apps/api/src/server.ts`, so any of them can
receive the same `{ error: "ValidationError", issues: [...] }` shape on a 400, in addition to the
`{ error: "InternalServerError", message: "..." }` shape on a 500.

## Proposed change
In `apps/web/app/framework/new/page.tsx`:

1. Add a shared helper, e.g. `parseApiErrorMessage(text: string, fallback: string): string`, that:
   - Attempts `JSON.parse(text)`.
   - If the parsed value matches the Zod validation-error shape (`{ error: "ValidationError",
     issues: Array<{ path?: unknown[]; message: string }> }`), formats each issue as
     `"<field>: <message>"` (joining `path` segments with `.`, omitting the field prefix if `path`
     is empty) and joins multiple issues with `"; "` or newlines (coder's call on separator,
     newline preferred if the error display supports multi-line text).
   - If the parsed value matches the internal-error shape (`{ error: "InternalServerError",
     message: string }`), returns `message`.
   - If the parsed value is JSON but doesn't match either known shape, or `JSON.parse` throws,
     falls back to the raw `text` (trimmed), and if that's also empty, falls back to the provided
     `fallback` string. This preserves current behavior for any error shape not covered above
     rather than swallowing information.

2. Replace the raw-text usage in all six locations listed under Problem with
   `parseApiErrorMessage(text, fallback)`, using each call site's existing fallback string (e.g.
   `"Unable to preview framework."`, `"Unable to create framework files."`, etc.) unchanged.

3. Leave the `catch (error) { error instanceof Error ? error.message : fallback }` branches as-is
   — those catch network/parsing failures, not API error responses, and don't need JSON parsing.

## User stories / acceptance criteria
- Given a user submits a preview request with an invalid Package Name, when the API returns a 400
  ValidationError JSON body, then the wizard displays a readable message such as
  "packageName: Use a valid npm package name" instead of the raw JSON string.
- Given a user submits a create/install/open-folder/register/validate action and the API returns
  a ValidationError for any field, then the corresponding step's error banner shows the
  human-readable per-field message(s), not raw JSON.
- Given the API returns a 500 `InternalServerError` body, when displayed, then the wizard shows
  the body's `message` field (e.g. "An unexpected error occurred.") rather than the raw JSON
  wrapper.
- Given the API returns a non-JSON error body (e.g. plain text from a proxy/timeout), when
  displayed, then the wizard shows that raw text unchanged (no regression from current behavior).
- Given multiple validation issues are returned at once (e.g. both `packageName` and
  `githubOwner` invalid), then all issues are shown, not just the first.

## Out of scope
- Changing the API's error response shape in `apps/api/src/server.ts`.
- Adding client-side pre-validation to prevent invalid submissions in the first place (that's
  covered separately by the Package Name sanitization spec, and other fields still rely on
  server-side validation surfaced through this readable-error path).
- Inline per-field error display (e.g. showing the message next to the specific input) — this
  spec only covers making the existing error-banner text readable, not relocating where errors
  are shown.

## Open questions
None — this is a self-contained formatting fix using the API's existing, stable error shapes.
