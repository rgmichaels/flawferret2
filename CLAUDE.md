# flawferret2

## What this is

FlawFerret2 is an AI-powered QA orchestration platform. It is not another
Playwright framework, and it is not the browser extension by itself (that's
the capture interface, formerly "FlawFerret1"). This repo is the
orchestration backend: it stores jobs, coordinates workers, invokes Codex,
validates results with Playwright, and opens GitHub pull requests for human
review, while keeping humans as the approval gate. Version 1's only job type
is `ADD_PLAYWRIGHT_TEST`. The intended pipeline is:

```text
Browser -> Web -> API -> DB -> Worker -> Codex -> Playwright -> GitHub PR
```

See `VISION.md` for the full product thesis and `README.md` for milestone
history and "what's actually built" — read both before assuming a capability
exists (see Gotchas below).

## Monorepo layout

pnpm workspace, defined in `pnpm-workspace.yaml` (`apps/*`, `packages/*`).
Node >=22, `packageManager: pnpm@11.7.0` (root `package.json`). Packages
import each other via `@flawferret2/*` workspace protocol.

| Path | Purpose |
| --- | --- |
| `apps/api` | Fastify + Zod API. Routes currently live in `apps/api/src/server.ts`. |
| `apps/web` | Next.js dashboard: job creation UI, repository/run views. |
| `apps/ferret-runner` | Worker service — claims jobs, orchestrates checkout/Codex/validation/PR steps. |
| `apps/extension` | Chrome (MV3) extension capture interface, vanilla TypeScript. |
| `packages/db` | Prisma schema (`prisma/schema.prisma`) and DB access helpers. |
| `packages/job-schemas` | Shared Zod job payload/request/response schemas used by `apps/api` and `apps/web`. |
| `packages/shared` | Shared TypeScript utilities and types. |

## Commands

Run from repo root with `pnpm --filter @flawferret2/<pkg> <script>`, or from
inside a package directory with `pnpm <script>`. All of these exist in the
relevant `package.json` today — don't invent others:

- Root (each fans out via `pnpm -r`): `pnpm build`, `pnpm check`, `pnpm dev`,
  `pnpm lint`, `pnpm test`, `pnpm typecheck`.
- Per-app dev servers: `pnpm --filter @flawferret2/api dev`,
  `pnpm --filter @flawferret2/web dev`,
  `pnpm --filter @flawferret2/ferret-runner dev`.
- Prisma (`packages/db`): `pnpm --filter @flawferret2/db db:generate`,
  `db:migrate`, `db:studio`, `db:validate`.
- Extension (`apps/extension`): `pnpm --filter @flawferret2/extension build`,
  `dev` (watch), `build:release` (build + version bump).

**`lint` is currently just `tsc --noEmit` in every package** — there is no
ESLint or Prettier config in this repo. `lint` and `typecheck` run the same
check today; don't propose adding lint tooling as a drive-by change.

Tests run via Node's built-in test runner through `tsx --test` (e.g.
`apps/api`: `tsx --test src/**/*.test.ts`; `apps/extension` uses plain
`node --test tests/*.test.mjs`) — not Jest or Vitest. Tests are colocated
(`foo.ts` + `foo.test.ts`).

## Job lifecycle and API shapes — pointers, not copies

- `packages/db/prisma/schema.prisma` is the source of truth for `JobStatus`
  and `JobEventType`. This project uses event sourcing for job state — the
  `JobEventType` enum lists every lifecycle transition. Read the schema
  directly rather than trusting a summary; it drifts.
- `apps/api/src/server.ts` and `packages/job-schemas` are the source of truth
  for API routes and request/response payload shapes. Check both before
  adding or assuming an endpoint or schema exists.

## Environment setup

Copy `.env.example` to `.env`. At minimum set `DATABASE_URL` (Neon Postgres).
Optional: `SLACK_WEBHOOK_URL` (milestone notifications to `#ff2-logs`),
`FERRET_RUNNER_VALIDATION_COMMAND` (global override — repositories can also
define their own validation command via the web UI). See `.env.example` for
the full list (ferret-runner, Codex, GitHub, and worker-tuning variables).
New env vars belong in the Zod schema in `apps/api/src/config.ts`, not raw
`process.env` reads.

## Subagent pipeline

Defined in `.claude/agents/*.md` — read those files directly for full detail
(prompts, tool access, output format); this is just the map:

- `visionary` / `qa-strategist` (research mode) — propose product direction
  and feature bets before anything is scoped. `visionary` argues roadmap
  priority; `qa-strategist`'s research mode grounds ideas in QA-tooling
  practice. Neither writes specs or code.
- `product-manager` — turns a rough ask into a scoped spec
  (`docs/specs/<kebab-case-title>.md`) with user stories and acceptance
  criteria. Does not write code.
- `graphic-designer` — for `apps/web` changes needing a deliberate visual
  pass, produces a design spec (`docs/specs/design-<topic>.md`) for `coder`
  to implement. Does not write production code.
- `coder` — implements one scoped change per invocation. Signs
  human-facing messages (Slack, email) as "Josh"; Jira comments still use
  `**[coder]**`.
- `code-reviewer` — read-only review of a diff for correctness/security bugs
  and drift from repo conventions, after `coder` finishes. Cannot edit files.
- `qa-strategist` (release-gate mode) — the final go/no-go call after
  `coder` and `code-reviewer` finish: independently reruns tests/typecheck
  and verifies against the spec/Jira acceptance criteria before something
  is considered ready to merge. **`qa-strategist` has release-gate authority
  over `code-reviewer`** — code-reviewer finds bugs, qa-strategist decides
  if it actually ships. Signs human-facing messages as "Joe."

## Gotchas

- TypeScript strict mode is on repo-wide (`tsconfig.base.json`): `strict:
  true`, `module`/`moduleResolution: NodeNext`. Don't loosen it locally.
- No ESLint/Prettier anywhere in the repo — see Commands above.
- Specs live in `docs/specs/*.md`, written by `product-manager` (or
  `graphic-designer` for design specs) before `coder` implements.
- `README.md`'s milestone list is the record of what's actually built —
  check it before assuming a pipeline stage is live. As of the latest
  documented milestone (Milestone 4: job/run split with a `RunStatus`
  lifecycle), the README states no repository checkout, Codex invocation,
  Playwright validation, or GitHub PR automation is implemented yet, even
  though `apps/ferret-runner` already contains scaffolding for several of
  those steps (`codex-invocation.ts`, `validation.ts`, `pull-request.ts`) —
  confirm against README and the actual runner code, don't assume from file
  presence alone that a step is wired end-to-end and enabled by default.
- Commit/branch convention observed in `git log`: `Add/Improve/Fix <thing>`
  style commit subjects; ticket-prefixed branch names like
  `flw-9-flw-10-framework-wizard-fixes`.
