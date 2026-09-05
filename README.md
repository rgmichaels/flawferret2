# FlawFerret2

FlawFerret2 is an AI-powered QA orchestration platform. It turns captured
browser context and human intent into validated engineering pull requests,
while keeping humans as the approval gate.

It is **not** another Playwright framework, and it is **not** the browser
extension by itself (that is the capture interface). This repo is the
orchestration backend: it stores jobs, coordinates workers, invokes Codex,
validates the result with the repository's own test command, and opens draft
GitHub pull requests for human review.

See [`VISION.md`](VISION.md) for the full product thesis and
[`CLAUDE.md`](CLAUDE.md) for contributor conventions.

## Pipeline

```text
Browser extension
  -> Web dashboard (apps/web)
  -> API (apps/api)
  -> Postgres / Neon (packages/db)
  -> ferret-runner worker (apps/ferret-runner)
  -> Codex
  -> validation command
  -> draft GitHub pull request
  -> human review -> merge
```

Version 1 supports a single job type: `ADD_PLAYWRIGHT_TEST`.

## API documentation

Published OpenAPI docs for `apps/api`: **https://rgmichaels.github.io/flawferret2/**

Generated on every push to `main` that touches `apps/api`, `packages/job-schemas`,
or `packages/db` (`.github/workflows/api-docs.yml`) — the OpenAPI document is
rendered straight from the route schemas that Fastify already validates
requests against, so it can't drift out of sync with actual API behavior.

Running the API locally also serves an interactive Swagger UI at
`/documentation` (source at `/documentation/json`).

## What's built today

The full pipeline exists end to end. The AI-execution and
repository-writing steps are gated behind explicit human approvals and are
disabled by default, so an out-of-the-box install is safe to run against a
real checkout.

### Jobs pipeline

- **Job creation** — `apps/web` job form (`/jobs/new`) collects repository,
  target branch, feature area, goal, acceptance criteria, priority, and
  optional captured browser context. Jobs can also arrive prefilled from the
  browser extension.
- **Event-sourced state** — job lifecycle is recorded as `JobEvent` rows
  (`JobEventType` in [`schema.prisma`](packages/db/prisma/schema.prisma) is
  the source of truth). `Run` rows track individual execution attempts
  separately from the job request.
- **Queue + claim** — `ferret-runner` registers a worker row with sparse
  heartbeats and atomically claims the oldest highest-priority `QUEUED` job
  with row locking. The queue can be paused and resumed from the dashboard
  (`QueueControl`).
- **Local checkout validation** — the runner does **not** clone. A
  repository must point at an existing local Git work tree with a matching
  `origin`, a clean tree, and the target branch available. Invalid checkouts
  move the job to `BLOCKED`.
- **Work branch** — the runner checks out the target branch and creates a
  local-only `flawferret/job-<short-id>` branch. It refuses to overwrite an
  existing branch.
- **Codex approval gate** — the job stops at `READY_FOR_CODEX` and waits for
  a manual approval (`POST /jobs/:id/approve-codex`). With
  `FERRET_RUNNER_ENABLE_CODEX=false` (default) approved jobs only record the
  invocation plan.
- **Validation** — runs after Codex. Command resolution order:
  `FERRET_RUNNER_VALIDATION_COMMAND` global override, then a focused command
  suggested in Codex's final response, then the repository's configured
  `validationCommand`. With none configured, validation only checks that
  Codex left changed files.
- **PR approval gate** — the job stops at `REVIEW` and waits for
  `POST /jobs/:id/approve-pr`. With `FERRET_RUNNER_ENABLE_PR_CREATION=false`
  (default) no branch is pushed and no PR is created. When enabled, the
  runner commits, pushes, and opens a **draft** PR.
- **PR check auto-heal** — on a failed PR check the runner can re-queue the
  job for a bounded number of automatic retries
  (`autoRetryCount`, `FERRET_RUNNER_MAX_AUTO_RETRIES`, default 2) with
  race-safe queuing.
- **Local checkout cleanup** — the runner restores the checkout to its base
  branch afterward and records cleanup success or failure.
- **Readiness view** — `GET /readiness` and the dashboard readiness page
  summarize queue state, runner health, blocked jobs, pending approvals, and
  a single suggested next action.

### Framework Builder (`/framework/new`)

Scaffolds a new Playwright + Cucumber/BDD test framework repository from a
template. Preview the file set, then create it either in a local directory or
as a brand-new GitHub repository. Optional follow-up actions: install
dependencies and run a smoke test (automatic by default for local builds),
initialize a Git repository, register the result as a FlawFerret2
repository, and open the folder. Build history lives at `/framework/builds`.

### Discover Tests (`/discover`)

Given a page URL, tester notes, and the repository's existing Cucumber
coverage, produces AI test-scenario recommendations with impact ratings,
tags, and acceptance criteria. Keep/hide decisions are saved as a
`DiscoverRun`, and selected titles can be queued as jobs.

### Feature catalog & local test runs (`/features`)

Browses the Cucumber features and scenarios in a registered checkout,
explains a scenario in plain language with AI, and runs a single feature or
scenario locally (`LocalTestRun`) with captured stdout/stderr and pass-rate
stats.

### Tracker (Jira) integrations (`/integrations`)

Stores Jira credentials as reusable `TrackerIntegration` records, attaches
them to repositories, and creates a Jira ticket as part of the job pipeline.
The browser extension can also create tickets directly.

### Browser extension (`apps/extension`)

