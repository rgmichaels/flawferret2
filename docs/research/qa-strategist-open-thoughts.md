# QA Strategist — Open Thoughts

Date: 2026-08-12

## Summary

An unprompted pass across the current QA/testing tooling landscape, filtered down to what actually
fits flawferret2's shape: capture -> `Job` -> Codex -> `ferret-runner` validation -> PR. Headline
recommendation: the highest-leverage near-term move is closing the loop that's already half-built —
when a PR's checks fail (already detected via `inspectPullRequestLifecycle`), automatically spin up a
follow-up fix job instead of just parking it in `BLOCKED` for a human to notice and manually retry.
Everything else below is smaller-bore but genuinely additive.

## Grounding notes

- `JobType` today has exactly one member: `ADD_PLAYWRIGHT_TEST`. `VISION.md` already names
  `INVESTIGATE_FAILURE`, `FIX_FAILED_TEST`, `REVIEW_PR_FOR_TEST_GAPS`, `ADD_REGRESSION_TEST`,
  `UPDATE_TEST_FOR_UI_CHANGE` as long-term job types — none exist yet.
- `ferret-runner` already has real machinery: repo checkout validation, work-branch prep, Codex
  invocation, a validation step that runs a shell command and diffs `git status`, draft PR creation,
  and PR-lifecycle polling (`CHECKS_FAILED` / `CHECKS_PASSED` / `MERGED` / `CLOSED`) that triggers
  cleanup on merge. Terminal PR states just call `markJobBlocked` — there is no automatic next step.
- There's already a **manual** human-triggered retry-with-feedback path (`retryFeedback` in run
  metadata, wired through `apps/api/src/server.ts` and the job detail page) that feeds reviewer notes
  back into the next Codex prompt. This is the exact mechanism an auto-heal loop would reuse — it
  isn't invented, just triggered automatically instead of by a human clicking retry.
- Validation's "run affected tests" is currently just a boolean passed to Codex, which is asked to
  self-report a `Focused validation command:` line in its final text response. `ferret-runner` then
  regex-extracts that line (`extractFocusedValidationCommand`) and shells out to whatever Codex wrote.
  This is the fragile part of an otherwise solid pipeline — it trusts free-text output for something
  that should be deterministic.
- The extension currently captures: URL, title, DOM `outerHTML`, ARIA role/name, generated selector
  candidates, a cropped screenshot, optional screen recording, and free-text notes. It does **not**
  capture console errors or network activity yet, even though `VISION.md` lists those as intended
  capture fields — that's a real gap, not an oversight I'm inventing.
