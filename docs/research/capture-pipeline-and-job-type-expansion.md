# Capture Pipeline Gaps and Job-Type Expansion

Date: 2026-08-13

## Summary

Follow-up research pass on top of `docs/research/qa-strategist-open-thoughts.md` (2026-08-12). That
doc's idea #1 (auto-heal on PR check failure) has since been **built** — `ferret-runner`'s
`decideAutoRetryOutcome`/`fetchFailingCheckLogs`/`queueAutomaticCodexRetry` and the
`PR_CHECKS_AUTO_RETRY_QUEUED` event are live in `apps/ferret-runner/src/pull-request.ts` and
`apps/ferret-runner/src/index.ts`, with a matching spec at
`docs/specs/auto-heal-on-pr-check-failure.md`. Ideas #2 (deterministic `--only-changed`), #3 (flaky
quarantine), and #4 (visual-diff capture) are still unbuilt and remain valid. This pass confirms those,
adds one new near-zero-risk gap (console/network capture is schema-ready but never populated), and adds
a meta-finding: most of `VISION.md`'s named future `JobType`s don't actually need a new `JobType` to be
useful today, because `ADD_PLAYWRIGHT_TEST`'s `goal`/`acceptanceCriteria` fields are free text handed
straight to Codex. **Headline recommendation**: wire console + network capture into the extension
end-to-end (idea #1 below) — it's the one gap that's explicitly named in `VISION.md`, has zero schema
risk (the fields already exist and validate, they're just never populated), and improves every job's
context quality immediately, not just a hypothetical new job type's.

## Grounding notes (state as of this pass)

- `JobType` is still exactly `["ADD_PLAYWRIGHT_TEST"]`. `JobStatus`/`JobEventType` have grown a lot
  since v1 (`READY_FOR_CODEX`, `CODEX_APPROVED`, `PR_CHECKS_AUTO_RETRY_QUEUED`, etc.) — the state
  machine is actively evolving, but always for the one job type.
- `buildCodexPrompt` in `apps/ferret-runner/src/codex-invocation.ts` literally starts with "You are
  working on a FlawFerret2 ADD_PLAYWRIGHT_TEST job" and interpolates `featureArea`/`goal`/
  `acceptanceCriteria` as free text. Codex will follow whatever those fields say — there's no
  hardcoded assumption that the request is "add a Playwright test" beyond the framing sentence.
  Practically, a user can already ask for an accessibility check, a refactor, or a regression test via
  the existing job type; the payload shape doesn't stop them.
- `captureContextSchema` in `packages/job-schemas/src/index.ts` already defines `consoleErrors:
  string[]` and `networkEvents: string[]` (both default to `[]`). Neither
  `apps/extension/src/content/content_script.ts` nor `apps/extension/src/sw/qa_issue_background_service.ts`
  ever populates them — `buildFlawFerret2CaptureContext` only sends url/title/DOM/selectors/notes, never
  console or network data. This is the same gap the prior research doc flagged as a "grounding note";
  it's still there and still matches `VISION.md`'s explicit list of intended capture fields.
- The extension's screenshot (`snapshotUrl`, captured via `requestSnapshot`/`captureAndCropTab`) is
  used only for the Jira attachment flow — it is **not** included in `buildFlawFerret2CaptureContext`,
  so it never reaches a FlawFerret2 job today, confirming idea #4 from the prior doc is still open.
- `LocalTestRun` (feature/scenario scope, pass/fail/duration stats via `localTestRunStatsResponseSchema`)
  still only reflects the *current* run, not a rolling history — there's no persisted "this scenario
  flipped outcome across runs" signal anywhere, confirming idea #3 is still open.
- No `--only-changed` usage anywhere in the repo — `runAffectedTests` is still just a boolean that
  gets turned into an instruction inside the Codex prompt ("run only tests directly affected"), and
  `validation.ts`'s command resolution still prefers Codex's self-reported `Focused validation command:`
  line over anything deterministic. Idea #2 is still open.
- The extension already does a lightweight, proactive version of "selector resilience": for every
  captured element it builds an ordered fallback chain (`byRole` → `byLabel` → `byPlaceholder` →
  `byTestId` → `byText` → `css`) and emits warnings when a selector is CSS-fallback-only, matches
  dynamic-looking text, or isn't unique on the page (`buildWarnings` in `content_script.ts`). That's
  useful context worth noting before recommending anything selector-healing-related as "new."

## Findings

- **Accessibility testing**: `@axe-core/playwright`'s `AxeBuilder` is the standard integration —
  default WCAG 2.1 AA + best-practice rules, can scope to a page or a specific region, and is meant to
  run inline in existing specs or as a dedicated smoke pass in CI
  ([Playwright docs](https://playwright.dev/docs/accessibility-testing),
  [Checkly](https://www.checklyhq.com/blog/integrating-accessibility-checks-in-playwright-tes/)).
- **Self-healing locators**: current tooling framing (2026) combines a stability-ordered fallback chain
  (role/label/testid before CSS) with runtime repair that persists whichever locator actually matched
  back to the source so future runs reuse it
  ([QASkills.sh](https://qaskills.sh/blog/playwright-auto-healing-locators)). FlawFerret's extension
  already builds the ordered fallback chain and brittleness warnings *at capture time* — the piece it
  doesn't do is *persisting an observed-working locator back into a real test file after a run*, which
  requires a live test-execution feedback loop this system doesn't have (jobs are one-shot Codex + PR,
  not a continuously-executing suite FlawFerret owns).
- **Flaky-test handling**: retry → classify → quarantine, not just "add retries." Quarantined tests get
  a non-blocking CI lane, an owner, and a fix deadline so quarantine doesn't become permanent
  ([BrowserStack](https://www.browserstack.com/guide/playwright-flaky-tests),
  [Mergify](https://mergify.com/learn/flaky-tests/playwright)) — unchanged from the prior pass, still
  the standard.
- **Visual regression**: Playwright's native `toHaveScreenshot`/`toMatchSnapshot`, baselines generated
  in CI (not locally) and reviewed as PR artifacts
  ([TestQuality](https://testquality.com/playwright-visual-regression-guide/)) — unchanged, still open
  in this repo.
- **Test-impact analysis**: Playwright's native `--only-changed[=ref]` diffs the working tree against a
  git ref and runs only test files whose imports were touched
  ([Playwright blog](https://dev.to/playwright/iterate-quickly-using-the-new-only-changed-option-55m2))
  — unchanged, still a strictly-better default than trusting Codex's self-reported command.

## Suggested for flawferret2

### 1. Wire console + network capture end-to-end
- **What**: Have the extension's content script track `console.error`/`console.warn` output (and,
  where feasible via the background service worker's existing tab-capture permissions, recent failed
  network requests — 4xx/5xx or failed fetches) for the active tab since the capture session started,
  and populate `consoleErrors`/`networkEvents` in `buildFlawFerret2CaptureContext` (currently these are
  always sent empty). Then have `buildCodexPrompt` in `codex-invocation.ts` include them in the prompt
  when present, so Codex gets real repro signal (e.g., a failing XHR, a thrown JS error) instead of only
  DOM/selector context.
- **Fits because**: `captureContextSchema` already defines and validates both fields — this is wiring,
  not new product surface. `VISION.md` explicitly lists "Console errors" and "Network information" as
  capture targets that were never followed through on.
- **Rough shape**: extension-only change (content script + background service worker) plus a small
  addition to `buildCodexPrompt`'s field interpolation. No `JobType`, `JobStatus`, or schema change.
- **Confidence**: High — zero schema/state-machine risk, closes a gap `VISION.md` already named, and
  improves every existing job's context quality rather than only enabling a hypothetical new one.

### 2. Deterministic test-impact selection via Playwright `--only-changed`
- **What**: Prefer `--only-changed=<targetBranch>` as the validation command whenever `runAffectedTests`
  is true and the repo is a Playwright project, ahead of Codex's self-reported `Focused validation
  command:` line.
- **Fits because**: `validation.ts` already models "where did this command come from" via
  `commandSource` (`environment`/`focused`/`repository`/`changed_files`) — this adds a more trustworthy
  source ahead of `focused` without touching the state machine.
- **Rough shape**: no new `JobType`/`JobStatus`; new `commandSource` value (`only_changed`); small
  addition to the command-resolution order in `apps/ferret-runner/src/index.ts` (~line 800-813).
- **Confidence**: High — narrow, low-risk, replaces LLM-trusted shell-command parsing with a first-party
  deterministic flag. Carried forward from the prior research pass; still not built.

### 3. Flaky-test detection and quarantine as a persisted lifecycle concept
- **What**: Persist pass/fail outcomes per scenario across `LocalTestRun`s (and PR check runs) as a
  rolling history; when a scenario flips outcome across consecutive runs without a code change touching
  it, flag it flaky and surface it on a dashboard (optionally auto-file a stabilization job).
- **Fits because**: `LocalTestRun` already has `FEATURE`/`SCENARIO` scope and per-run stats
  (`localTestRunStatsResponseSchema`) — the granularity exists, it's just not persisted as a trend.
- **Rough shape**: new model or JSON aggregate keyed on repo+feature+scenario; new `JobEventType`s
  (`SCENARIO_FLAGGED_FLAKY`, `SCENARIO_QUARANTINED`); possibly a new `JobType`
  (`STABILIZE_FLAKY_TEST`) — this is one of the few ideas here that plausibly *does* warrant a real new
  `JobType`, since "here's a flaky-history report, stabilize this scenario" is a genuinely different
  Codex task shape than "add coverage for X."
- **Confidence**: Medium — useful once there's real run volume to generate flaky signal; bigger lift
  than #1/#2 (new persistent tracking, not just wiring). Worth validating with the user on expected
  run volume before scoping. Carried forward from the prior pass; still not built.

### 4. Visual-diff capture as an explicit, opt-in validation step
- **What**: For jobs where the goal implies visual/layout correctness, send the extension's
  already-captured screenshot along with the job (today it's dropped after the Jira-attachment flow),
  use it to seed a `toHaveScreenshot` baseline, and have `ferret-runner`'s validation step run the visual
  comparison and surface the diff image in the PR body.
- **Fits because**: the extension already grabs a cropped screenshot at capture time for exactly the
  element/region the user flagged — a much better seed baseline than one Codex would author from
  scratch, and the screenshot data already exists in the extension's runtime, it's just not forwarded.
- **Rough shape**: new capture field to actually send the screenshot into the job payload; new
  `validation` metadata sub-shape for diff results; likely a repo-level opt-in
  (`Repository.visualBaselinesEnabled` or similar) since not every target repo wants committed baseline
  images in its history.
- **Confidence**: Medium — mechanically well-trodden (Playwright natively supports this), but needs new
  capture-side wiring and a repo-level configuration decision. Carried forward from the prior pass;
  still not built.

## Not recommended

- **Dedicated new `JobType`s for most of `VISION.md`'s named future types** (`REVIEW_PR_FOR_TEST_GAPS`,
  `UPDATE_TEST_FOR_UI_CHANGE`, accessibility checks, refactors) — the existing `ADD_PLAYWRIGHT_TEST`
  payload's free-text `goal`/`acceptanceCriteria` fields are already handed straight to Codex with no
  hardcoded assumption about the task, so a user can request most of these today without any backend
  change. The cheap, high-value move (if the user wants this surfaced) is extension-side goal/
  acceptance-criteria *templates* for common request types (e.g. an "Add Accessibility Check" button
  that pre-fills the `/jobs/new` form), not a new `JobType`/state-machine branch. Revisit a real new
  `JobType` only for requests whose validation or workflow shape genuinely differs (see #3 above, which
  is the one clear exception).
- **Mutation testing** — still ruled out: slow (runs the suite many times per mutant), doesn't fit a
  per-`Job`/PR-sized synchronous claim/validate/PR loop; better suited to a scheduled batch job outside
  this architecture.
- **Synthetic monitoring / uptime checks** — still ruled out: this is a dev-time PR-generation product,
  not a production observability product; doesn't connect to the `Job`/`Run` model.
- **Contract/API testing (e.g. Pact)** — still ruled out: capture pipeline is browser/DOM-centric, no
  API schema or contract artifact anywhere in the extension or job payload to anchor it to.
- **Full self-healing-locator persistence (runtime repair written back to source)** — the extension's
  fallback-chain + brittleness-warning already covers the useful *proactive* half at capture time.
  Runtime-repair-and-persist needs a continuously-executing suite FlawFerret directly owns and observes,
  which doesn't match the one-shot Codex-run + PR shape this system has.

## Next step

I'd send **idea #1 (console/network capture wiring)** to `product-manager` first — it's the smallest,
lowest-risk, and closes a gap `VISION.md` explicitly calls out. **Idea #2 (`--only-changed`)** is
similarly low-risk and could go in the same batch. **Idea #3 (flaky quarantine)** is the most
substantial of the four and is the one idea here that plausibly justifies a real new `JobType` — worth a
product-manager pass once there's a read on expected run volume, but I'd sequence it after #1/#2.
**Idea #4 (visual-diff)** needs a scope conversation with the user first (repo-level opt-in, whether
committed baseline images are acceptable in target repos) before it's ready for a spec.
