# Create Test Submit Feedback

Status: Draft
Date: 2026-09-11

## Problem

On the Create Test page (`apps/web/app/jobs/new/page.tsx`), clicking "Create
Test" gives no visible feedback. The button is only disabled when no
repository is scoped (line 286: `disabled={!selectedRepositoryId}`), never
disabled during or after submission, and there is no pending/loading
indicator anywhere in the form. On success, the server action `queueJob`
(lines 54-86) calls `revalidatePath("/")` and `revalidatePath("/jobs/new")`
but never navigates — the page looks identical before and after a
successful submit. This leads users to click "Create Test" multiple times,
each click unconditionally POSTing a new job to `${apiUrl}/jobs`, likely
queuing duplicate jobs.

## Proposed change

App: `apps/web` only. No API, DB, or job-schemas changes — this is purely
web-tier submit-feedback for the existing `POST /jobs` flow.

1. **Redirect on success.** In `queueJob` (`apps/web/app/jobs/new/page.tsx`,
   lines 54-86), after the successful `fetch` and in place of the two
   `revalidatePath` calls, call `redirect("/")` from `next/navigation` as
   the last statement in the function. This matches the existing pattern
   used elsewhere in this codebase for post-mutation navigation (e.g.
   `apps/web/app/discover/page.tsx` `deleteDiscoverRun`:
   `revalidatePath("/discover"); redirect("/discover?deleted=1");`, and
   `apps/web/app/page.tsx` `createSampleReviewJob`:
   `revalidatePath("/"); redirect(\`/jobs/${job.id}/review\`);`).
   `redirect()` throws internally and short-circuits the function, so it
   must be the last thing `queueJob` does on the success path; the
   `revalidatePath("/jobs/new")` call becomes unnecessary once we navigate
   away from that route and should be dropped. Keep
   `revalidatePath("/")` before the `redirect("/")` so the dashboard's
   server-rendered data (via `getJobs`/`getRepositories`, whatever `/`
   currently loads) is fresh for the redirected request, consistent with
   the `createSampleReviewJob` precedent above.
   The new job appearing in Recent Jobs on `/` (already rendered by
   `apps/web/app/page.tsx`) is the primary success signal, per the user's
   decision — no separate success banner/toast is being added by this
   spec (see Out of scope).

2. **Pending/disabled button state.** Extract the submit button (line
   286-288) into a small client component,
   `apps/web/app/jobs/new/create-test-submit-button.tsx`, following the
   existing precedent at `apps/web/app/discover/analyze-submit-button.tsx`:

   ```tsx
   "use client";

   import { useFormStatus } from "react-dom";

   export function CreateTestSubmitButton({ disabled }: { disabled: boolean }) {
     const { pending } = useFormStatus();

     return (
       <button type="submit" disabled={disabled || pending}>
         {pending ? "Creating..." : "Create Test"}
       </button>
     );
   }
   ```

   `useFormStatus` only works inside a `<form>` and needs a client
   component — `page.tsx` is an async server component, so the button
   (not the whole form) is the piece that moves to a client component,
   same split `analyze-submit-button.tsx` already uses for the Discover
   page's form. In `page.tsx`, replace the inline `<button>` with
   `<CreateTestSubmitButton disabled={!selectedRepositoryId} />` and import
   it. This makes the button read "Creating..." and become unclickable for
   the duration of the request, closing the double-submit window without
   any client-side state machine or extra fetch logic.

