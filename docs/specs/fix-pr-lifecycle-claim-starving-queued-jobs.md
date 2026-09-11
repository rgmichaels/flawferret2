# Fix PR-lifecycle claim starving queued jobs

Status: Draft
Date: 2026-09-11

## Problem

A single stuck `PR_CREATED` job can block ferret-runner's main worker loop from
ever claiming new `QUEUED` jobs, indefinitely. This was observed live in
production: job `#4b19b0a8` sat `QUEUED` and unclaimed for ~10 minutes while
the worker busy-looped re-inspecting job `#fe4e5a83`'s draft PR (open,
`mergeable: CONFLICTING`, nothing new to report), even though the worker's
heartbeat and status showed normal "Busy" operation the whole time.

## Root cause

In `apps/ferret-runner/src/index.ts`, the main `while (!shouldStop)` loop
calls `claimNextPrCreatedJob(workerId)` (around line 1191) before it ever
reaches `claimNextQueuedJob(workerId)` (around line 1639). `claimNextPrCreatedJob`
(`packages/db/src/index.ts` line ~432) unconditionally claims the single
`PR_CREATED` job with the oldest `updated_at`, with no regard for how long
it's been stuck or whether its PR state has actually changed since last
inspection.

Every branch of the PR-lifecycle handling that inspects a claimed job and
finds nothing new to do falls through to `continue` back to the top of the
loop — and critically, unlike the terminal `claimNextQueuedJob`/`claimNextPrCreatedJob`
"queue paused" and "no job found" branches (which call
`sleep(config.WORKER_POLL_INTERVAL_MS)` before `continue`, e.g. around lines
1195-1196, 1644-1645, 1650-1651), the PR-lifecycle "nothing changed"
`continue` sites do **not** sleep. These include (line numbers approximate,
current as of this spec):

- The "PR lifecycle inspected" branch ending at line ~1634-1637 (lifecycle
  state unchanged since last check).
- The terminal-state / auto-retry `continue` sites around lines 1474, 1524,
  and 1596 (e.g. `CHECKS_FAILED` with no auto-retry action taken this pass,
  or a retry that raced the job out of `PR_CREATED`).

As long as any one job sits at `PR_CREATED` with nothing new happening — the
expected steady state while waiting on the human-approval gate described in
this repo's `CLAUDE.md` (draft PR, checks passed, merge conflict, waiting on
a human) — the loop re-claims and re-inspects that same job in a tight,
network-latency-bound busy loop (observed ~800ms-1s per iteration, since
`WORKER_POLL_INTERVAL_MS` defaults to 5000ms but is never reached here) and
**never executes `claimNextQueuedJob` at all**. New queued jobs are starved
indefinitely, with no upper bound, while the worker appears healthy.

The recovery path itself is correct: when the PR's state does change (e.g.
closed), the very next inspection detects it, resolves the job (e.g. to
`BLOCKED`), and the loop falls through to `claimNextQueuedJob` normally. The
bug is purely the lack of any fairness or cooldown bound on how long a
legitimately-stuck `PR_CREATED` job can hold the queue hostage.

## Proposed change

App: `apps/ferret-runner` only. No DB migration, no new `JobStatus` or
`JobEventType` value — this is a scheduling/fairness fix in the worker loop,
not a job-lifecycle change.

Two complementary changes, both required:

**1. Bounded fairness for queued-job claiming (the load-bearing fix).**

Introduce a loop-iteration counter and a new config value,
`FERRET_RUNNER_QUEUED_CLAIM_FAIRNESS_N` (Zod schema in
`apps/ferret-runner/src/config.ts`, `z.coerce.number().int().positive().default(3)`),
following the existing `FERRET_RUNNER_*` naming convention. Every `N`th
iteration of the main loop, the loop skips `claimNextPrCreatedJob` (and any
other claim earlier in the priority chain that would otherwise take
priority — see Open Questions) for that single iteration and attempts
`claimNextQueuedJob` first instead. This guarantees a queued-job claim
attempt happens at least once every `N` iterations regardless of how many
`PR_CREATED` jobs exist or how stuck they are, while still letting
PR-lifecycle monitoring run on the other iterations (preserving the
human-approval-gate design — `PR_CREATED` jobs keep getting inspected on a
bounded delay, they just no longer get unconditional priority every single
iteration).

Extract the decision "should this iteration prioritize the queued claim"
into a small pure, exported function (e.g.
`shouldPrioritizeQueuedClaim(iterationCount: number, fairnessN: number): boolean`)
in a new file `apps/ferret-runner/src/loop-fairness.ts` (or similarly named,
`coder`'s call on exact filename), so it's unit-testable without a live DB
or worker process. The main loop calls this function each iteration and
branches its claim order accordingly.

**2. Cooldown on no-op PR-lifecycle inspection cycles (defense in depth).**

Add `await sleep(config.WORKER_POLL_INTERVAL_MS)` (or a separate, possibly
shorter, dedicated interval — `coder`'s call, default to reusing
`WORKER_POLL_INTERVAL_MS` unless there's a reason not to) before every
`continue` in the PR-lifecycle claim branch that represents "inspected this
job, nothing new happened" — specifically the sites currently ending near
lines 1474, 1524, 1596, and 1634-1637. Branches that represent real state
changes (auto-retry queued, job blocked, checks passed with an event
appended, etc.) do **not** need this sleep — they already did real work this
iteration and are not spinning.

This alone does not fix starvation (a slower busy loop still never reaches
`claimNextQueuedJob`), but it reduces DB and GitHub API load during the
window that fix #1 bounds, and is cheap to add correctly since fix #1 is
already touching this code.

## User stories / acceptance criteria

- Given one or more jobs are stuck in `PR_CREATED` with no state change
  happening, when jobs are sitting `QUEUED`, then a `QUEUED` job is claimed
  (transitions to `CLAIMED`) within a bounded number of loop iterations
  (`FERRET_RUNNER_QUEUED_CLAIM_FAIRNESS_N`, default 3) — never "forever."
- Given `FERRET_RUNNER_QUEUED_CLAIM_FAIRNESS_N=3`, when the loop has run 3
  iterations without prioritizing a queued claim, then the 3rd (or next)
  iteration attempts `claimNextQueuedJob` before `claimNextPrCreatedJob`,
  regardless of whether a `PR_CREATED` job exists.
- Given a `PR_CREATED` job's lifecycle inspection finds no state change (the
  "PR lifecycle inspected" log branch, or a terminal-state branch that takes
  no action this pass), when the loop reaches its `continue`, then it calls
  `sleep(config.WORKER_POLL_INTERVAL_MS)` first — the loop no longer spins at
  network-latency speed with zero delay.
- Given a `PR_CREATED` job's lifecycle inspection finds a real change (state
  transition, auto-retry queued, job blocked, PR checks passed, etc.), when
  the loop reaches its `continue`, then no new sleep is introduced on that
  path — existing behavior (react immediately) is preserved, matching the
  live-observed "PR closed -> BLOCKED -> queued job claimed within ~1s"
  recovery behavior.
