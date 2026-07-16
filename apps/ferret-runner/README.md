# FlawFerret2 ferret-runner

Worker service for processing FlawFerret2 jobs through the local checkout, Codex,
validation, and draft pull request pipeline.

`ferret-runner`:

1. Maintains one current-state row per worker in the `workers` table, with sparse heartbeat updates.
2. Atomically claims the oldest highest-priority `QUEUED` job.
3. Validates the repository's configured local checkout path.
4. Marks invalid checkout jobs `BLOCKED`.
5. Marks valid jobs `CLAIMED`, then `RUNNING`.
6. Checks out the target branch base and creates a generated `flawferret/job-<short-id>` branch.
7. Marks the job `READY_FOR_CODEX` and waits for manual approval.
8. Optionally invokes Codex after approval.
9. Validates generated changes.
10. Marks the job `REVIEW` and waits for draft PR approval when requested.
11. Optionally commits, pushes, and creates a draft GitHub pull request after approval.

The runner does not clone repositories. A repository must have an explicit local checkout path, and that checkout must exist, be a Git work tree, have a matching `origin`, have a clean working tree, and contain the target branch locally or on `origin`.

Generated work branches are local-only at this milestone. If a generated branch already exists, the runner blocks the job instead of overwriting it.

Codex execution requires a separate manual approval step. By default, `FERRET_RUNNER_ENABLE_CODEX=false`, so approved jobs only record the invocation plan and return to `READY_FOR_CODEX`.

Draft PR creation also requires a separate manual approval step. By default,
`FERRET_RUNNER_ENABLE_PR_CREATION=false`, so review approvals do not push a branch or create a
GitHub pull request.

Validation always runs after Codex completes. If `FERRET_RUNNER_VALIDATION_COMMAND` is set, it is
used as a global override. Otherwise the runner uses the registered repository's validation command.
If neither command is configured, validation only checks that Codex left changed files in the local
checkout. Start with a small command when you want real validation, for example
`pnpm test -- --grep login`.

## Run

```bash
pnpm --filter @flawferret2/ferret-runner dev
```

Optional environment variables:

- `CODEX_COMMAND`
- `CODEX_MODEL`
- `CODEX_TIMEOUT_MS`
- `FERRET_RUNNER_ENABLE_CODEX`
- `FERRET_RUNNER_ENABLE_PR_CREATION`
- `FERRET_RUNNER_LOG_DIR`
- `FERRET_RUNNER_VALIDATION_COMMAND`
- `SLACK_WEBHOOK_URL`
- `WORKER_HEARTBEAT_INTERVAL_MS`
- `WORKER_ID`
- `WORKER_POLL_INTERVAL_MS`
- `WORKER_SIMULATED_WORK_MS`
- `WORKER_VERSION`

## Safe First Live Run

Use this sequence when moving from dry-run mode to the first real Codex-backed job.

1. Keep the queue paused in the web UI.
2. Confirm the registered repository points to the intended local checkout.
3. Confirm the checkout is clean:

```bash
git status --short
```

4. Start the API and web app.
5. Start `ferret-runner` with dry-run defaults:

```bash
FERRET_RUNNER_ENABLE_CODEX=false \
FERRET_RUNNER_ENABLE_PR_CREATION=false \
pnpm --filter @flawferret2/ferret-runner dev
```

6. Queue one simple job.
7. Resume the queue only long enough for the runner to prepare the workspace, then pause again.
8. Open the job detail page and confirm it is `READY_FOR_CODEX`.
9. Stop the runner.
10. Enable only Codex execution:

```bash
FERRET_RUNNER_ENABLE_CODEX=true \
FERRET_RUNNER_ENABLE_PR_CREATION=false \
pnpm --filter @flawferret2/ferret-runner dev
```

11. Approve Codex for the one job.
12. Let validation complete and inspect the job detail page.
13. Inspect the local generated branch and changed files.
14. Stop the runner before enabling PR creation.
15. Enable draft PR creation only when the generated branch is safe to push:

```bash
FERRET_RUNNER_ENABLE_CODEX=true \
FERRET_RUNNER_ENABLE_PR_CREATION=true \
pnpm --filter @flawferret2/ferret-runner dev
```

16. Approve draft PR creation from the job detail page.

Keep `FERRET_RUNNER_ENABLE_PR_CREATION=false` until you are comfortable with the local generated
changes. Keep the queue paused between each manual approval when you want one-job-at-a-time
throttling.
