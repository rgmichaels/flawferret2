# Framework Builder: Sanitize Package Name Instead of Rejecting It

Status: Draft
Date: 2026-08-13

## Problem
In the Framework Builder wizard (`apps/web/app/framework/new/page.tsx`), the Package Name field
(around line 1493) is a required free-text input with no client-side sanitization or validation.
If a user types anything that doesn't match the npm package-name rules — most commonly, any
uppercase letter, e.g. from a project named "TestFramework2a" — the value is sent as-is to
`POST /frameworks/preview`. The API validates it server-side against
`frameworkTemplateRequestSchema.packageName` in `packages/job-schemas/src/index.ts`
(`/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/`), rejects it with a 400, and the wizard
shows a "Preview failed" error with no indication of what's wrong or how to fix it.

The existing `slugValue` helper (`apps/web/app/framework/new/page.tsx` line ~299) is used
elsewhere to derive directory/repo names, but it only strips characters — it does not lowercase,
so it is not sufficient to guarantee a valid npm package name.

## Proposed change
In `apps/web/app/framework/new/page.tsx`:

1. Add a new sanitizer, e.g. `toNpmPackageName(value: string, fallback: string): string`, that
   produces a value always matching the job-schemas regex:
   - Lowercase the whole string.
   - Preserve a leading `@scope/` segment if present (split on the first `/`, sanitize scope and
     name segments independently, rejoin as `@scope/name`).
   - Replace any character outside `[a-z0-9._-]` with `-` in each segment.
   - Strip leading characters that aren't `[a-z0-9]` from each segment (the regex requires the
     first character of the scope and of the name to be alphanumeric).
   - Collapse the result to `.slice(0, 80)` per the schema's `max(80)`, taking care scoped names
     don't get cut off leaving a trailing `/`... Do not need to be perfectly length-precise beyond
     matching the regex and the 80-char cap; truncate the whole normalized string to 80 chars and
     re-trim trailing separators.
   - Fall back to the provided fallback (`"playwright-cucumber-tests"`) if the result is empty.

2. Auto-derive the Package Name field's initial/default value from Project Name using this
   sanitizer, the same way `slugValue` is already used to derive directory names — so a project
   named "TestFramework2a" defaults its Package Name field to `testframework2a` rather than
   `TestFramework2a`.

3. Apply the same sanitizer to the packageName value wherever it is read from form/query state
   before being sent to the API — specifically in `buildPreviewRequest` (line ~763) and
   `toCreateRequest` (line ~816) — so that even if a user hand-edits the Package Name field to
   contain uppercase letters or other invalid characters, the value FF2 actually submits is
   already sanitized rather than rejected. Do not reject the input outright or block form
   submission; sanitize it silently (client-enforced-safe value) and let the user see/edit the
   sanitized value going forward.

4. Decide whether the sanitization happens live in the browser (e.g. via a small client
   component/`onChange` handler that lowercases-as-you-type) versus only on submit. Given this
   file is a server component with server actions, the minimal-risk approach is: sanitize at the
   point the value is read server-side (steps 2 and 3 above) rather than adding client JS. This
   means a user could still see uppercase characters in the field between typing and the next
   round-trip, but by the time any API call fires, the value used is always valid. Flag this
   trade-off to the user/coder rather than assuming live client-side lowercasing is in scope.

## User stories / acceptance criteria
- Given a user enters a Project Name with uppercase letters (e.g. "TestFramework2a") and never
  touches the Package Name field, when they proceed to preview, then the Package Name used in the
  request is a valid lowercase npm name (e.g. "testframework2a") and the preview succeeds.
- Given a user manually types an invalid Package Name (uppercase letters, spaces, leading
  punctuation, etc.) and submits, when the wizard processes the preview/create request, then the
  value actually sent to the API is sanitized into a valid npm package name rather than causing a
  "Preview failed" / validation error.
- Given a user enters a scoped package name like "@MyOrg/My_Framework", when sanitized, then the
  result is a valid scoped name (e.g. "@myorg/my_framework") preserving the scope structure.
- Given the sanitized result of a user's input would be empty (e.g. input was only symbols), when
  sanitized, then the fallback `"playwright-cucumber-tests"` is used instead of submitting an
  empty/invalid value.

## Out of scope
- Changing the npm package name validation regex itself in `packages/job-schemas`.
- Live client-side (as-you-type) lowercasing/sanitization in the browser — see open question below.
- Sanitizing `projectName`, `targetDirectory`, or other fields — this spec is packageName-only.
- Changing `slugValue`'s existing behavior/usages (directory and repo name derivation), which
  intentionally allows uppercase and is unaffected by this change.

## Open questions
- Should the Package Name input show the sanitized value live as the user types (requiring a
  small client component), or is it acceptable for sanitization to happen only when the form is
  submitted/read server-side, per point 4 above? Proposed default if no answer: server-side-only
  sanitization, since this file is currently a server component with server actions and adding
  client-side JS is a larger change than the sanitizer itself.
