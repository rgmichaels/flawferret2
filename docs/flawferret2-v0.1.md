# FlawFerret2 Vision and Architecture v0.1

## Product Definition

FlawFerret2 is not a browser extension. It is an AI-powered QA orchestration platform whose purpose is to manage engineering work, invoke coding agents, validate results, and deliver GitHub pull requests.

The FlawFerret browser extension remains the lightweight capture interface. FlawFerret2 is the operations platform.

## Component Names

- Product: FlawFerret2
- Web dashboard: `apps/web`
- Backend API: `apps/api`
- Worker service: `apps/ferret-runner`
- Shared job schemas: `packages/job-schemas`
- Database package: `packages/db`
- Shared utilities: `packages/shared`

The service is called `ferret-runner`. Individual running instances are called workers.

## System Flow

```text
Browser Extension
  -> FlawFerret2 Web Application
  -> API
  -> State Database
  -> ferret-runner Worker
  -> Codex
  -> Playwright Validation
  -> GitHub Pull Request
```

## Responsibility Boundaries

### Browser Extension

The FlawFerret browser extension captures browser context:

- Current URL
- Selected DOM element
- Screenshot
- Console errors
- Network information
- DOM snippet
- Accessible role and name
- CSS and XPath locator candidates
- User notes

The extension should not orchestrate workers, display execution logs, or manage pull requests.

### FlawFerret2 Web Application

The web app is the command center for humans:

- Create jobs
- View queue status
- Inspect job details
- Review execution logs
- View worker status
- Open generated pull requests
- Manage repositories and settings

### API

The API owns external access to orchestration state:

- Repository registration
- Job creation
- Job lookup
- Worker claim and heartbeat endpoints
- Run and event updates
- Authentication and authorization

### ferret-runner

The runner owns orchestration:

- Claim queued jobs atomically
- Clone or update repositories
- Create working branches
- Invoke Codex
- Run Playwright
- Run lint and type checks where configured
- Commit changes
- Push branches
- Create draft pull requests
- Update job, run, worker, and event state

### Codex

Codex owns code changes inside the target repository:

- Read the repository
- Understand project structure
- Modify tests and supporting code
- Run relevant commands
- Repair failures
- Explain blockers

Codex does not own queue state, worker scheduling, or database status transitions.

## Initial Technology Stack

- Frontend: Next.js
- API: Fastify and TypeScript
- Database: PostgreSQL, initially Neon
- Worker: Node.js and TypeScript
- Agent: Codex CLI initially, Codex SDK later
- Validation: Playwright
- Source control: GitHub

## Initial Repository Layout

```text
apps/
  web/
  api/
  ferret-runner/
packages/
  db/
  job-schemas/
  shared/
docs/
infra/
```

## State Database

The database stores orchestration state, not product application data from target repositories.

Initial tables:

- `repositories`
- `jobs`
- `runs`
- `events`
- `workers`

## Queue Philosophy

The queue coordinates work. Workers process jobs. Each worker handles one job at a time.

Workers should claim jobs atomically so parallel workers do not duplicate work. PostgreSQL row locking with `FOR UPDATE SKIP LOCKED` is sufficient for v0.1.

## Job Statuses

Initial job statuses:

- `QUEUED`
- `RUNNING`
- `REVIEW`
- `COMPLETED`
- `FAILED`
- `CANCELED`

`REVIEW` means the runner produced a pull request and human review is required.

## Run Statuses

Initial run statuses:

- `STARTED`
- `CODEX_RUNNING`
- `VALIDATING`
- `PUSHING`
- `PR_CREATED`
- `SUCCEEDED`
- `FAILED`

Runs are execution attempts for a job.

## Initial Job Type

The first supported job type is `ADD_PLAYWRIGHT_TEST`.

Future job types may include:

- `INVESTIGATE_FAILURE`
- `FIX_FAILED_TEST`
- `REVIEW_PR_FOR_TEST_GAPS`
- `CREATE_BUG_REPORT`
- `VERIFY_BUG_FIX`
- `ADD_REGRESSION_TEST`
- `REFACTOR_TEST_CODE`
- `UPDATE_TEST_FOR_UI_CHANGE`

## ADD_PLAYWRIGHT_TEST Payload

Initial fields:

- `repositoryId`
- `targetBranch`
- `featureArea`
- `goal`
- `targetUrl`
- `acceptanceCriteria`
- `priority`
- `runAffectedTestsOnly`
- `createDraftPr`
- `captureContext`

`captureContext` may include:

- `url`
- `title`
- `selectedElement`
- `domSnippet`
- `screenshotAssetId`
- `consoleErrors`
- `networkEvents`
- `accessibleRole`
- `accessibleName`
- `locatorCandidates`
- `notes`

## v0.1 Milestone

The first implementation milestone is a complete vertical slice:

1. Register a repository.
2. Create an `ADD_PLAYWRIGHT_TEST` job from the web app.
3. Store the job in Postgres.
4. Claim the job from `ferret-runner`.
5. Prepare a working branch.
6. Invoke Codex with a structured task prompt.
7. Run Playwright validation.
8. Commit and push changes.
9. Create a draft GitHub pull request.
10. Display job status, events, and PR link in the dashboard.

## Explicit Non-Goals for v0.1

- Full browser extension integration
- Multiple job types
- Autonomous job discovery
- CI failure repair
- Multi-tenant billing
- Complex worker autoscaling
- Replacing human code review
