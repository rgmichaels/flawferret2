# FlawFerret2 - Product Vision & Current Architecture

## Project Overview

FlawFerret2 is an AI-powered QA orchestration platform.

It is **not** simply another Playwright framework.

It is also **not** the browser extension (FlawFerret1).

FlawFerret2 is responsible for managing engineering work, orchestrating AI coding agents, validating results, and delivering GitHub pull requests.

The overall goal is to automate repetitive QA engineering work while keeping humans responsible for prioritization and final approval.

## Relationship to the Browser Extension

The FlawFerret browser extension remains the capture interface.

Its purpose is to capture testing context from a running web application.

Examples:

- URL
- DOM
- Screenshot
- Selected element
- Console errors
- Network information
- Notes

The extension should eventually offer actions such as:

- Create Bug
- Generate Gherkin
- Add Playwright Test

The extension submits structured work to FlawFerret2.

FlawFerret2 becomes the orchestration backend.

## Current Goal

Build Version 1 of FlawFerret2.

The first supported job type is:

`ADD_PLAYWRIGHT_TEST`

Everything else can be added later.

## Technology Decisions

Frontend:

- Next.js

Backend:

- Fastify
- TypeScript

Database:

- Neon PostgreSQL

ORM:

- Prisma

Worker:

- Node.js

AI:

- Codex CLI initially
- Codex SDK later

Testing:

- Playwright

Version Control:

- GitHub

## Architecture

```text
Browser
  -> FlawFerret2 Web UI
  -> Fastify API
  -> Prisma
  -> Neon PostgreSQL
  -> Worker
  -> Codex
  -> Playwright
  -> GitHub Pull Request
```

## Philosophy

The system consists of four major pieces:

1. User Interface
2. Database
3. Worker
4. Codex

Codex is not responsible for orchestration.

The worker owns orchestration.

## State Database

The database is **not** application data.

It stores orchestration state.

Examples:

- Jobs
- Workers
- Execution history
- Attempts
- PR URLs
- Logs

## Initial Database Tables

### jobs

Fields:

- id
- jobType
- status
- priority
- payload (JSON)
- createdAt
- updatedAt
- claimedBy
- claimedAt
- completedAt

The payload column stores job-specific information.

Different job types have different payloads.

### workers

Fields:

- id
- hostname
- status
- currentJob
- lastHeartbeat
- version

## Job Status

Keep the state machine intentionally simple.

```text
DRAFT
  -> QUEUED
  -> CLAIMED
  -> RUNNING
  -> VALIDATING
  -> REVIEW
  -> COMPLETED
```

Failure paths:

- FAILED
- BLOCKED
- RETRY

## Queue Philosophy

The queue coordinates work.

Workers process work.

Workers claim jobs atomically.

Each worker handles one job at a time.

The system should support multiple workers later.

## ADD_PLAYWRIGHT_TEST

This is Version 1.

Workflow:

```text
User
  -> Create Job
  -> Job stored in database
  -> Worker claims job
  -> Repository prepared
  -> Codex executes
  -> Playwright validates
  -> Draft PR created
  -> Job status becomes REVIEW
```

## Add Playwright Test Interface

This is a web interface.

It is not inside the browser extension.

The extension may eventually launch this page with prefilled context.

The page should allow users to specify:

- Repository
- Branch
- Feature Area
- Goal
- Acceptance Criteria
- Priority
- Run affected tests
- Create Draft PR

Pressing Queue Job inserts a row into the jobs table.

Status = `QUEUED`.

## Worker Responsibilities

The worker is the orchestrator.

Responsibilities:

- Claim job
- Clone or update repository
- Create working branch
- Invoke Codex
- Run Playwright
- Run lint
- Run type checking
- Commit
- Push
- Open Draft PR
- Update database

Workers should own orchestration.

Codex should own engineering work.

## Codex Responsibilities

Codex should:

- Understand the repository
- Read project conventions
- Modify files
- Execute commands
- Repair failures
- Explain blockers

Codex should not manage queue state.

## Human Workflow

```text
Human
  -> Create Job
  -> Worker
  -> Codex
  -> Draft Pull Request
  -> Human Review
  -> Merge
```

Humans remain the approval gate.

## Dashboard

Future dashboard:

- Queued Jobs
- Running Jobs
- Worker Status
- Recent Pull Requests
- Execution Timeline
- Job Logs

## Initial Repository Structure

```text
apps/
  web/
  api/
packages/
  db/
  shared/
workers/
  playwright-worker/
docs/
  ARCHITECTURE.md
  VISION.md
```

## Milestone 1

Build only the foundation.

Deliverables:

- Fastify server
- Prisma
- Neon connection
- `jobs` table
- `workers` table
- Health endpoint
- `POST /jobs`
- `GET /jobs`

Nothing else.

No Codex integration yet.

No queue processing.

No Playwright.

Goal:

Prove browser -> API -> database works.

## Milestone 2

Implement the worker.

Worker should:

- Loop forever
- Claim queued job
- Print claimed job
- Sleep

No Codex yet.

Goal:

Prove queue processing works.

## Milestone 3

Integrate Codex.

Worker should:

- Prepare repository
- Invoke Codex
- Wait for completion
- Store result

No GitHub PR yet.

## Milestone 4

Integrate Playwright.

Run validation.

Store results.

## Milestone 5

GitHub integration.

- Create branch
- Commit
- Push
- Create Draft PR
- Update database

## Development Philosophy

Never build the entire system at once.

Always prove one layer before building the next.

The desired progression is:

```text
Browser
  -> API
  -> Database
  -> Worker
  -> Codex
  -> Playwright
  -> GitHub
```

Each layer should be working before introducing the next.

## Long-Term Vision

Future job types may include:

- ADD_PLAYWRIGHT_TEST
- INVESTIGATE_FAILURE
- FIX_FAILED_TEST
- REVIEW_PR_FOR_TEST_GAPS
- CREATE_BUG_REPORT
- VERIFY_BUG_FIX
- ADD_REGRESSION_TEST
- UPDATE_TEST_FOR_UI_CHANGE
- REFACTOR_TEST_CODE

The system should eventually become an autonomous QA engineering platform capable of maintaining a Playwright test suite with minimal human effort while keeping humans responsible for approval and prioritization.
