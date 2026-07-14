# FlawFerret2 ferret-runner

Milestone 2 service for proving queue processing.

`ferret-runner`:

1. Registers or heartbeats itself in the `workers` table.
2. Atomically claims the oldest highest-priority `QUEUED` job.
3. Marks the job `CLAIMED`, then `RUNNING`.
4. Logs the claimed job.
5. Sleeps to simulate work.
6. Polls again.

It does not invoke Codex, run Playwright, create branches, commit changes, push to GitHub, or create pull requests.

## Run

```bash
pnpm --filter @flawferret2/ferret-runner dev
```

Optional environment variables:

- `WORKER_ID`
- `WORKER_POLL_INTERVAL_MS`
- `WORKER_SIMULATED_WORK_MS`
- `WORKER_VERSION`
