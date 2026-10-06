# Sweep worktrees of jobs that completed without a PR

Status: Draft
Date: 2026-10-06
Jira: FLW-35
Depends on: FLW-34 (`docs/specs/run-jobs-in-isolated-git-worktrees.md`, PR #119, branch `flw-34-run-jobs-in-isolated-git-worktrees`). The code referenced below lives on that branch and is not yet on `main`.

## Problem

FLW-34 gives every job its own `job-<jobId>` worktree under `FERRET_RUNNER_WORKTREE_DIR`. Worktrees for jobs that end `BLOCKED`, `FAILED`, or `CANCELED` are kept for `FERRET_RUNNER_WORKTREE_RETENTION_HOURS` and then swept. Worktrees for jobs that open a PR and merge are removed immediately by post-merge cleanup.

A job that reaches `COMPLETED` without a PR is handled by neither path. It gets `COMPLETED` from `markJobCompleted` in `apps/ferret-runner/src/index.ts` when `createDraftPr` is false (validation passed, no PR step), and nothing removes its worktree. In the FLW-34 branch, `decideWorktreeSweepAction` in `apps/ferret-runner/src/worktree.ts` only treats `BLOCKED`, `CANCELED`, and `FAILED` as retention statuses. Every other status, `COMPLETED` included, returns `keep` with reason `in-flight`. Those worktrees therefore accumulate on disk indefinitely.

## Proposed change

Extend the FLW-34 orphan sweep so that worktrees of `COMPLETED` jobs with no PR are removed after a retention window. No new `JobStatus`, no new `JobEventType`, and no migration are needed.

Files likely touched (all in `apps/ferret-runner`, after FLW-34 lands):

- `src/worktree.ts`
  - `decideWorktreeSweepAction`: add an eligibility branch for `status === "COMPLETED"` whose job has no PR. Keep the retention clock on `completedAt`. Split the current `keep` reason `in-flight` so that non-terminal jobs and "completed, within retention" are distinguishable in logs.
  - `sweepRepositoryWorktrees` / `runWorktreeSweep`: the job lookup (`findJobsForWorktreeSweep`) must return enough to decide "has a PR" (see Proposed change, PR detection below).
  - `removeJobWorktree`: pass a new removal reason for this path (see Observability).
- `src/index.ts`: `findJobsForWorktreeSweep` and the `onRemoval` callback that already emits `WORKTREE_REMOVED` / `WORKTREE_REMOVAL_FAILED`.
- `src/config.ts`: no new env var is proposed by default (see Open questions, item 2).
- `src/worktree.test.ts`: unit tests for the decision function and sweep behavior.
- `README.md` (ferret-runner / "What's built today"): one sentence describing the new retention path.

### Eligibility

A worktree is removed by the sweep only when **all** of the following hold:

1. The worktree path is `<FERRET_RUNNER_WORKTREE_DIR>/<repositoryId>/job-<uuid>`, as already enforced by `isInsideRoot` and `parseWorktreeJobId`.
2. The job row exists and `status` is `COMPLETED`.
3. The job has **no PR**. Proposed test: no `JobEvent` of type `PR_CREATED` (or later PR lifecycle event such as `PR_CHECKS_*`, `PR_MERGED`, `PR_CLOSED`) exists for the job, and no run for the job has a pull-request key in its `metadata`. Either signal alone is enough to treat the job as having a PR.
4. `now - completedAt >= retentionMs`. `completedAt` is set by `markJobCompleted`.
5. The work branch `flawferret/job-<uuid>` has no commits that are absent from every remote (same `rev-list --count ... --not --remotes` check `resetJobWorktreeForFreshStart` already uses). If it does, the branch is kept and the failure is recorded (see Failure handling).

Jobs that merged a PR and reached `COMPLETED` through `PR_MERGED` are **not** eligible under this path. They are owned by post-merge cleanup (see Open questions, item 4).

### Trigger and retention window

- Same triggers as FLW-34: once at `ferret-runner` startup, then on `FERRET_RUNNER_WORKTREE_SWEEP_INTERVAL_MS`.
- Retention clock starts at `completedAt`.
- Default window: the existing `FERRET_RUNNER_WORKTREE_RETENTION_HOURS` (default 24). Whether this path should use the same knob is an open question.
- No disk-pressure trigger in v1. Time-based only.

### Safety rules

- **Never remove a worktree for a job whose status is `CLAIMED`, `RUNNING`, `VALIDATING`, `READY_FOR_CODEX`, `CODEX_APPROVED`, `REVIEW`, `PR_APPROVED`, `PR_CREATED`, `RETRY`, `NEEDS_REVIEW`, `DRAFT`, `QUEUED`, or any other non-`COMPLETED`/non-retention status.** The sweep uses an allowlist, not a denylist. Any status not explicitly listed is kept.
- **Never remove a worktree for a job that has an open PR.** Covered by the PR check above; a job with a PR is never `COMPLETED` through this path.
- **Re-read the job immediately before removal.** The sweep decides from a snapshot. Before calling `removeJobWorktree`, re-fetch the job's `status` and PR signals and skip if they changed. This closes the window where a job is moved (for example by `/jobs/:id/requeue`, which accepts only `BLOCKED`, `FAILED`, `RETRY`, so this is defensive) between the snapshot and the removal.
- **Never touch `Repository.localPath`.** Removal is `git worktree remove --force` on the worktree path only, run from `Repository.localPath` as today. The sweep must never be passed the checkout path as a worktree path. Existing `isInsideRoot` containment is the enforcement point; add a test that a candidate equal to `Repository.localPath` is refused.
- **Refuse to start with a worktree root that is inside any registered `Repository.localPath`** (proposed startup check in `config.ts` or the sweep entry point). Without it, a misconfigured `FERRET_RUNNER_WORKTREE_DIR` could make the sweep's `git worktree list` output include the user's checkout. This is a new guard, not something FLW-34 has.
- **Branch deletion is limited to `flawferret/job-<uuid>`** (`isFlawFerretWorkBranch`, already enforced) and to branches with no unpushed commits (item 5 above).
- Sweep errors for one repository are isolated (`onRepositoryError`, already in place) and must not stop the sweep for other repositories or the job-claim loop.

### Failure handling

- `git worktree remove` or `branch -D` failure: record `WORKTREE_REMOVAL_FAILED` on the job with the git error. The job stays `COMPLETED`; no status change. The next sweep retries because the worktree still matches the eligibility rules.
- Unpushed commits on the work branch: do not delete the branch; leave the worktree in place and record `WORKTREE_REMOVAL_FAILED` with `reason: "unpushed-commits"` and the commit count. Do not retry-spam: one event per sweep is acceptable, but the spec does not require deduplication (see Open questions, item 6).
- `git worktree list` failure for a repository: logged via the existing `Worktree sweep failed for repository` log; no events (no job to attach to).
- Job row missing: already handled as `orphan-sweep`. Orphan removals have no `jobId` for `JobEvent`, so they log only (existing FLW-34 behavior, unchanged).
- Dirty worktree (uncommitted Codex output): behavior depends on Open questions, item 1. Until answered, the spec assumes removal with `--force`, matching FLW-34's requeue-reset precedent.

### Observability

- No new `JobEventType`. Reuse `WORKTREE_REMOVED` / `WORKTREE_REMOVAL_FAILED`, already emitted by the FLW-34 `onRemoval` callback for jobs that still exist.
- `WORKTREE_REMOVED` metadata for this path: `reason: "completed-without-pr-expired"` (new string in the `WorktreeRemovalReason` union; it is a TypeScript union, not a DB enum, so no migration), `jobStatus: "COMPLETED"`, `prOpened: false`, `completedAt`, `retentionHours`, `workBranch`, `worktreePath`, `ok`, `error` if any.
- Log line per removal and a per-sweep summary (`Worktree sweep completed`) including counts per decision reason, so an operator can see "N completed-without-PR worktrees kept within retention" versus "removed".
- Keep decisions distinguishable: `keep` reasons should be at least `in-flight`, `completed-within-retention`, and `has-pr`.

## User stories / acceptance criteria

- As a Rob running ferret-runner locally, I can run many no-PR jobs without my `~/.flawferret/worktrees` directory growing without bound, so that disk use is bounded by the retention window.
- Given a job with `status = COMPLETED`, no PR events, and `completedAt` older than `FERRET_RUNNER_WORKTREE_RETENTION_HOURS`, when the next startup or periodic sweep runs, then its `job-<uuid>` worktree is removed, its `flawferret/job-<uuid>` branch is deleted, and a `WORKTREE_REMOVED` event is recorded on the job with `reason: "completed-without-pr-expired"`.
- Given a job with `status = COMPLETED`, no PR, and `completedAt` newer than the retention window, when the sweep runs, then the worktree and branch are kept and nothing is emitted for that job beyond the per-sweep summary log.
- Given a job with `status = COMPLETED` and a `PR_CREATED` (or later PR lifecycle) event, when the sweep runs, then this path does not remove its worktree.
- Given a job in any non-`COMPLETED` status not in the retention list (for example `RUNNING`, `READY_FOR_CODEX`, `REVIEW`, `PR_CREATED`), when the sweep runs, then its worktree is kept regardless of age.
- Given a `COMPLETED` no-PR job whose work branch has commits not on any remote, when its retention expires, then the sweep does not delete the branch, the worktree is left in place, and a `WORKTREE_REMOVAL_FAILED` event is recorded with the unpushed-commit count.
- Given `git worktree remove` fails for an expired `COMPLETED` no-PR worktree, when the sweep runs, then a `WORKTREE_REMOVAL_FAILED` event is recorded with the git error, the job remains `COMPLETED`, and the next sweep retries it.
- Given a repository whose `Repository.localPath` is the candidate path (or a parent of it), when the sweep runs, then nothing is removed from that path and the candidate is refused with an error logged.
- Given `FERRET_RUNNER_WORKTREE_DIR` is set to a path inside a registered repository's `localPath`, when ferret-runner starts, then it refuses to start with a clear configuration error.
- Given a sweep is removing a worktree and the job's status changed between snapshot and removal (for example it is no longer `COMPLETED`), when the re-check runs, then the removal is skipped.
- Given worktrees that were created by FLW-34 before FLW-35 shipped and whose jobs are `COMPLETED` with no PR and expired, when the first sweep after deploy runs, then they are removed under the same rules (no special-case migration).
- Given the sweep runs on a repository with no `localPath`, when it iterates repositories, then that repository is skipped (existing behavior, unchanged).
- Unit tests in `worktree.test.ts` cover: the decision function for each status and PR-signal combination, the retention boundary (exactly at `retentionMs`), the unpushed-commit refusal, the `Repository.localPath` refusal, and the re-check skip.

## Out of scope

- Changing when a job reaches `COMPLETED` or adding a new `JobStatus` (for example a dedicated "completed-no-pr-retained" state).
- Changing post-merge cleanup behavior for `PR_MERGED` jobs (owned by FLW-34's `local-checkout-cleanup.ts`), except as Open questions, item 4, decides.
- Disk-usage or free-space triggers.
- Install caching or shared `node_modules` across worktrees (FLW-34 decision 1).
- A manual "sweep now" API route or UI button.
- Surfacing worktree status or retention countdown in `apps/web`.
- Changing `FERRET_RUNNER_WORKTREE_RETENTION_HOURS` semantics for `BLOCKED` / `FAILED` / `CANCELED` jobs.
- Runner-managed cloning into a cache directory (FLW-34 out-of-scope item).

## Open questions

These are product calls. `coder` should not start until items 1 to 3 are answered. Items 4 to 6 have a proposed default and can be answered during review.

1. **Uncommitted Codex output in a no-PR worktree.** A `COMPLETED` no-PR job never commits or pushes; its generated changes exist only as uncommitted files in its worktree. Deleting the worktree at expiry deletes the only copy. Options:
   a. Remove with `--force` at expiry (proposed default; matches FLW-34's requeue-reset, which intentionally discards uncommitted files).
   b. Keep worktrees that are dirty (`git status --porcelain` non-empty) indefinitely, and emit a `WORKTREE_RETENTION_EXTENDED`-style record or log so they are visible. Needs a manual cleanup path, which is out of scope here.
   c. Save a patch (`git diff` plus untracked files) to job or run metadata before removal, then remove the worktree.
2. **Retention window for this path.** Use the existing `FERRET_RUNNER_WORKTREE_RETENTION_HOURS` (default 24) for `COMPLETED` no-PR jobs too (proposed), or add a separate knob such as `FERRET_RUNNER_NO_PR_WORKTREE_RETENTION_HOURS`? If separate, what default?
3. **Retain at all, or remove immediately?** FLW-34 removes successful PR-merged worktrees immediately, but keeps failed ones for debugging. A no-PR completion is a success, so the consistent answer might be immediate removal, which would make this spec unnecessary. Is there a reason to keep it for inspection (for example, to review Codex output before deciding to open a PR)? The proposal assumes yes, with a retention window.
4. **Merged-PR leftovers.** If post-merge cleanup fails and leaves a `PR_MERGED` job's worktree behind (`LOCAL_CHECKOUT_CLEANUP_FAILED`), should this sweep also remove it? Proposed: yes, after the same window, with `reason: "pr-merged-leftover"`. Alternatively leave that to FLW-34's cleanup retry.
5. **Pre-existing backlog.** Worktrees from before FLW-34 landed do not exist, but runs between FLW-34 landing and FLW-35 landing will leave expired no-PR worktrees behind. Confirm that the first post-deploy sweep should remove them all (proposed), or whether Rob wants a dry-run log first.
6. **Event noise for repeated failures.** A worktree that repeatedly fails removal (for example a locked or unpushed-commit case) would emit a `WORKTREE_REMOVAL_FAILED` on every sweep. Acceptable for v1, or should the sweep record only the first failure per job?
7. **Sequencing with FLW-34.** This spec is written against the FLW-34 branch. Should FLW-35 start only after PR #119 merges to `main` (recommended, avoids stacked branches), or be developed on top of the FLW-34 branch?
