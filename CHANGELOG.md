# Changelog

FlawFerret2 was built layer by layer, proving one stage before adding the
next. This file records that history. For what currently works, see
[`README.md`](README.md).

## Milestone 1 — browser -> API -> database

- Fastify server, Prisma, Neon PostgreSQL connection via `DATABASE_URL`
- `jobs` and `workers` tables
- `GET /health`, `POST /jobs`, `GET /jobs`

No worker, Codex, validation, or pull request automation.

## Milestone 2 — database queue -> worker claim

- `apps/ferret-runner`
- Worker registration and heartbeat in the `workers` table
- Atomic queued-job claim with PostgreSQL row locking
- `QUEUED -> CLAIMED -> RUNNING`
- Runner logs the claimed job and sleeps to simulate work

No Codex, validation, or pull request automation.

## Milestone 3 — repository registry

- `repositories` table
- `GET /repositories`, `POST /repositories`, `GET /repositories/:id`
- Dashboard repository registration
- Job creation by registered repository and target branch
- Optional per-repository validation command

No repository cloning, Codex, validation, or pull request automation.

## Milestone 4 — job request vs. execution attempt

- `runs` table and `RunStatus` lifecycle enum
- `GET /jobs/:id/runs`
- Latest run status in the dashboard, run history on the job detail page
- Runner creates a `STARTED` run when work begins

No repository checkout, Codex, validation, or pull request automation.

## Since Milestone 4

Work continued past the original milestone plan without new milestone
numbers:

- **Local checkout validation & work branch** — the runner validates a
  repository's configured local Git work tree and creates a local-only
  `flawferret/job-<short-id>` branch off the target branch.
- **Codex invocation** — `codex-invocation.ts`, gated behind a manual
  `READY_FOR_CODEX` approval and `FERRET_RUNNER_ENABLE_CODEX` (default off).
- **Validation step** — `validation.ts`, with global-override /
  Codex-suggested / per-repository command resolution.
- **Draft PR creation** — `pull-request.ts`, gated behind a manual `REVIEW`
  approval and `FERRET_RUNNER_ENABLE_PR_CREATION` (default off); commits,
  pushes, and opens a draft GitHub PR.
- **PR-check auto-heal** — bounded automatic retries on failed PR checks
  (`autoRetryCount`, `FERRET_RUNNER_MAX_AUTO_RETRIES`) with race-safe
  re-queuing.
- **Local checkout cleanup** — the runner restores the checkout to its base
  branch and records cleanup outcome.
- **Event-sourced job state** — `JobEvent` / `JobEventType` became the job
  state model; queue pause/resume via `QueueControl`; `GET /readiness` and
  the dashboard readiness view.
- **Jira tracker integrations** — `TrackerIntegration` records attached to
  repositories; Jira tickets created during the job pipeline.
- **Discover Tests** — AI test-scenario recommendations from a page URL,
  tester notes, and existing coverage; saved as `DiscoverRun`.
- **Feature catalog & local test runs** — browse Cucumber features and
  scenarios in a checkout, explain a scenario with AI, run a feature or
  scenario locally (`LocalTestRun`).
- **Framework Builder** — scaffold a Playwright + Cucumber test framework
  repository from a template, locally or as a new GitHub repository, with
  dependency install, smoke test, Git init, and repository registration.
- **OpenAPI docs** — Zod schemas published at `/documentation`.
