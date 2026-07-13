# FlawFerret2

FlawFerret2 is an AI-powered QA orchestration platform for turning captured browser context and human intent into validated engineering pull requests.

The original FlawFerret browser extension remains the capture interface. FlawFerret2 is the command center: it stores jobs, coordinates workers, invokes Codex, validates results with Playwright, and opens GitHub pull requests for human review.

## Milestone 1

Milestone 1 proves browser -> API -> database:

- Fastify server
- Prisma
- Neon PostgreSQL connection via `DATABASE_URL`
- `jobs` table
- `workers` table
- `GET /health`
- `POST /jobs`
- `GET /jobs`

No worker, Codex, Playwright, or GitHub pull request automation is implemented in Milestone 1.

## Milestone 2

Milestone 2 proves database queue -> worker claim -> worker status:

- `apps/worker`
- Worker registration and heartbeat in the `workers` table
- Atomic queued-job claim with PostgreSQL row locking
- Claimed jobs move from `QUEUED` to `CLAIMED`, then `RUNNING`
- The worker logs the claimed job and sleeps to simulate work

No Codex, Playwright, or GitHub pull request automation is implemented in Milestone 2.

## Running Locally

1. Copy `.env.example` to `.env` and set `DATABASE_URL` to a Neon Postgres connection string.
2. Install dependencies:

```bash
pnpm install
```

3. Generate Prisma Client:

```bash
pnpm --filter @flawferret2/db db:generate
```

4. Run database migrations:

```bash
pnpm --filter @flawferret2/db db:migrate
```

5. Start the API and web app:

```bash
pnpm --filter @flawferret2/api dev
pnpm --filter @flawferret2/web dev
```

6. Start the worker when you want to claim queued jobs:

```bash
pnpm --filter @flawferret2/worker dev
```

The API defaults to `http://localhost:4000`. The web app defaults to `http://localhost:3000`.

## v0.1 Goal

The first complete workflow is `ADD_PLAYWRIGHT_TEST`:

1. A user creates a job.
2. The API stores the job in Postgres.
3. `ferret-runner` claims the job.
4. The runner prepares the repository.
5. Codex modifies the repository.
6. Playwright validates the change.
7. The runner creates a draft GitHub pull request.
8. The job moves to review.

## Workspace

```text
apps/
  web/             Next.js dashboard and job creation UI
  api/             Fastify API
  ferret-runner/   Worker service that orchestrates jobs
packages/
  db/              Database schema and access helpers
  job-schemas/     Shared job payload schemas
  shared/          Shared TypeScript utilities and types
docs/              Architecture and product notes
infra/             Deployment and infrastructure notes
```

## Project Status

This repository is at the initial scaffolding stage. The first implementation milestone is a working `ADD_PLAYWRIGHT_TEST` vertical slice.
