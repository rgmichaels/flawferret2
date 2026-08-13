# Auto-Heal on PR Check Failure

Status: Implemented
Date: 2026-08-12

**Implementation note:** Any `gh` invocation failure during log fetching — whether
enumerating checks (`gh pr checks`) or fetching an individual Actions log
(`gh run view --log-failed`) — fails the whole `fetchFailingCheckLogs` call and falls
back to `BLOCKED`, rather than only treating enumeration failures as hard failures and
proceeding with partial feedback from whatever checks did succeed. This was the
simplest reading of open question #2/the "empty/broken feedback" acceptance criterion
that's also easy to test deterministically; a reviewer may want partial-feedback
behavior instead if `gh run view` flakiness turns out to burn retry budget too
aggressively in practice. Non-Actions checks (no extractable run id in the check's
`link`) are *not* treated as a fetch failure — they fall back to surfacing the check's
details URL in the feedback text, per the spec's documented fallback.

## Problem

When `ferret-runner`'s PR-lifecycle polling (`inspectPullRequestLifecycle` in
`apps/ferret-runner/src/pull-request.ts`) detects that a draft PR's checks have failed
(`lifecycleState === "CHECKS_FAILED"`), `apps/ferret-runner/src/index.ts` marks the job
`BLOCKED` and stops. A human must notice, open the PR, read the failing check logs, and
manually hit "retry with feedback" (`POST /jobs/:id/retry-stage`) to get another Codex pass.
The `retryFeedback` plumbing that would drive an automatic fix attempt already exists and is
already wired into the Codex prompt (`buildCodexPrompt` in
`apps/ferret-runner/src/codex-invocation.ts`) — it's just never populated automatically.

## Proposed change

Extend `ferret-runner`'s PR-lifecycle handling so that, on `CHECKS_FAILED`, instead of always
going straight to `BLOCKED`, it:

1. Fetches the failing check(s) output via `gh` from the same `localPath` checkout already used
   by `inspectPullRequestLifecycle` (new function, e.g. `fetchFailingCheckLogs` in
   `apps/ferret-runner/src/pull-request.ts`, following the existing `runCommand`/`execFileAsync`
   pattern — likely `gh pr checks <prUrl> --json ...` to enumerate failing checks, then per-check
   `gh run view <runId> --log-failed` to pull failure output).
2. If the job's automatic-retry count (new counter, see data model below) is below the
   configured max, builds a `retryFeedback` metadata object (same shape the manual retry-stage
   route writes: `{ createdAt, feedback, previousRunStatus, previousStatus }`) whose `feedback`
   text is the fetched failing-check output, clears the run's `validation` / `pullRequest`
   metadata (mirroring what `/jobs/:id/retry-stage` does today), increments the retry counter,
   and requeues the job for another Codex pass.
3. If the counter has reached the max, falls back to today's exact behavior: `markRunFailed`,
   `markJobBlocked`, `PR_CHECKS_FAILED` + `JOB_BLOCKED` events, and the existing Slack "checks
   failed" milestone.

This is a change to `apps/ferret-runner/src/index.ts` (the `CHECKS_FAILED` branch inside the
`prLifecycleClaimResult.job` block, around line 1377) and `apps/ferret-runner/src/pull-request.ts`
(new log-fetching function). It also touches `apps/ferret-runner/src/config.ts` (new env var for
the default max retry count) and `packages/db/prisma/schema.prisma` (new `JobEventType` value(s)
and, per open questions below, possibly a new `Repository` column and/or `Job`/`Run` counter
field — this needs a migration).

No new `JobType` and no new `JobStatus` — this reuses the existing `RETRY`-adjacent mechanics
(`READY_FOR_CODEX` / `CODEX_APPROVED` states and the `retryFeedback` run-metadata field), matching
qa-strategist's "v1: same job retries itself" framing and `VISION.md`'s stated direction toward
`FIX_FAILED_TEST` / `INVESTIGATE_FAILURE` without building either job type yet.

## User stories / acceptance criteria

- Given a job's PR check status transitions to `CHECKS_FAILED` and the job's automatic-retry
  count is below the configured max, when `ferret-runner` next polls that job, then it fetches
  the failing check logs via `gh`, writes them into the run's `retryFeedback.feedback`, increments
  the automatic-retry counter, appends a `PR_CHECKS_FAILED` event (as today) followed by a new
  `PR_CHECKS_AUTO_RETRY_QUEUED` event whose metadata includes the retry count and the fetched
  check names, and moves the job back into the Codex pipeline rather than `BLOCKED`.
- Given a job whose automatic-retry count has already reached the configured max and its PR
  checks fail again, when `ferret-runner` polls it, then it behaves exactly as it does today:
  `markJobBlocked`, `PR_CHECKS_FAILED` + `JOB_BLOCKED` events, Slack "checks failed" milestone —
  plus a note in the `JOB_BLOCKED` event metadata that the automatic-retry budget was exhausted.
