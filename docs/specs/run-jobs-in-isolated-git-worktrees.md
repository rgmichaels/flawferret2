# Run jobs in isolated git worktrees instead of the user's local checkout

Status: Draft
Date: 2026-10-06

## Problem

`ferret-runner` currently does all of its work — target-branch checkout, work-branch
creation, Codex edits, validation, commit, push, draft PR, and post-merge cleanup —
directly inside the user's configured `Repository.localPath` checkout
(`apps/ferret-runner/src/repository-checkout.ts`, `work-branch.ts`, `pull-request.ts`,
`local-checkout-cleanup.ts`). This causes four concrete problems:

1. Any uncommitted change in the user's checkout blocks the job
   (`validateRepositoryCheckout`'s `git status --porcelain` check moves the job to
   `BLOCKED`), even though the user's dirty tree has nothing to do with what the job
   is about to build.
2. The runner switches branches (`git switch --detach`, `git switch -c`) in the
   folder the user is actively working in, out from under them.
3. Two jobs on the same repository collide — only one work tree exists, so a second
   job can't run concurrently (and `prepareWorkBranch` already refuses if the
   generated branch name exists, but that doesn't stop two jobs stepping on the same
   checked-out files).
4. Post-merge cleanup (`cleanupMergedPullRequestCheckout`) switches the user's
   checkout back to the base branch and runs `git pull --ff-only` on it — again,
   underneath whatever the user is doing.

## Proposed change

Give every job its own disposable `git worktree` instead of operating in
`Repository.localPath`. `Repository.localPath` remains the one git repo the runner
reads from (for `fetch`/`worktree add`) and, optionally, fast-forwards after merge —
but no job ever runs its branch-switch/edit/commit/push steps there.

Per job, in `apps/ferret-runner`:

1. **Checkout validation** (`repository-checkout.ts`) — drop the
   `git status --porcelain` clean-tree requirement. Keep: path exists, is a git work
   tree, `origin` matches the registered repository, target branch resolvable
   locally or on `origin` after `git fetch --prune origin`.
2. **Worktree + work branch creation** (replaces `work-branch.ts`'s in-place
   `switch --detach` / `switch -c`) — a new `worktree.ts` module:
   - `git fetch --prune origin` (in `Repository.localPath`).
   - `git worktree add --detach <worktreeRoot>/job-<jobId> origin/<targetBranch>`
     (falls back to the local target-branch ref if `origin/<targetBranch>` doesn't
     exist, same resolution order `work-branch.ts` uses today).
   - `git -C <worktreePath> switch -c flawferret/job-<jobId>` inside the new
     worktree, using the **full job id** (or a much longer prefix) rather than an
     8-character slice — see Decisions.
   - `worktreeRoot` is a **runner-wide directory outside the user's checkout**,
     namespaced per repository (see Config below) — never a subdirectory of
     `Repository.localPath`, so the user's `git status` in their own checkout is
     never affected by worktree creation.
   - Refuse (and `BLOCKED`, same as today) if a worktree directory for this job id,
     or a branch of the same name, already exists.
3. **Everywhere downstream that currently takes `localPath` from run metadata**
   (`codex-invocation.ts`, `validation.ts`, `pull-request.ts`'s `createDraftPullRequest`
   / `inspectPullRequestLifecycle` / `fetchFailingCheckLogs`) — operate on the
   **worktree path**, not `Repository.localPath`. The run-metadata field currently
   called `localPath` (set in `apps/ferret-runner/src/index.ts`'s `runMetadata` and
   threaded through every stage) becomes the worktree path; a new field
   (`repositoryLocalPath`) carries the original `Repository.localPath` forward for
   the few steps that still need it (fetch, post-merge base-branch fast-forward).
4. **Dependency install** (new step, addresses the fresh-worktree problem) — a
   worktree has no `node_modules`. Before `validation.ts` runs the validation
   command, run a per-repository install command in the worktree. Resolution order
   mirrors the existing validation-command precedence: new `Repository.installCommand`
   (nullable, settable from the same place `validationCommand` is set in the web UI)
   falling back to a global `FERRET_RUNNER_INSTALL_COMMAND` env var, falling back to
   `pnpm install --frozen-lockfile` if the worktree repo root has a `pnpm-lock.yaml`,
   else skipped with a recorded reason. The latency/cost this adds per job is
   accepted for v1 — see Decisions; caching stays out of scope.