- As an operator, I can tune `FERRET_RUNNER_QUEUED_CLAIM_FAIRNESS_N` via env
  var (documented in `.env.example`, validated in
  `apps/ferret-runner/src/config.ts`) without code changes, so that fairness
  vs. PR-lifecycle-monitoring-freshness can be re-balanced in production
  without a deploy.
- `pnpm --filter @flawferret2/ferret-runner typecheck` and `pnpm --filter
  @flawferret2/ferret-runner test` pass.

## Test coverage guidance

- **Unit-testable (required):** the extracted `shouldPrioritizeQueuedClaim`
  (or equivalent) pure function, in a colocated `loop-fairness.test.ts` using
  `tsx --test`, following this repo's existing colocated-test convention
  (see `config.test.ts`, `codex-invocation.test.ts`). Cover: fairness
  triggers exactly every Nth iteration, works correctly for `N=1` (always
  prioritize queued — effectively disables PR-lifecycle priority) and large
  `N`, and doesn't throw/misbehave on iteration counter overflow-adjacent
  values (e.g. use modulo, not a growing unbounded counter, to sidestep
  this).
- **Deferred as integration-only (not required for this change to land):**
  end-to-end verification that a live worker against a live DB with a
  fabricated stuck `PR_CREATED` job actually claims a concurrently-queued
  job within the bounded window. `apps/ferret-runner` has no live-DB
  integration test harness today (existing tests mock/avoid Prisma
  entirely, per the file list in `apps/ferret-runner/src`); building one is
  out of scope for this fix. Manual verification against a staging/local DB
  before merge is recommended instead, and should be called out in the PR
  description.
- The sleep-on-no-op-continue change (fix #2) is not independently unit
  tested — it's a one-line addition guarded by the acceptance criteria
  above; reviewing the diff against the acceptance criteria is sufficient.

## Out of scope

- Any change to `JobStatus` or `JobEventType` — this is scheduling logic
  only, no new lifecycle states or events.
- Fairness/starvation risk in the other claim stages that also run ahead of
  `claimNextQueuedJob` in the same loop (`claimNextApprovedCodexJob`,
  `claimNextValidatingJob`, `claimNextReviewJob` — all in
  `packages/db/src/index.ts`, all with similar "claim, inspect, `continue`
  without sleep" shapes in `apps/ferret-runner/src/index.ts`). These were
  not confirmed live and are not part of the reported incident; if a similar
  pattern is suspected there, file it as a separate follow-up spec rather
  than folding it into this fix.
- Any change to how `claimNextPrCreatedJob`'s SQL orders or selects
  candidates (`ORDER BY updated_at ASC`) — the fairness fix operates at the
  loop level, not the query level.
- Alerting/monitoring for stuck `PR_CREATED` jobs (e.g. a Slack notification
  if a PR has been `PR_CREATED` for longer than some threshold) — useful,
  but a distinct feature from fixing the starvation bug itself.
- Any change to `WORKER_POLL_INTERVAL_MS`'s default value or semantics.

## Open questions

- Should the fairness check (`shouldPrioritizeQueuedClaim`) only reorder
  `claimNextPrCreatedJob` vs. `claimNextQueuedJob`, or should it also jump
  ahead of `claimNextLocalTestRun` / `claimNextApprovedCodexJob` /
  `claimNextValidatingJob` / `claimNextReviewJob` on its designated
  iterations? Jumping ahead of all of them maximizes the fairness
  guarantee's strength (a hard bound of `N` iterations no matter what else
  is stuck), but widens this change's footprint beyond the specifically
  reported `PR_CREATED` bug. Recommendation: scope the reorder to just
  `claimNextPrCreatedJob` vs. `claimNextQueuedJob` for this fix, matching
  the reported incident exactly, and note in the PR description that the
  other stages carry a structurally similar (unconfirmed) risk. Needs the
  user's sign-off before `coder` starts if a broader reorder is actually
  wanted.
- Is `FERRET_RUNNER_QUEUED_CLAIM_FAIRNESS_N` default of `3` acceptable, or
  should it default to `1` (always give queued jobs first crack, effectively
  making PR-lifecycle monitoring opportunistic/best-effort on the loop's
  "off" iterations)? A lower N tightens the queued-claim latency bound at
  the cost of proportionally less frequent PR-lifecycle inspection when
  queued jobs are also present. No strong signal from the incident either
  way — pick a default and adjust via env var if wrong in practice.
