# Vision: Beyond ADD_PLAYWRIGHT_TEST

Date: 2026-08-13

## Thesis

FlawFerret2 has spent its last ~50 commits proving out and hardening a single vertical slice
(`ADD_PLAYWRIGHT_TEST`, now including auto-heal on PR check failure) plus a second, largely
parallel product (the Framework Builder wizard). The next right move is not another feature on
either surface — it's forcing the orchestration layer to prove it generalizes past one job type,
while deliberately investing in the human side of the loop (prioritization/triage) so approval
doesn't become the bottleneck once job volume and job-type variety both go up.

## Bets

### Bet 1: Ship `CREATE_BUG_REPORT` as job type #2

**What**: Add a second `JobType` — `CREATE_BUG_REPORT` — that takes extension-captured context
(URL, DOM, screenshot, selector, notes) and produces a Jira ticket with a written repro, rather
than a code diff and PR. Wire it to the extension's already-promised-but-unbuilt "Create Bug"
action (`VISION.md` names it alongside "Add Playwright Test"; only the latter exists today).

**Why now**: Every schema and pipeline decision in this codebase (`Job.payload: Json`,
`JobType` enum, `Repository.trackerIntegrationId`, the whole `TrackerIntegration`/Jira model)
was designed for multiple job types, but only one has ever been implemented or exercised. That's
a real risk: nobody knows yet whether `buildCodexPrompt`, the validation-command resolution
chain, or the PR-centric status machine (`VALIDATING` -> `REVIEW` -> `PR_CREATED`) have
`ADD_PLAYWRIGHT_TEST` assumptions baked in that won't survive a second type. A bug-report job is
the cheapest possible second type to prove this with — it doesn't touch the repo, doesn't run
Codex against a working tree, doesn't need Playwright validation or a PR at all, so it exercises
the *job/queue/worker* generality without also inheriting all the code-modification risk. It also
finally uses the Jira integration for something a QA engineer would actually reach for daily
(filing a well-formed bug from what they just saw), instead of Jira only appearing as a
tracker-review gate on the Playwright-test flow.

**Who feels it**: The tester/engineer using the extension while poking at a running app. Today
their only move on a bug they spot is "turn it into a Playwright test job" — there's no path to
just "file this as a bug," even though that's the far more common QA reflex than "write a
regression test for it."

**Risk if wrong**: Discovering mid-build that the queue/status machine is more
`ADD_PLAYWRIGHT_TEST`-shaped than believed (e.g., `RunStatus`'s `CODEX_RUNNING` / `VALIDATING` /
`PUSHING` stages assume a code-writing job) forces either an awkward job type that skips half the
state machine, or a larger refactor of `RunStatus`/`JobStatus` than intended. Better to hit that
now, on a small job type, than after three more job types are designed against an unproven
abstraction.

**Rough size**: Medium — new `JobType` enum value + migration, new payload schema in
`job-schemas`, a `ferret-runner` code path that skips checkout/Codex/validation/PR and instead
calls the Jira ticket-creation logic that already exists, extension UI for the new action.

### Bet 2: Backlog triage view for the human approval gate

**What**: A single view where a human can see and bulk-act on candidate/pending work — jobs in
`DRAFT`/`NEEDS_REVIEW`, Discover-recommended titles not yet queued, jobs waiting on the Codex
approval-spend gate — instead of working one job at a time on the jobs list (which today has
filters and sort but no bulk selection or batch approve, confirmed in `apps/web/app/page.tsx`).

**Why now**: The system already produces more candidate work than a human reviews individually.
`DiscoverRun.queuedTitles` accumulates AI-recommended test titles per page; the extension creates
jobs from capture; Bet 1 adds a second source of candidate work (bug reports) with its own
volume. `VISION.md`'s explicit design goal is "humans remain the approval gate" — that only holds
up if reviewing stays cheap as the number of things needing review grows. Right now the
approval/prioritization surface hasn't scaled at the same rate as the capture/generation surface,
and that gap gets worse with every new job type or capture source, not better.

