# Repo-Level CLAUDE.md

Status: Draft
Date: 2026-08-14

## Problem

FLW-11 says "CLAUDE.md file should be created" with no detail. There is currently
no `CLAUDE.md` anywhere in the repo (confirmed: `find . -iname CLAUDE.md` returns
nothing at root or in any `apps/*` / `packages/*` directory). Claude Code has no
automatically-loaded project instructions, so every session has to rediscover the
monorepo layout, build/test commands, the subagent pipeline, and repo conventions
from scratch.

## Proposed change

Add a single `CLAUDE.md` at the repo root (`/Users/robertmichaels/Documents/code/flawferret2/CLAUDE.md`).
No app-level `CLAUDE.md` files for now — the repo is small enough that one root
file covers it (open question below on whether this should change later).

Content, grounded in what's actually in the repo today:

1. **Project summary** — one paragraph, pulled from `README.md` / `VISION.md`:
   FlawFerret2 is an AI QA orchestration platform; `ADD_PLAYWRIGHT_TEST` is the
   only job type in Version 1; pipeline is Browser -> Web -> API -> DB -> Worker
   -> Codex -> Playwright -> GitHub PR.

2. **Monorepo layout** — table or list of `apps/api`, `apps/web`,
   `apps/ferret-runner`, `apps/extension`, `packages/db`, `packages/job-schemas`,
   `packages/shared`, with a one-line purpose for each (Fastify API, Next.js
   dashboard, job-claiming worker, browser extension capture UI, Prisma schema
   package, shared job payload/event schemas, shared utilities).

3. **Package manager and workspace** — pnpm workspace (`pnpm-workspace.yaml`),
   Node >=22, `packageManager: pnpm@11.7.0` from root `package.json`.

4. **Build/test/lint commands**, taken directly from root and per-package
   `package.json` scripts (do not invent new ones):
   - Root: `pnpm build`, `pnpm check`, `pnpm dev`, `pnpm lint`, `pnpm test`,
     `pnpm typecheck` (all fan out via `pnpm -r`).
   - Per-app dev commands from README "Running Locally": `pnpm --filter
     @flawferret2/api dev`, `pnpm --filter @flawferret2/web dev`, `pnpm --filter
     @flawferret2/ferret-runner dev`.
   - Note that `lint` is currently just `tsc --noEmit` in every package (no
     ESLint/Prettier config exists in the repo) — so "lint" and "typecheck" are
     effectively the same check today.
   - Prisma commands: `pnpm --filter @flawferret2/db db:generate`, `db:migrate`,
     `db:studio`, `db:validate`.
   - Test runner is Node's built-in `--test` via `tsx --test` (not Jest/Vitest).

5. **Database / job lifecycle pointers** — tell Claude to treat
   `packages/db/prisma/schema.prisma` as the source of truth for `JobStatus`
   and `JobEventType`, and to check `apps/api/src/server.ts` and
   `packages/job-schemas` before adding or assuming any API route or payload
   shape. Do not restate the full enum lists in CLAUDE.md (they'll drift) —
   just point at the files.

6. **Environment setup** — `.env.example` exists at root; copy to `.env`, set
   `DATABASE_URL` (Neon Postgres), optional `SLACK_WEBHOOK_URL`, optional
   `FERRET_RUNNER_VALIDATION_COMMAND`.

7. **Subagent pipeline** — describe the chain defined in `.claude/agents/`:
   `visionary` / `qa-strategist` -> `product-manager` -> `graphic-designer` ->
   `coder` -> `code-reviewer`, one line per agent's role (pulled from each
   agent's own file, not reinvented). Note that `qa-strategist` has release-gate
   authority over `code-reviewer` (per recent commit `7ccc5a1`). This section
   should say where to look (`.claude/agents/*.md`) rather than duplicate each
   agent's full prompt.

8. **Conventions / gotchas** worth calling out explicitly because they're easy
   to get wrong or aren't obvious from file layout alone:
   - TypeScript strict mode is on repo-wide (`tsconfig.base.json`); NodeNext
     module resolution.
   - No ESLint/Prettier — don't propose adding lint tooling as a drive-by
     change inside an unrelated spec/PR.
   - Specs live in `docs/specs/*.md`, written by `product-manager` (this
     process) before `coder` implements.
   - Milestone history in `README.md` documents what's *already* built —
     check it before assuming a feature ("Codex invocation", "Playwright
     validation", "GitHub PR creation" are still pipeline stages not yet
     built per VISION.md, unless a later milestone/commit says otherwise).
   - Git branch/PR naming convention observed in `git log`: `Add/Improve/Fix
     <thing>` style commit subjects; ticket-prefixed branch names like
     `flw-9-flw-10-framework-wizard-fixes`.

9. Keep the file itself concise — it should be a map and a set of pointers to
   real files (`VISION.md`, `README.md`, `packages/db/prisma/schema.prisma`,
   `.claude/agents/`), not a duplicate of their contents. Long enough to save a
   fresh session from re-deriving the basics, short enough to stay accurate as
   the repo evolves.

No code, schema, or route changes. No migration. This is a single new
markdown file at the repo root.

## User stories / acceptance criteria

- As a developer starting a new Claude Code session in this repo, when the
  session loads, then it automatically has accurate info on monorepo layout,
  build/test/lint commands, and where to find job-lifecycle and API
  conventions, without needing to be told.
- Given `CLAUDE.md` is written, when I run `find . -iname CLAUDE.md -not -path
  "*/node_modules/*"`, then exactly one file is returned, at repo root.
- Given the commands listed in `CLAUDE.md`, when each one is run from repo
  root (`pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm --filter
  @flawferret2/db db:generate`, etc.), then it succeeds or fails for reasons
  unrelated to the command being wrong (i.e., the commands as documented
  actually exist in the relevant `package.json`).
- Given the subagent pipeline section, when compared against `.claude/agents/`,
  then every agent file present is mentioned and the stated order/authority
  (e.g. qa-strategist's release-gate authority over code-reviewer) matches the
  agent files' own descriptions.
- Given the "what's built" framing, when compared against `README.md`'s
  milestone list, then `CLAUDE.md` does not claim Codex/Playwright/GitHub PR
  automation is implemented if the latest milestone in `README.md` says
  otherwise.
- As a reviewer, I can read `CLAUDE.md` top to bottom in under a few minutes
  and come away with an accurate mental model of the repo (rough guide: not
  dramatically longer than the existing `README.md`).

## Out of scope

- Per-app `CLAUDE.md` files (e.g. `apps/api/CLAUDE.md`) — not requested, and
  the repo is small enough that a root file is likely sufficient for now.
- Adding ESLint/Prettier or any new tooling — `CLAUDE.md` documents the repo
  as it is today.
- Restating the full `JobStatus`/`JobEventType` enum contents or full API
  route list inline — point at the source files instead so the doc doesn't
  silently go stale.
- Any change to `.claude/agents/*.md` files themselves.
- Setting up CI to lint/validate `CLAUDE.md` content — out of scope for this
  pass.

## Open questions

- Should `CLAUDE.md` also document the `apps/extension` build/release flow
  (`build.mjs`, `build:release` version bump) in the same depth as the other
  apps, or just a one-liner? Defaulting to a one-liner unless told otherwise.
- Should this spec's acceptance criteria be checked by `code-reviewer` reading
  the file, or is a human skim sufficient for a docs-only change? Defaulting
  to normal `code-reviewer` pass since it's still part of the pipeline.