- Cucumber is already a first-class concept in this repo (not something I'd be introducing): there's
  a `LocalTestRun` model with `FEATURE`/`SCENARIO` scope, a `cucumber-features.ts` module, and a
  Features browsing UI. Any BDD-flavored suggestion should hook into that, not create a parallel system.

## Findings

- **Flaky-test handling**: current practice is retry-classify-quarantine, not just "add retries and
  hope." Playwright's own retry mechanism already labels a test outcome as passed/flaky/failed; teams
  layer a `@flaky` tag convention on top, route quarantined tests to a non-blocking CI lane, and require
  every quarantined test to have an owner and a fix deadline so quarantine doesn't become a graveyard
  ([BrowserStack](https://www.browserstack.com/guide/playwright-flaky-tests),
  [Mergify](https://mergify.com/learn/flaky-tests/playwright)).
- **Visual regression**: Playwright's built-in `toHaveScreenshot`/`toMatchSnapshot` does pixel-diffing
  against committed baselines, with `maxDiffPixelRatio`, animation-disabling, and dynamic-content
  masking as the standard knobs. Best practice is generating baselines in CI (not locally) and treating
  them as reviewable artifacts in the PR itself
  ([TestQuality](https://testquality.com/playwright-visual-regression-guide/),
  [TestDino](https://testdino.com/blog/playwright-visual-testing)).
- **Test-impact analysis**: Playwright ships a native `--only-changed[=ref]` CLI flag that diffs the
  working tree against a git ref and runs only test files whose imports were touched — this is a
  deterministic alternative to trusting an LLM's self-reported "focused command" text
  ([Playwright blog / dev.to](https://dev.to/playwright/iterate-quickly-using-the-new-only-changed-option-55m2),
  [GitHub issue on limits](https://github.com/microsoft/playwright/issues/34339)). Its known limitation:
  it's file-level, so a shared fixture/helper change doesn't automatically pull in every test that
  depends on it unless that helper is itself imported by the changed spec.

## Suggested for flawferret2

### 1. Auto-heal on PR check failure (close the retry loop)
- **What**: When `inspectPullRequestLifecycle` reports `CHECKS_FAILED`, instead of only marking the
  job `BLOCKED`, automatically fetch the failing check's logs (via `gh pr checks` / `gh run view
  --log-failed`), stuff them into `retryFeedback` metadata (the field that already exists and already
  feeds Codex's next prompt), and requeue the job for another Codex pass — capped at N automatic
  attempts before falling back to today's human-blocked behavior.
- **Fits because**: This is pure extension of code that's already there —
  `apps/ferret-runner/src/pull-request.ts`'s lifecycle inspection and the existing manual
  `retryFeedback` route in `apps/api/src/server.ts`. It also is literally VISION.md's own
  `FIX_FAILED_TEST` / `INVESTIGATE_FAILURE` job types, just implemented as "the same job retries
  itself" rather than a new job type, at least for v1.
- **Rough shape**: no new `JobType` needed for a v1 (reuse `RETRY` status, existing `retryFeedback`
  path); add a capped `autoRetryCount` to run metadata; new `JobEventType` like
  `PR_CHECKS_AUTO_RETRY_QUEUED`. A v2 could split this into a real `INVESTIGATE_FAILURE` job type if
  the fetched CI logs warrant separate investigation before a fix attempt.
- **Confidence**: High — this is the one I'd send to `product-manager` first. It's small, reuses
  existing plumbing almost entirely, and directly closes a loop the product already half-built.

### 2. Deterministic test-impact selection via `--only-changed`
- **What**: Replace (or fall back to, ahead of) the regex-parsed "Focused validation command" from
  Codex's free-text response with Playwright's native `--only-changed=<targetBranch>` flag as the
  default validation command when `runAffectedTests` is true and the repo's test runner is Playwright.
- **Fits because**: `validation.ts` and the `commandSource` field (`environment` / `focused` /
  `repository` / `changed_files`) already model "where did this command come from" — this just adds a
  more trustworthy source ahead of `focused`, without changing the state machine at all.
- **Rough shape**: no new `JobType`/`JobStatus`; a new `commandSource` value (`only_changed`); a small
  addition to `validateGeneratedWork`'s command-resolution order in
  `apps/ferret-runner/src/index.ts` (around line 800-813).
- **Confidence**: High — narrow, low-risk, fixes a real fragility (trusting LLM-authored shell commands)
  with an existing first-party CLI flag.

### 3. Flaky-test detection and quarantine as a lifecycle concept
- **What**: Track pass/fail/flaky outcomes per scenario across `LocalTestRun`s and PR check runs; when
  a scenario flips outcome across consecutive runs without a code change touching it, tag it
  `@flaky`/quarantine it (excluded from blocking validation, still tracked) and surface it on a
  dashboard. Optionally auto-file a job to investigate/stabilize it.
- **Fits because**: `LocalTestRun` already has `SCENARIO` scope and a `FEATURE`/`SCENARIO` distinction
  — the granularity to track "this specific scenario" already exists, it's just not persisted across
  runs as a trend today.
- **Rough shape**: new model or JSON aggregate (e.g. `ScenarioStability` keyed on repo+feature+scenario),
  new `JobEventType`s (`SCENARIO_FLAGGED_FLAKY`, `SCENARIO_QUARANTINED`), possibly a new `JobType`
  (`STABILIZE_FLAKY_TEST`) that hands Codex the flaky history instead of a fresh goal.
- **Confidence**: Medium — genuinely useful once there's enough run volume to have flaky signal, but
  it's a bigger lift (new persistent tracking, not just a wiring change) and depends on how much churn
  the test suites actually see. Worth validating with the user before scoping.

### 4. Visual-diff capture as part of validation, gated behind explicit opt-in
- **What**: For jobs where the goal implies visual/layout correctness, have Codex generate a
  `toHaveScreenshot` assertion, and have `ferret-runner`'s validation step run it with baselines
  committed to the target repo, surfacing the diff image in the PR body alongside changed files.
- **Fits because**: the extension already grabs a cropped screenshot at capture time — that screenshot
  is a natural seed baseline for exactly the element/region the user flagged, which is a much better
  starting point than a Codex-authored screenshot from scratch.
- **Rough shape**: new capture field to persist the extension's screenshot alongside the job payload
  (today it's used for the Jira attachment flow, not sent to a flawferret2 job); a new `validation`
  metadata sub-shape for diff results; likely a repo-level opt-in flag (`Repository.visualBaselinesEnabled`
  or similar) since not every target repo wants committed baseline images.
- **Confidence**: Medium/maybe — the mechanics are well-trodden (Playwright natively supports this),
  but it requires new capture-side wiring (the extension's screenshot isn't currently sent to
  flawferret2 jobs at all, only to Jira) and repo-level configuration decisions. Worth validating
  scope with the user before writing a spec.

## Not recommended

- **Mutation testing** — valuable for catching weak assertions, but it's slow (runs the suite many
  times per mutant) and doesn't fit a per-Job, PR-sized turnaround; better suited to a scheduled batch
  job than the current synchronous claim/validate/PR loop.
- **Synthetic monitoring / uptime checks** — this is a dev-time PR-generation product, not a production
  observability product; monitoring prod endpoints is a different problem with a different on-call
  audience and doesn't connect to the Job/Run model at all.
- **Contract/API testing (e.g. Pact)** — the entire capture pipeline is browser/DOM-centric; there's no
  API schema or contract artifact anywhere in the extension or job payload today, so this would require
  inventing a whole new capture surface with no existing anchor.
- **Coverage-gap detection as a generic "add more tests" report** — too vague to be a Job; the one
  concrete version of this that *does* fit (`REVIEW_PR_FOR_TEST_GAPS`) is already named in VISION.md's
  roadmap and is really a variant of idea #1's job-creation pattern, not a separate research finding.
- **Accessibility testing (axe-core injection)** — plausible fit (extension already grabs DOM/role/name,
  which axe needs), but didn't make the cut because it's an "add a new job type" idea without a strong
  connecting thread beyond "we have the DOM already" — worth a future pass if the user wants it
  specifically, not urgent enough to be in the top handful here.