**Who feels it**: The team lead or QA lead who is the actual prioritization/approval bottleneck —
currently forced into job-by-job review with no way to say "approve these three, reject that one,
snooze the rest."

**Risk if wrong**: Building triage UI ahead of real usage volume is possible — if actual job
counts stay low (single-digit concurrent jobs), a bulk-action view is over-engineering a problem
that doesn't exist yet. Worth a quick gut-check on current job counts before scoping; this is the
bet most worth validating with the user first.

**Rough size**: Medium — mostly UI (multi-select + batch endpoints on existing routes), no new
schema.

### Bet 3: Close the Framework Builder -> first-job loop

**What**: After a Framework Builder wizard run successfully registers a repository (dependency
install + smoke validation passing), surface a direct "Create your first job" CTA into
`jobs/new` pre-filled with that repository, and track build-to-first-job conversion.

**Why now**: Recent commit history (`Improve framework validation actions`, `Surface framework
smoke results`, `Add framework build shortcuts`, `Add framework builder results action center`)
shows heavy, ongoing investment in the Framework Builder's own results/detail surface. But nothing
in `apps/web/app/framework/**` currently links back to job creation — confirmed by grep, zero
hits for `jobs/new` or "create a job" under that directory, despite `FrameworkBuild` already
carrying a `registeredRepositoryId` that ties a scaffolded repo straight to the `Repository` table
the job-creation form consumes. Framework Builder only earns its build cost if it's a funnel into
the core job loop, not a destination in itself. Right now it's plausible a team finishes a
successful build and never creates a job at all.

**Who feels it**: A new team onboarding a repo that doesn't have a test framework yet — the
Framework Builder gets them "test-ready" but currently leaves them to independently discover that
job creation is the next step.

**Risk if wrong**: Low — worst case is a CTA nobody clicks and a conversion metric that stays flat,
which is itself useful signal. The bigger risk is *not* doing this: continued polish on Framework
Builder's own surface without ever confirming it converts into the product's actual value loop.

**Rough size**: Small — one CTA + one event/metric, no schema change.

## Rejected directions

- **`INVESTIGATE_FAILURE` / `FIX_FAILED_TEST` as job types right now** — auto-heal (just shipped,
  `docs/specs/auto-heal-on-pr-check-failure.md`) already covers the highest-value case of
  "fix a failure" (in-flight PR checks failing). A from-scratch investigate-a-failing-test flow
  needs richer capture context (console/network, per qa-strategist's existing gap note) than the
  extension sends today — premature until that capture gap closes.
- **A generic VISION.md-style dashboard (queued/running/worker status/timeline)** — folded into
  Bet 2. A passive status board doesn't relieve the actual bottleneck; a work queue with bulk
  actions does. Building the former without the latter is motion, not progress.
- **Multi-worker horizontal scaling as a product bet** — job claiming is already row-locked and
  looks multi-worker-safe today; this is ops/infra readiness, not a product differentiator with a
  distinct underserved user. Revisit only if real throughput becomes a bottleneck.
- **Deterministic `--only-changed` validation, flaky-test quarantine, visual-diff capture** —
  already scoped by `qa-strategist` in `docs/research/qa-strategist-open-thoughts.md` (#2-#4).
  Good ideas, correctly sized as tactical hardening rather than direction-setting bets; not
  re-litigated here.
- **Mutation testing, synthetic monitoring, contract/API testing, axe-core accessibility** —
  already ruled out by qa-strategist with reasoning I agree with; no new argument for revisiting.

## Next step

Bet 1 (`CREATE_BUG_REPORT` as job type #2) is the headline and is ready for `product-manager` to
scope — the extension gap, the unused Jira plumbing, and the single-job-type risk are all
concretely grounded in the current code, not speculative. Bet 3 is small enough to nearly be
spec-ready as-is. Bet 2 should get a quick gut-check with the user on actual current job volume
before `product-manager` scopes it — if volume is still low, it's the right idea at the wrong
time.