5. **Worktree cleanup and retention** — a new `removeWorktree` helper (`git worktree
   remove --force <path>`, then `git worktree prune` as a safety net; also delete the
   `flawferret/job-<id>` branch via `git branch -D` from `Repository.localPath` since
   the worktree that held it is gone). Cleanup behavior differs by outcome — see
   Decisions for the retention policy:
   - **`PR_MERGED`** — worktree and branch are removed immediately, as part of the
     existing post-merge cleanup step, after the base-branch fast-forward attempt.
   - **Terminal failure/`BLOCKED`/`PR_CLOSED`** — the worktree is *not* removed
     immediately. It is retained for `FERRET_RUNNER_WORKTREE_RETENTION_HOURS` (so a
     human can `cd` into it to debug, or an auto-retry can reuse its state) and
     removed later by the orphan sweep once that window has elapsed.
   - Worktrees for jobs still mid-flight (`REVIEW`, `PR_APPROVED`, `PR_CREATED`,
     `CHECKS_PENDING`/`CHECKS_FAILED` with auto-retry budget remaining) are never
     touched by cleanup or the sweep — only terminal states start the retention
     clock.
6. **Post-merge cleanup** (`local-checkout-cleanup.ts`) — rename/repurpose: no more
   `git switch <base>` in the user's checkout. Instead:
   - If `Repository.localPath`'s current branch is the base branch **and** its tree
     is clean, run `git pull --ff-only` there to fast-forward it. Otherwise skip the
     fast-forward silently and record `{ skipped: true, reason: "dirty-tree" |
     "wrong-branch" }` in cleanup metadata — never switch, stash, reset, or clean the
     user's files.
   - Always: remove the job's worktree and delete the local
     `flawferret/job-<id>` branch from `Repository.localPath` (the worktree
     branch, not anything the user created).
7. **Orphan sweep (startup + periodic)** — for each registered repository with a
   `localPath`, run `git worktree list --porcelain` and remove:
   - worktrees belonging to a job whose terminal (`BLOCKED`/`FAILED`/`CANCELED`) or
     `PR_CLOSED` transition happened more than `FERRET_RUNNER_WORKTREE_RETENTION_HOURS`
     ago — the normal retention-expiry path described in item 5;
   - worktrees with no matching job row in the DB at all (true orphans — e.g. a
     runner crash lost track of the job, or the job row was deleted) — removed
     regardless of age, since there is nothing left to retain them for.
   The sweep runs once at `ferret-runner` startup and then on an interval while the
   process is running (see Config). This handles worktrees orphaned by a runner
   crash mid-job, in addition to normal retention-window expiry.

### Data model

No new tables; no migration required for `Run.metadata` or `Job` since both already
carry free-form `Json` metadata (`Run.metadata: Json?`, `JobEvent.metadata: Json?` in
`packages/db/prisma/schema.prisma`). New run-metadata fields (`worktreePath`,
`repositoryLocalPath`, `installCommand`, install result, terminal-transition
timestamp used for retention expiry) are additive JSON keys, not schema changes.

One schema change is needed: `Repository.installCommand String? @map("install_command")`,
alongside the existing `validationCommand` column — this **does** need a Prisma
migration (`pnpm --filter @flawferret2/db db:migrate`) plus a small web UI addition
wherever `validationCommand` is currently editable (repository settings) and a
`job-schemas` update if that field is part of any repository request/response schema.

New `JobEventType` values (append-only, per CLAUDE.md's instruction to call out enum
changes explicitly):
- `WORKTREE_CREATED` — emitted alongside/replacing today's `WORK_BRANCH_CREATED` once
  the worktree + branch both exist; carries `worktreePath`, `workBranch`, `baseCommit`.
- `WORKTREE_CREATION_FAILED` — worktree `add` failed for a reason other than "branch
  already exists" (which still maps to today's `JOB_BLOCKED`).
- `WORKTREE_REMOVED` — emitted whenever a worktree is cleaned up, with `reason`
  (`pr-merged` | `retention-expired` | `orphan-sweep`) and `ok` in metadata.