3. **Failure surfacing — out of scope for this fix.** `queueJob` currently
   does `throw new Error("Unable to queue job.")` on a non-OK response
   (line 81), which becomes an uncaught error since there is no
   `error.tsx`/`global-error.tsx` anywhere in `apps/web/app` today — this is
   true of every other server action in the app (e.g. `deleteDiscoverRun`,
   `approveCodex`, `approvePr` in `apps/web/app/page.tsx` all throw the same
   way on failure). Changing that pattern well (inline validation-style
   error message near the form, distinct from a generic crash page) is a
   cross-cutting concern affecting every mutating server action in the app,
   not just this one page, and is bigger than "make Create Test give
   feedback." This spec leaves the throw behavior as-is. The one thing this
   spec does guarantee without extra work: because of the pending-button
   change in (2), a *failed* submission no longer looks identical to a
   silent success mid-flight (the button visibly said "Creating..." then
   the request errored into Next's error UI) — it's just still the generic
   crash screen, not a scoped inline message. A follow-up spec
   ("Inline error handling for mutating server actions") should be filed
   separately if the user wants that improved app-wide.

## User stories / acceptance criteria

- As a user filling out Create Test, when I click "Create Test", the
  button immediately shows "Creating..." and becomes disabled, so I can't
  double-click it into submitting twice.
- Given a successful `POST /jobs` response, when `queueJob` finishes, then
  the browser navigates to `/` and the newly queued job is visible in
  Recent Jobs (no manual refresh needed).
- Given the API call fails (non-OK response), when `queueJob` throws, then
  the user still sees the button's "Creating..." pending state resolve
  (React clears `pending` once the action settles) before Next's error
  handling takes over — i.e., no permanently-stuck disabled button.
- Given no repository is scoped (`selectedRepositoryId` is empty), when the
  page renders, then `CreateTestSubmitButton` is disabled exactly as the
  inline button is today (`disabled={!selectedRepositoryId}`), regardless
  of `pending`.
- `apps/web/app/jobs/new/page.test.ts` continues to pass unmodified — none
  of its existing exports (`getDefaultAcceptanceCriteria`,
  `getDefaultFeatureArea`, `getDefaultGoal`, `parseCaptureContextValue`)
  change signature or behavior.
- New test coverage, colocated per repo convention
  (`apps/web/app/jobs/new/create-test-submit-button.test.ts` or similar),
  should cover what's practically testable with Node's `--test` runner and
  no React Testing Library in this repo today. Given there's no RTL/DOM
  test harness here, favor testing the parts that don't require rendering
  hooks:
  - A unit test asserting `CreateTestSubmitButton`'s disabled-label logic
    if it's extracted as a pure helper (e.g. a small exported
    `getButtonLabel(pending: boolean)` / `isButtonDisabled(disabled, pending)`
    helper used by the component), OR
  - If no RTL/jsdom is added (adding one would be a bigger, separate
    tooling change and is out of scope here — see Out of scope), it is
    acceptable for `coder` to add only a typecheck-level guarantee (the
    component compiles and is exported with the right prop type) plus a
    manual verification note in the PR description, rather than forcing a
    DOM-rendering test into a repo that doesn't have one. Use judgment;
    don't add a testing library as a side effect of this spec.
  - `queueJob`'s redirect behavior itself (throwing `NEXT_REDIRECT`
    internally) is not practically unit-testable without mocking
    `next/navigation`'s `redirect` — if `coder` finds a lightweight way to
    assert "redirect(\"/\") is called with the right argument" via a
    mock/spy on the imported `redirect` function (similar in spirit to how
    other server actions in this codebase are otherwise left untested at
    this granularity), that's a nice-to-have, not a blocker.

## Out of scope

- Any change to failure/error presentation (inline message, toast, retry
  affordance) for `queueJob` or any other server action — tracked as a
  possible separate follow-up spec, not part of this fix.
- A general toast/notification system for the web app.
- An explicit success banner or query-param flag on `/` (e.g.
  `?jobQueued=1`) confirming the job was created — the redirect landing on
  `/` with the new job visible in Recent Jobs is the agreed success
  signal; no additional banner is being added.
- Any change to the `POST /jobs` API contract, `packages/job-schemas`, or
  duplicate-submission protection on the API/DB side (e.g. idempotency
  keys, server-side de-dup). This spec only prevents the *UI* from firing
  multiple submits; if duplicate jobs from some other client are a
  concern, that's separate scoping.
- Adding a DOM-testing library (React Testing Library, jsdom, etc.) to
  `apps/web` — this repo currently has none, and introducing one is a
  tooling decision bigger than this bug fix.

## Open questions

None blocking — the user has already confirmed the redirect-to-`/`
direction, and the pending-button and failure-handling decisions above are
made explicitly in this spec using existing in-repo precedent
(`analyze-submit-button.tsx` for `useFormStatus`; `discover/page.tsx` and
`app/page.tsx` for the `revalidatePath` + `redirect` sequencing). If the
user wants the "Inline error handling for mutating server actions"
follow-up scoped now instead of later, say so and it can be split out as
its own spec.
