# Console + Network Capture Wiring

Status: Draft
Date: 2026-08-13

## Reconciling the two research bets

This spec, and the sibling spec `docs/specs/create-bug-report-job-type.md`, come out of
reconciling two overlapping research passes at the extension-capture -> job-pipeline seam:
`docs/research/vision-beyond-add-playwright-test.md` (headline bet: ship `CREATE_BUG_REPORT`
as `JobType` #2) and `docs/research/capture-pipeline-and-job-type-expansion.md` (headline bet:
wire console/network capture into the existing `ADD_PLAYWRIGHT_TEST` type).

These two bets **compose, but are not equal-weight, and this one goes first**:

- Richer capture context is valuable regardless of how many `JobType`s exist. It improves every
  `ADD_PLAYWRIGHT_TEST` job today, and it is a hard prerequisite for a good `CREATE_BUG_REPORT`
  job later — a bug report with no console/network signal is a materially weaker product than
  one with it. Building this first means `CREATE_BUG_REPORT`, if and when it ships, inherits
  working capture instead of needing its own version of this work.
- `CREATE_BUG_REPORT` (see the sibling spec) is a separate, larger decision: it adds a new
  `JobType`, changes `POST /jobs`, and — critically — duplicates a *working* extension feature
  (the "Create Jira Ticket" button already files bugs directly to Jira, bypassing FlawFerret2
  entirely). Whether routing bug filing through FlawFerret2's job queue is additive or redundant
  is a genuine product question that needs the user's call before it's coder-ready. It should
  not block this capture work, which has no such ambiguity.
- Net: ship this spec now. Treat `CREATE_BUG_REPORT` as additive and independent, sequenced
  after the user resolves the open questions in its own spec.

## Problem

`captureContextSchema` in `packages/job-schemas/src/index.ts` already defines and validates
`consoleErrors: string[]` and `networkEvents: string[]` (both default to `[]`), and
`VISION.md` explicitly lists "Console errors" and "Network information" as capture targets.
Neither field is ever populated: `buildFlawFerret2CaptureContext` in
`apps/extension/src/content/content_script.ts` only ever sends
`url`/`title`/`domSnippet`/`selectors`/`thenLine`/`notes`/element metadata — there is no
console or network tracking anywhere in the extension.

The gap is actually two-layered, not one. Even if the extension populated these fields, they
still would not reach Codex: `buildCodexPrompt` in `apps/ferret-runner/src/codex-invocation.ts`
never reads `job.payload.captureContext` at all today. The only place `captureContext` is
currently used is client-side, in `apps/web/app/jobs/new/page.tsx`
(`getDefaultGoal`/`getDefaultAcceptanceCriteria`/`getDefaultFeatureArea`), to pre-fill the
free-text `goal`/`featureArea`/`acceptanceCriteria` form fields the user can then edit before
submitting. Once submitted, whatever ended up in that free text is all Codex ever sees — the
structured `captureContext` object (including `consoleErrors`/`networkEvents`, once populated)
is saved on the job payload but never surfaced in the prompt.

So closing this gap requires two changes, not one: capture the data in the extension, and add
a new step in `ferret-runner` to actually read it.

## Proposed change

### 1. Extension: capture console errors/warnings and failed network requests

The extension has no statically-declared `content_scripts` entry in
`apps/extension/src/manifest.json` — the content script is injected on demand via
`chrome.scripting.executeScript` from a context-menu click
(`apps/extension/src/sw/qa_issue_background_service.ts`). Capture therefore naturally starts
from "when the user invokes a FlawFerret action" forward, not from page load — consistent with
qa-strategist's "since the capture session started" framing. Capturing errors that happened
*before* the user opened the capture overlay is out of scope (see Open Questions).

Because `chrome.scripting.executeScript`'s default (ISOLATED) world does not share JS objects
with the page's own scripts, overriding `console.error`/`console.warn` from the existing
isolated-world content script will **not** observe the page's own console output. The
mechanically sound approach:

- Inject a second script into the page's **MAIN** world (`chrome.scripting.executeScript` with
  `world: "MAIN"`, available under the extension's existing `scripting` permission — no manifest
  permission change needed) that patches `window.console.error`/`window.console.warn` and
  `window.fetch`/`XMLHttpRequest` to record entries (message text for console; method/URL/status
  or rejection reason for fetch/XHR failures, scoped to 4xx/5xx responses and thrown/rejected
  requests) into an in-page buffer.
