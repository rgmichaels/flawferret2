# FlawFerret2

FlawFerret2 is an AI-powered QA orchestration platform for turning captured browser context and human intent into validated engineering pull requests.

The original FlawFerret browser extension remains the capture interface. FlawFerret2 is the command center: it stores jobs, coordinates workers, invokes Codex, validates results with Playwright, and opens GitHub pull requests for human review.

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