- As an engineer, I can see in the job detail page and job-event timeline how many automatic
  retries have happened and what failing-check text was fed to Codex on each one, so debugging an
  auto-healed job doesn't require digging through raw run metadata.
- As an engineer, when a job auto-retries, I can see the same "Retry with feedback" UI on the job
  detail page pre-populated with the auto-fetched failure context after the fact (i.e. the
  existing `retryFeedbackMetadata` display in `apps/web/app/jobs/[id]/page.tsx` around line 653
  continues to show the latest feedback, whether it came from a human or from auto-heal).
- Given `gh` fails to fetch check logs (rate limit, auth issue, deleted run, etc.), when
  `ferret-runner` handles a `CHECKS_FAILED` lifecycle state, then it falls back to today's
  `BLOCKED` behavior for that poll rather than requeuing with empty/broken feedback, and logs the
  fetch failure distinctly from a "retries exhausted" block.
- As an operator, I can configure the max automatic-retry count via `FERRET_RUNNER_MAX_AUTO_RETRIES`
  on `ferret-runner` (default `2`), so the budget isn't hardcoded.

## Out of scope

- No new `JobType` (`FIX_FAILED_TEST` / `INVESTIGATE_FAILURE` stay unimplemented placeholders in
  `VISION.md`'s roadmap).
- No changes to how `CLOSED` PRs are handled — that branch keeps going straight to `BLOCKED`.
- No flaky-test detection, retry classification, or quarantine logic (qa-strategist's idea #3) —
  every `CHECKS_FAILED` in-budget is treated the same way regardless of cause, per the open
  question below on whether failure types should be differentiated.
- No change to the manual `/jobs/:id/retry-stage` route or its UI beyond whatever is needed to
  surface auto-heal attempts in the existing feedback display — it keeps working exactly as it
  does today for human-triggered retries.
- No change to the Codex-approval spend gate for *manually* triggered retries.

## Decisions

1. **Auto-heal bypasses the manual Codex-approval spend gate — bounded.** Auto-retries move
   straight to `CODEX_APPROVED` (skipping the human `approve-codex` click) up to the retry cap
   below. This delivers the actual self-healing behavior rather than just pre-filling the feedback
   box. The existing approval gate is untouched for the *original* run and for manually triggered
   retries via `/jobs/:id/retry-stage` — this decision only covers the bounded auto-retry burst
   `ferret-runner` triggers itself on `CHECKS_FAILED`.
2. **Default max auto-retry count: 2.** A single global env var for v1
   (`FERRET_RUNNER_MAX_AUTO_RETRIES`, default `2`) — no per-repository override yet. Revisit adding
   a `Repository.maxAutoHealRetries` override (mirroring `validationCommand`) once there's real
   usage data suggesting repos want different budgets.
3. **Counter storage: new `Job.autoRetryCount Int @default(0)` column.** Durable and queryable
   (survives run-metadata pruning, and the job list/detail views can show it directly), matching
   the spec author's recommendation. Needs a migration.

## Open questions

1. **Does every `CHECKS_FAILED` cause qualify for auto-retry, or only some?** Default for v1:
   treat all `CHECKS_FAILED` uniformly (simplest, matches qa-strategist's original framing) — a
   merge conflict or infra flake just burns budget and falls back to `BLOCKED` like any other
   unfixable failure, rather than special-casing `mergeStateStatus`. Revisit if the auto-retry
   event log shows this wasting budget often in practice.
2. **Exact `gh` invocation and log volume for fetching failing check output.** Needs a spike
   against a live failing PR during implementation: `gh pr checks <url> --json name,state,link,...`
   to enumerate failed checks, then `gh run view <runId> --log-failed` for GitHub Actions checks,
   with a documented fallback for non-Actions checks (e.g. surfacing the check's `detailsUrl` in
   the feedback text instead of fetched logs, if no generic API exists for third-party CI output).
   Truncate to 4000 chars before writing into `retryFeedback.feedback`, matching the existing
   `truncateText` precedent in `index.ts`. Not a blocker for starting implementation — `coder`
   should treat this as a to-be-confirmed detail while building, not a reason to hold the spec.
3. **Slack notification cadence: notify on every auto-retry attempt, with distinct wording from
   the final budget-exhausted `BLOCKED` message.** So a human can tell "auto-healing in progress"
   apart from "auto-healing gave up, needs you" in the Slack channel, using the existing
   `sendRunnerSlackMilestone` / `config.SLACK_WEBHOOK_URL` plumbing. This is a default, not a hard
   constraint — flag it if the extra Slack volume turns out to be noisy in practice.