- Bridge that buffer back to the existing isolated-world content script via `CustomEvent`/DOM
  messaging (MAIN and ISOLATED worlds share the DOM but not JS objects) — there is no existing
  precedent for this bridge pattern in the codebase; this is new territory for the extension and
  should be scoped as such rather than treated as trivial wiring.
- Populate `consoleErrors`/`networkEvents` in `buildFlawFerret2CaptureContext`
  (`content_script.ts`) from that buffer, same place `domSnippet`/`selectors`/etc. are already
  assembled.

Known limitation of this approach (document, don't try to solve here): only fetch/XHR failures
initiated by page JS after capture starts are observed. Failed non-fetch resource loads (e.g. a
broken `<img>` tag) and anything from other frames/workers are not covered. This matches the
qa-strategist doc's "recent failed network requests" framing, not a full network log.

### 2. `ferret-runner`: surface console/network context in the Codex prompt

In `buildCodexPrompt` (`apps/ferret-runner/src/codex-invocation.ts`), when
`job.payload.captureContext.consoleErrors` and/or `.networkEvents` are present and non-empty,
add a new prompt section (e.g. after "Acceptance criteria:") listing them verbatim, so Codex
gets the actual repro signal instead of only whatever the user paraphrased into free text. This
is additive to the existing prompt structure; no change to the sections that already work.

No `JobType`, `JobStatus`, `JobEventType`, or database migration is needed anywhere in this
spec — `captureContextSchema` already validates these fields, and `Job.payload` is already
`Json`. This is wiring, not new product surface.

## User stories / acceptance criteria

- As a QA tester, when I invoke a FlawFerret capture action on a page that has logged
  `console.error`/`console.warn` output, or triggered a failed `fetch`/`XHR` request, since I
  started the capture, then the submitted job's `payload.captureContext.consoleErrors` and
  `.networkEvents` reflect those entries (non-empty arrays of readable strings).
- Given a capture session with no console errors or failed network requests, when I submit the
  job, then `consoleErrors`/`networkEvents` are `[]` (unchanged from today's behavior) — no
  regression for the common case.
- Given a job whose payload includes non-empty `captureContext.consoleErrors` and/or
  `.networkEvents`, when `ferret-runner` builds the Codex prompt for that job, then the prompt
  includes those entries in a clearly labeled section.
- Given a job whose payload has no `captureContext` or empty `consoleErrors`/`networkEvents`
  (the overwhelming majority of jobs today), when the prompt is built, then the prompt is
  byte-for-byte unchanged from current behavior (no empty "Console errors:" header, etc.).

## Out of scope

- Forwarding the rest of `captureContext` (DOM snippet, selectors, notes) into the Codex prompt
  directly — today those only reach Codex indirectly, via whatever the user left in the
  prefilled `goal`/`acceptanceCriteria`/`featureArea` text. That existing behavior is unchanged
  by this spec.
- Capturing console/network activity that happened before the user invokes the capture action
  (see Open Questions — would require a persistent, page-load-time content script and broader
  host permissions).
- Sending the extension's screenshot (`snapshotUrl`) into the job payload — that's the qa-strategist
  doc's separate idea #4 (visual-diff capture), not addressed here.
- Any change to `JobType`, `JobStatus`, `JobEventType`, or the database schema.

## Open questions

1. **On-demand vs. persistent capture.** Because the content script only injects on user action,
   console/network errors that occurred *before* the user opens the capture overlay are lost.
   Fixing that would require a statically-declared `content_scripts` entry running from
   `document_start`, which in turn needs broad `host_permissions` (e.g. `<all_urls>`) that the
   extension does not currently request (today it only requests `activeTab` + the Atlassian host
   for Jira). Is "errors since the capture session started" an acceptable scope for v1, or does
   the user want the broader (and higher-friction, permission-wise) always-on capture? This spec
   assumes on-demand/session-scoped capture; flag if that assumption is wrong.
2. **Prompt section verbosity/limits.** Should the new Codex prompt section cap the number of
   console/network entries included (e.g. last 20) to avoid flooding the prompt on a noisy page,
   or include everything captured? No cap is assumed by default; call out if the user wants one.