- `WORKTREE_REMOVAL_FAILED` — `git worktree remove` failed (e.g. still has untracked
  files and `--force` wasn't enough, or path already gone); job/run isn't blocked on
  this, but it's surfaced for operator visibility.
- `DEPENDENCY_INSTALL_STARTED`, `DEPENDENCY_INSTALL_COMPLETED`,
  `DEPENDENCY_INSTALL_FAILED` — around the new install step. A failed install does
  **not** auto-block the job; it flows into validation the same way a failed
  validation command does today (surfaced as a validation failure, eligible for the
  existing retry/auto-heal path), since the repository may genuinely not need an
  install step.

`WORK_BRANCH_PREPARATION_STARTED` / `TARGET_BRANCH_CHECKED_OUT` / `WORK_BRANCH_CREATED`
are kept for backward-compatible event history reading, but their emission sites move
from `work-branch.ts` to the new `worktree.ts`, and their `message`/`metadata` text
updates to describe worktree operations rather than in-place checkout switches.

### Config (`apps/ferret-runner/src/config.ts`)

New Zod-schema env vars (not raw `process.env` reads, per CLAUDE.md):
- `FERRET_RUNNER_WORKTREE_DIR` — optional string, the runner-wide root directory for
  all job worktrees, outside any repository's checkout. Default:
  `<os.homedir()>/.flawferret/worktrees`. Worktrees are created at
  `<FERRET_RUNNER_WORKTREE_DIR>/<repositoryId>/job-<jobId>`.
- `FERRET_RUNNER_WORKTREE_RETENTION_HOURS` — optional int, positive, default `24`.
  How long a failed/`BLOCKED`/`PR_CLOSED` job's worktree is kept before the orphan
  sweep removes it.
- `FERRET_RUNNER_WORKTREE_SWEEP_INTERVAL_MS` — optional int, positive, default 1 hour.
  How often the periodic orphan sweep runs after the startup sweep.
- `FERRET_RUNNER_INSTALL_COMMAND` — optional string, global install-command fallback
  (mirrors `FERRET_RUNNER_VALIDATION_COMMAND`'s existing precedence pattern).
- `FERRET_RUNNER_INSTALL_TIMEOUT_MS` — optional int, default e.g. 5 minutes, mirrors
  `FERRET_RUNNER_LOCAL_TEST_TIMEOUT_MS`'s pattern.

### Files likely touched

- `apps/ferret-runner/src/repository-checkout.ts` — drop clean-tree check.
- `apps/ferret-runner/src/work-branch.ts` — replaced by new `worktree.ts` (or heavily
  rewritten in place); `buildWorkBranchName` updates to use the full job id (or a
  much longer prefix) instead of an 8-character slice.
- New `apps/ferret-runner/src/worktree.ts` — create/remove/list worktrees, orphan
  sweep (startup + periodic timer), retention-expiry logic.
- New `apps/ferret-runner/src/dependency-install.ts` — install-command resolution + run,
  modeled on `validation.ts`'s `runValidationCommand`.
- `apps/ferret-runner/src/validation.ts` — invoke dependency-install before the
  validation command; both now run with `cwd` = worktree path.
- `apps/ferret-runner/src/codex-invocation.ts` — confirm it already takes `localPath`
  from run metadata (it does, per `index.ts` call sites) — just needs the renamed
  field.
- `apps/ferret-runner/src/pull-request.ts` — `localPath` param becomes the worktree
  path for `createDraftPullRequest`, `inspectPullRequestLifecycle`,
  `fetchFailingCheckLogs`; no functional change beyond that, since commit/push/`gh pr`
  already operate relative to whatever `cwd` is passed in.
- `apps/ferret-runner/src/local-checkout-cleanup.ts` — rewrite per item 6 above
  (conditional fast-forward + worktree/branch removal instead of unconditional
  switch+pull+branch-delete in the user's checkout).
- `apps/ferret-runner/src/index.ts` — orchestration: thread `worktreePath` /
  `repositoryLocalPath` through `runMetadata`, call new worktree create/remove at the
  right points, start the periodic sweep timer alongside startup sweep, new job
  events.
- `apps/ferret-runner/src/config.ts` — new env vars above.
- `packages/db/prisma/schema.prisma` — add `JobEventType` values; add
  `Repository.installCommand`; migration via `db:migrate`.
- `packages/job-schemas` — update repository request/response schema if
  `installCommand` is exposed there (check alongside `validationCommand`'s existing
  shape).
- `apps/web/app/**` wherever repository `validationCommand` is currently set in the
  UI — add the parallel `installCommand` field.
- `README.md`'s "Local checkout validation" / "Work branch" / "Local checkout
  cleanup" bullets under "What's built today" — update to describe worktree
  behavior instead of in-place checkout mutation.

## User stories / acceptance criteria

- As a user with uncommitted local changes in my checkout, I can still have a job
  claimed and run against the latest `origin/<targetBranch>`, because the runner
  works in a separate worktree and never touches my uncommitted files.
- As a user, while a job is running, my checkout's current branch and `HEAD` never
  change underneath me — `git status` and `git branch --show-current` in my checkout
  are unaffected by a job in progress, and `git status` in my checkout never shows a
  worktree directory as untracked (worktrees live entirely outside the checkout, at
  `FERRET_RUNNER_WORKTREE_DIR`).
- As a user, I can have two jobs against the same repository running concurrently
  (e.g. one `RUNNING`/`VALIDATING`, one `READY_FOR_CODEX`) without either failing due
  to a locked/shared working directory. (Whether `ferret-runner`'s claim loop
  actually claims/processes two jobs for the same repository at once is a separate,
  out-of-scope change — this criterion covers the worktree-level blocker only.)
- Given a job whose worktree creation fails for a reason other than "branch already
  exists" (e.g. disk full, permissions), when the runner attempts `git worktree add`,
  then the job is `BLOCKED` and a `WORKTREE_CREATION_FAILED` event is recorded with
  the git error.
- Given a job reaches a terminal failure, `BLOCKED`, or `PR_CLOSED` state after its
  worktree was created, when the runner processes that transition, then the worktree
  is left in place (not removed immediately) and the transition time is recorded for
  retention purposes.
- Given a retained worktree's age (since its terminal transition) exceeds
  `FERRET_RUNNER_WORKTREE_RETENTION_HOURS`, when the next orphan sweep (startup or
  periodic) runs, then the worktree and its `flawferret/job-<id>` branch are removed
  and a `WORKTREE_REMOVED` event (`reason: "retention-expired"`) is recorded.
- Given a job's PR is merged, when post-merge cleanup runs, then: the worktree and
  branch are removed immediately; if the user's `Repository.localPath` is clean and
  on the base branch, it is fast-forwarded via `git pull --ff-only`; if it is dirty
  or on a different branch, the fast-forward is skipped and recorded as skipped (not
  attempted, not forced) in cleanup metadata — the user's working folder is never
  switched, stashed, or reset.
- Given `ferret-runner` restarts after a crash that left a worktree with no matching
  job row in the DB, when the runner starts up, then the orphan sweep removes that
  worktree immediately (no retention window applies to true orphans) and
  logs/records the cleanup (`reason: "orphan-sweep"`).
- Given a repository has no `validationCommand`/`installCommand` configured and no
  `pnpm-lock.yaml` in the worktree, when validation runs, then the install step is
  skipped with a recorded reason, and today's existing "no validation command
  configured → check Codex left changed files" behavior is unchanged.
- Given a repository with a `pnpm-lock.yaml`, when a job's worktree is created and
  validation runs, then `pnpm install --frozen-lockfile` (or the configured override)
  runs in the worktree before the validation command, and its result is recorded via
  `DEPENDENCY_INSTALL_*` events. The added latency is accepted for v1 (see Decisions).

## Decisions

These were open questions in the prior draft; the user has resolved them.

1. **Dependency-install cost per job** — accepted as a cost of v1. Install caching
   across jobs/worktrees (shared `node_modules`, pnpm store reuse, etc.) stays out of
   scope as a follow-up, not designed here.
2. **Failed-job worktree retention** — worktrees from failed/`BLOCKED`/`PR_CLOSED`
   jobs are kept for a configurable window (`FERRET_RUNNER_WORKTREE_RETENTION_HOURS`,
   default `24`) rather than removed immediately, so they can still be inspected or
   reused. The orphan sweep (startup + periodic, see `FERRET_RUNNER_WORKTREE_SWEEP_INTERVAL_MS`)
   removes expired ones. Successful (`PR_MERGED`) jobs clean up immediately, as
   originally specced.
3. **`FERRET_RUNNER_WORKTREE_DIR` default** — a runner-wide directory *outside* the
   user's checkout (default `<os.homedir()>/.flawferret/worktrees`, namespaced per
   repository id), not `<Repository.localPath>/.flawferret-worktrees`. This keeps the
   user's `git status` in their own checkout clean regardless of worktree activity.
4. **Concurrent jobs per repository** — out of scope for this change. This spec only
   removes the worktree-level blocker that would prevent concurrency; whether
   `ferret-runner`'s claim loop actually claims/processes multiple jobs for the same
   repository at once is a separate, later change.
5. **Work-branch naming** — uses the full job id (or a much longer prefix) instead of
   the current 8-character slice, to keep collision odds negligible now that
   concurrent jobs against the same repository are expected.
6. **Windows/CRLF** — not a concern for this change; noted and not pursued further.
   `git worktree add` and `git branch -D` behave the same across the platforms this
   repo targets (macOS/Linux per its documented dev setup).

## Out of scope

- Runner-managed cloning into a cache directory when a repository has no
  `localPath` configured at all (needed for Docker/hosted runner deployments) — flag
  as a follow-up spec; this change still requires `Repository.localPath` to exist and
  be a valid git checkout, exactly as today.
- Dependency-install caching across jobs/worktrees (decision 1 above).
- Enabling true concurrent job claiming/processing for the same repository in the
  claim loop (decision 4 above) — this change only removes the worktree-level
  blocker; claim-loop concurrency is a separate, later change.
- Changing how `Repository.localPath` itself gets configured or validated as "a git
  repo with matching origin" (unchanged) beyond removing the clean-tree requirement.
- Any change to the Codex invocation, validation command *semantics*, or PR-creation
  gating/approval flags (`FERRET_RUNNER_ENABLE_CODEX`,
  `FERRET_RUNNER_ENABLE_PR_CREATION`) — only the working directory they operate in
  changes.
- Windows support investigation (decision 6 above).

## Open questions

None outstanding — see Decisions above.