Chrome MV3, vanilla TypeScript. Right-click any element to capture URL,
title, DOM snippet, screenshot, selected element and locator candidates,
console errors, network events, and notes. From the overlay: create a Jira
ticket, or open a prefilled `ADD_PLAYWRIGHT_TEST` job in the dashboard. AI
scenario generation uses a separate AI server (not in this repo).

## Not done yet

- No repository cloning — checkouts must be prepared by hand.
- Codex execution and PR creation are off by default and require per-job
  approvals even when enabled.
- Generated work branches are local-only unless PR creation is enabled.
- Only one job type (`ADD_PLAYWRIGHT_TEST`). Other types in `VISION.md`
  (`INVESTIGATE_FAILURE`, `FIX_FAILED_TEST`, `CREATE_BUG_REPORT`, …) are not
  implemented.

## Monorepo layout

pnpm workspace (`pnpm-workspace.yaml`), Node >=22, `pnpm@11.7.0`.

| Path | Purpose |
| --- | --- |
| `apps/api` | Fastify + Zod API; routes in `src/server.ts`; OpenAPI UI at `/documentation`; [published docs](https://rgmichaels.github.io/flawferret2/). |
| `apps/web` | Next.js dashboard. |
| `apps/ferret-runner` | Worker service — claims jobs and orchestrates checkout / Codex / validation / PR steps. |
| `apps/extension` | Chrome (MV3) capture extension. |
| `packages/db` | Prisma schema and DB helpers. |
| `packages/job-schemas` | Shared Zod schemas used by `apps/api` and `apps/web`. |
| `packages/shared` | Shared TypeScript utilities and types. |

## Commands

From the repo root (each fans out via `pnpm -r`):

```bash
pnpm build
pnpm check
pnpm dev
pnpm lint
pnpm test
pnpm typecheck
```

`lint` is `tsc --noEmit` in every package — there is no ESLint or Prettier in
this repo. Tests run through Node's built-in runner (`tsx --test`;
`apps/extension` uses `node --test`) and are colocated as `foo.ts` +
`foo.test.ts`.

Prisma (`packages/db`): `pnpm --filter @flawferret2/db db:generate`,
`db:migrate`, `db:studio`, `db:validate`.

Extension (`apps/extension`): `pnpm --filter @flawferret2/extension build`,
`dev`, `build:release`.

## Running locally

1. Copy `.env.example` to `.env` and set `DATABASE_URL` to a Neon Postgres
   connection string. Optional: `SLACK_WEBHOOK_URL` (milestone
   notifications to `#ff2-logs`), `OPENAI_API_KEY` (Discover Tests and
   scenario explanations), `GITHUB_TOKEN` (Framework Builder GitHub repos
   and PR creation). Repositories can also set their own validation command
   in the web UI; `FERRET_RUNNER_VALIDATION_COMMAND` is a global override.

2. Install and set up the database:

   ```bash
   pnpm install
   pnpm --filter @flawferret2/db db:generate
   pnpm --filter @flawferret2/db db:migrate
   ```

3. Start the API and web app:

   ```bash
   pnpm --filter @flawferret2/api dev
   pnpm --filter @flawferret2/web dev
   ```

4. Start `ferret-runner` when you want to claim queued jobs:

   ```bash
   pnpm --filter @flawferret2/ferret-runner dev
   ```

The API defaults to `http://localhost:4000`, the web app to
`http://localhost:3000`. `ferret-runner` starts in dry-run mode
(`FERRET_RUNNER_ENABLE_CODEX=false`, `FERRET_RUNNER_ENABLE_PR_CREATION=false`).
See [`apps/ferret-runner/README.md`](apps/ferret-runner/README.md) for the
safe first-live-run checklist before enabling Codex or PR creation.

## Configuration

The core environment is validated with Zod in `apps/api/src/config.ts`
(API) and `apps/ferret-runner/src/config.ts` (worker); per CLAUDE.md, new
variables should go in those schemas rather than raw `process.env` reads
(a few older feature flags still read `process.env` directly). Key
variables:

| Variable | Used by | Default |
| --- | --- | --- |
| `DATABASE_URL` | all | — (required) |
| `API_HOST` / `API_PORT` | api | `0.0.0.0` / `4000` |
| `WEB_ORIGIN` | api | `http://localhost:3000` |
| `NEXT_PUBLIC_API_URL` | web | `http://localhost:4000` |
| `FERRET_RUNNER_ENABLE_CODEX` | runner | `false` |
| `FERRET_RUNNER_ENABLE_PR_CREATION` | runner | `false` |
| `FERRET_RUNNER_VALIDATION_COMMAND` | runner | unset (per-repo command used) |
| `FERRET_RUNNER_MAX_AUTO_RETRIES` | runner | `2` |
| `CODEX_COMMAND` | api, runner | `codex` |
| `CODEX_MODEL` / `CODEX_TIMEOUT_MS` | runner | unset / 20 min |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | api (Discover, explanations) | — / `gpt-4.1-mini` |
| `GITHUB_TOKEN` | api (Framework Builder GitHub repos / PRs) | — |
| `SLACK_WEBHOOK_URL` | api, runner | unset |
| `WORKER_*` | runner | see `.env.example` |

## Development

Implementation is driven through the subagent pipeline in `.claude/agents/`
(visionary / qa-strategist -> product-manager -> graphic-designer -> coder ->
code-reviewer -> qa-strategist release gate). Specs live in `docs/specs/`.
Work is tracked in the `FLW` Jira project.

## History

The project was built layer by layer, proving one stage before adding the
next. See [`CHANGELOG.md`](CHANGELOG.md) for the milestone-by-milestone
history.
