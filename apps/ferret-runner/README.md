# FlawFerret2 ferret-runner

Milestone service for proving queue processing and explicit repository checkout validation.

`ferret-runner`:

1. Maintains one current-state row per worker in the `workers` table, with sparse heartbeat updates.
2. Atomically claims the oldest highest-priority `QUEUED` job.
3. Validates the repository's configured local checkout path.
4. Marks invalid checkout jobs `BLOCKED`.
5. Marks valid jobs `CLAIMED`, then `RUNNING`.
6. Checks out the target branch base and creates a generated `flawferret/job-<short-id>` branch.
7. Marks the job `READY_FOR_CODEX` and waits for manual approval.
8. Polls again.

The runner does not clone repositories. A repository must have an explicit local checkout path, and that checkout must exist, be a Git work tree, have a matching `origin`, have a clean working tree, and contain the target branch locally or on `origin`.

Generated work branches are local-only at this milestone. If a generated branch already exists, the runner blocks the job instead of overwriting it.

Codex execution requires a separate manual approval step. By default, `FERRET_RUNNER_ENABLE_CODEX=false`, so approved jobs only record the invocation plan and return to `READY_FOR_CODEX`.

It does not run Playwright, commit changes, push to GitHub, or create pull requests.

## Run

```bash
pnpm --filter @flawferret2/ferret-runner dev
```

Optional environment variables:

- `CODEX_COMMAND`
- `CODEX_MODEL`
- `CODEX_TIMEOUT_MS`
- `FERRET_RUNNER_ENABLE_CODEX`
- `WORKER_HEARTBEAT_INTERVAL_MS`
- `WORKER_ID`
- `WORKER_POLL_INTERVAL_MS`
- `WORKER_SIMULATED_WORK_MS`
- `WORKER_VERSION`
