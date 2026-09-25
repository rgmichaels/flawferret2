# Test Explorer — Phase 1

Status: Draft
Date: 2026-09-25

## Problem

The `/features` page (`apps/api/src/cucumber-features.ts`, `apps/web/app/features/page.tsx`,
`apps/web/app/local-test-runs/page.tsx`, `LocalTestRun` model) already browses Cucumber
features/scenarios, filters by a single tag, and runs one feature or one scenario locally at a
time via `POST /repositories/:id/features/local-test-runs`. It's a catalog with a one-at-a-time
run button, not a test runner: there's no way to select several scenarios/features/tags at once,
save that selection for reuse, watch a multi-test run progress live, see a single scenario's own
run history (today's history view mixes feature- and scenario-scope runs together), or tell
whether a test is trending slower. This spec scopes turning `/features` into the first slice of
FlawFerret's "Test Explorer": tag-driven multi-select, saved suites, batched run-now with live
progress, per-scenario history, a basic duration trend signal, and a rerun-failures action.

This is a rework/expansion of the existing `/features` area, not a new page tree — the feature
tree, tag filter, and single-run flow already there should be extended, not replaced.

**Not this phase** (future Test Explorer phases — do not build): flakiness scoring, root-cause
clustering of failures, scheduled runs, branch/environment/browser matrix targeting,
quarantine/optimize/split/delete recommendations, screenshots/traces/videos/log artifact storage,
CI (GitHub Actions) as a run source.

## Proposed change

This phase touches `packages/db` (schema + migration), `packages/job-schemas`, `apps/api`, and
`apps/web`. It's large enough that `coder` will likely want to land it as a few sequential
commits/PRs (schema+API, then web UI), but it's specified here as one coherent scope.

### Data model changes (`packages/db/prisma/schema.prisma`, new migration)

1. **`TestSuite` model (new)** — a saved, named, reusable selection scoped to a repository:
   ```
   model TestSuite {
     id           String   @id @default(uuid()) @db.Uuid
     repositoryId String   @map("repository_id") @db.Uuid
     name         String
     featurePaths String[] @default([]) @map("feature_paths")
     scenarios    Json     @default("[]") // Array<{ featurePath: string; line: number }>
     tags         String[] @default([])
     createdAt    DateTime @default(now()) @map("created_at")
     updatedAt    DateTime @updatedAt @map("updated_at")
     repository   Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)

     @@unique([repositoryId, name])
     @@index([repositoryId, createdAt])
     @@map("test_suites")
   }
   ```
   Add `testSuites TestSuite[]` to `Repository`. No user/auth model exists anywhere in this repo
   today (confirmed: no `User` model, no `userId`/`createdBy` field on any model), so suites are
   repository-scoped only, consistent with the rest of the app — not per-user.

2. **`LocalTestRun.batchId` (new nullable column)** — `batchId String? @map("batch_id") @db.Uuid`,
   with `@@index([batchId])`. A batch groups the individual `LocalTestRun` rows created by one
   "run this selection" action so the UI can poll progress and compute a batch-level status. No
   new `TestRunBatch` table is needed: batch identity is just a shared UUID on existing rows, and
   batch-level status/progress is computed at read time from the child runs' statuses (see API
   below), not stored redundantly.
   - Existing single-scenario/single-feature runs from the current `/features` "Test Local"
     button keep `batchId: null`.

3. **No changes to `JobStatus`, `JobEventType`, or the `Job` model.** `LocalTestRun` is a separate,
   non-event-sourced model (no event log) and this phase doesn't touch the Codex/PR job pipeline.
   `LocalTestRunStatus` and `LocalTestRunScope` enums are unchanged — tag-based selections are
   resolved into concrete `FEATURE`/`SCENARIO` runs at creation time (see below), not stored as a
   new scope.

### API changes (`apps/api/src/server.ts`, `packages/job-schemas`)

1. **Saved suites** — new `TestSuite`-backed routes, all under `/repositories/:id/test-suites`:
   - `GET /repositories/:id/test-suites` — list suites for the repository, newest first.
   - `POST /repositories/:id/test-suites` — body `{ name, featurePaths?, scenarios?, tags? }`
     (at least one of the three selection arrays non-empty; `name` unique per repository —
     409 on collision). Add `createTestSuiteRequestSchema` / `TestSuiteResponse` to
     `packages/job-schemas`.
   - `PATCH /repositories/:id/test-suites/:suiteId` — rename and/or replace the selection.
   - `DELETE /repositories/:id/test-suites/:suiteId` — 204.
   - Selections are stored as-given (feature paths / `{featurePath, line}` pairs / tag strings);
     validity against the current checkout is only checked when the suite is actually run (a
     checkout can change between save and run).

2. **Batched run-now** — new `POST /repositories/:id/test-runs`:
   - Body: `{ featurePaths?: string[]; scenarios?: { featurePath: string; line: number }[]; tags?: string[] }`
     (reuses the same selection shape as `TestSuite`; at least one array non-empty).
   - Resolves the selection against `buildFeatureCatalog`/`buildFeatureDetail` (same helpers
     `cucumber-features.ts` already exports): each tag expands to every scenario carrying that tag
     (feature-level tags apply to all scenarios in that feature) plus any whole feature whose
     feature-level tag matches and has no scenario-level breakdown needed — concretely: a tag
     resolves to the set of `{featurePath, line}` scenario runs whose scenario or feature tags
     include it. Explicit `featurePaths` entries become `FEATURE`-scope runs (whole file, same as
     today's "Test Local" with no scenario line); explicit `scenarios` entries become
     `SCENARIO`-scope runs. De-duplicate the resolved set (a scenario reachable via both a tag and
     an explicit `featurePaths`/`scenarios` entry runs once).
   - Creates one `LocalTestRun` row per resolved item, all `QUEUED`, sharing a new `batchId`
     (uuid). The existing `claimNextLocalTestRun` worker loop in `apps/ferret-runner` already
     claims `QUEUED` rows one at a time in `createdAt` order — no runner changes needed; batches
     just enqueue multiple rows that drain through the existing single-claim loop, so a batch runs
     sequentially, not in parallel, and other queued local runs (including from other repos) can
     interleave between a batch's items. Document this in the UI copy (see below); parallel/
     isolated batch execution is out of scope for this phase.
   - Returns `201` with `TestRunBatchResponse`: `{ id: string /* batchId */; runs: LocalTestRunResponse[] }`.
   - 404 if the repository has no checkout / any explicit feature or scenario doesn't resolve;
     400 if the selection is empty after resolution (e.g. a tag with no matches).

3. **Batch status (for live progress)** — new `GET /repositories/:id/test-runs/:batchId`:
   - Returns `TestRunBatchStatusResponse`: `{ id, runs: LocalTestRunResponse[], summary: { total, queued, running, passed, failed, canceled }, status: "QUEUED" | "RUNNING" | "PASSED" | "FAILED" | "CANCELED" }`.
   - `status` is derived, not stored: `RUNNING` if any run is `RUNNING`; else `QUEUED` if any run
     is still `QUEUED`; else `FAILED` if any run is `FAILED`/`CANCELED`; else `PASSED` if every run
     is `PASSED`. 404 if no `LocalTestRun` has that `batchId`.

4. **Rerun failures** — new `POST /repositories/:id/test-runs/:batchId/rerun-failures`:
   - Looks up the batch's `FAILED` (and `CANCELED`) runs, re-resolves each one's
     `featurePath`/`scenarioLine`/`scope` into a fresh `QUEUED` `LocalTestRun`, all sharing a new
     `batchId`. Returns `201` with `TestRunBatchResponse`, same shape as create. 404 if the batch
     doesn't exist; 400 if it has no failed/canceled runs.

5. **Per-scenario history** — extend the existing `GET /repositories/:id/features/local-test-runs`
   list route to accept an optional `scenarioLine` query param (the stats route already supports
   this; the list route currently only filters by `featurePath`, which mixes feature-scope and
   every scenario-scope run together). When `scenarioLine` is present, filter to
   `scope: SCENARIO, scenarioLine` exactly, matching the existing stats-route filtering behavior.

6. **Duration trend** — extend `LocalTestRunStatsResponse` (`packages/job-schemas`) with
   `durationTrend: "slower" | "faster" | "flat" | null`. Computed in
   `toLocalTestRunStatsResponse` (`apps/api/src/server.ts`) from the same `completedAt`/
   `startedAt`/`status` run list already fetched for stats, using only runs with a resolvable
   duration:
   - `null` if fewer than 6 completed (`PASSED`/`FAILED`) runs with timing have been recorded —
     not enough history to say anything.
   - Otherwise take the 3 most recent completed runs ("recent") and the 3 completed runs
     immediately before those ("baseline"), average each group's `durationMs`.
   - `"slower"` if recent average is more than 20% above baseline average; `"faster"` if more than
     20% below; otherwise `"flat"`.
   - This is intentionally a fixed, simple threshold comparison — not a scoring/statistical model.
     Future phases may replace it with real flakiness/trend analysis.

### Web changes (`apps/web/app`)

1. **Tag discovery, surfaced alongside the tree** — `/features` (`app/features/page.tsx`) already
   computes `allTags` from the catalog and has a single-select tag `<select>`. Phase 1 replaces
   that with a tag rail/chip list next to the feature tree showing every discovered tag with its
   scenario count (feature-level tags count every scenario in the feature), each tag chip
   individually selectable as part of the multi-select described next.

2. **Checkbox-based multi-select** — the feature tree (`renderFeatureTree` et al.) becomes an
   interactive client component: a checkbox next to each scenario, each feature (selects/
   deselects all its scenarios), and each tag chip (selects/deselects every scenario carrying that
   tag). Selecting a folder is out of scope for phase 1 (folders aren't a first-class selection
   unit — no folder-level tag or feature-file grouping concept exists in the schema). Selection
   state lives in the new client component (not the URL/search params) and is cleared on
   navigation to a different feature/repository, consistent with this being a "build a run" tray
   rather than persisted UI state.

3. **Selection tray** — a persistent panel (visible whenever the selection is non-empty) showing
   the current count of selected scenarios/features/tags, with two actions:
   - **Run Now** — `POST`s to the new `/repositories/:id/test-runs` and navigates to a new live
     progress view (below).
   - **Save as Suite** — opens a small name-prompt, then `POST`s to
     `/repositories/:id/test-suites`.
   A "Clear selection" control empties the tray without running anything.

4. **Saved suites panel** — a new section on `/features` (below or beside the tag rail) listing
   `TestSuite`s for the current repository, each with a scenario/feature count, a **Run** button
   (posts the suite's saved selection to `/repositories/:id/test-runs`), a **Load into selection**
   action (populates the checkbox tree/tray from the suite so it can be tweaked before running),
   and a **Delete** button.

5. **Live progress view** — a new route, e.g. `/test-runs/[batchId]`, replacing the current
   pattern of "queue and redirect back to `/features` with a flash message" for multi-item runs.
   It's a client component that polls `GET /repositories/:id/test-runs/:batchId` (e.g. every 2s
   while `status` is `QUEUED`/`RUNNING`, stopping once terminal) and renders each run's current
   status, a progress count ("3 of 8 complete"), and per-run duration/exit-code once finished, each
   linking to its existing `/local-test-runs/:id/output` view. Include the sequential-execution
   note from API item 2 above ("Tests run one at a time; other queued runs may interleave").
   Single-item runs from the existing "Test Local" button are unaffected — that flow keeps its
   current queue-and-flash-message behavior on `/features` (extending it to the new progress view
   is optional/left to `coder`'s judgment, not required for this spec).

6. **Rerun failures** — once a batch reaches a terminal `status` with at least one `FAILED`/
   `CANCELED` run, the live progress view shows a **Rerun failures** button that posts to
   `/repositories/:id/test-runs/:batchId/rerun-failures` and navigates to the new batch's progress
   view.

7. **Per-scenario history + duration trend** — `/local-test-runs` (`app/local-test-runs/page.tsx`)
   gains an optional `scenarioLine` search param; when present, pass it through to both the
   list and stats API calls (item 5/6 above) so the page shows one scenario's own run history
   instead of the whole feature's. The feature detail page
   (`app/features/[repositoryId]/[...featurePath]/page.tsx`) should link each scenario to this
   scoped history view rather than only the feature-level one, and a "View History" link should
   also appear per-scenario in the feature preview panel on `/features` itself. Render
   `durationTrend` as a small badge (e.g. "Trending slower", "Trending faster", nothing shown for
   `flat`/`null`) next to the existing avg-duration stat on both `/features` and
   `/local-test-runs`.

## User stories / acceptance criteria

- As a QA engineer, I can see every Cucumber tag discovered in the registered checkout, with a
  count of how many scenarios carry it, next to the existing feature tree on `/features`.
- As a QA engineer, I can check individual scenarios, whole features, or a tag to build up a
  selection, and see a running count of what's selected.
- Given I've checked a mix of scenarios, features, and tags, when I click "Run Now", then a batch
  of `LocalTestRun`s is created (one per resolved scenario/feature, deduplicated) and I land on a
  live progress view for that batch.
- Given a batch run is in progress, when I'm on its progress view, then the page updates without a
  manual refresh to show each item's status (queued/running/passed/failed) and an overall
  "X of N complete" count, until every item reaches a terminal state.
- As a QA engineer, I can save my current checkbox selection as a named suite scoped to the
  current repository, and it appears in a "Saved Suites" list on `/features`.
- As a QA engineer, I can run a saved suite directly from the list, or load it back into the
  checkbox tree to adjust before running.
- As a QA engineer, I can delete a saved suite I no longer need.
- Given a batch run has finished with at least one failure, when I'm on its progress view, then I
  see a "Rerun failures" button that queues a new batch containing only the failed/canceled items
  and takes me to its progress view.
- As a QA engineer, I can open a single scenario's own run history (not mixed with its sibling
  scenarios' or the whole feature's runs) and see each past run's pass/fail status, duration, and
  timestamp, paginated the same way the existing feature-level history is.
- Given a scenario or feature has at least 6 completed runs with recorded durations, when I view
  its stats (on `/features` or its history page), then I see whether it's trending slower, faster,
  or flat based on comparing its 3 most recent runs to the 3 before those.
- Given fewer than 6 completed timed runs exist, when I view stats, then no trend claim is shown
  (not a misleading one based on too little data).

## Out of scope

- Flakiness scoring/flake-rate calculation, root-cause clustering of failures, quarantine/
  optimize/split/delete recommendations, "never-run" staleness alerts ("hasn't run in 9 days").
- Scheduling runs (cron/recurring) and any run trigger other than an explicit user action.
- Branch, environment, or browser targeting/matrix — runs still execute against whatever the
  registered checkout's working tree currently is, exactly as today's single-run flow does.
- Screenshots, traces, videos, or any artifact beyond the existing stdout/stderr log files.
- CI (GitHub Actions) as a run source or trigger.
- Parallel/isolated execution of a batch's items — batches still drain through the existing
  single-claim worker loop sequentially.
- Folder-level selection in the feature tree.
- Any authentication/authorization or per-user ownership of suites — none exists in the app today.

## Open questions

- Tag resolution for `POST /repositories/:id/test-runs` treats a feature-level tag as "every
  scenario in that feature." If a feature file has no scenarios written with `Scenario:` (e.g. a
  tag only on a `Scenario Outline` with examples tables `cucumber-features.ts` doesn't currently
  expand into per-example rows), the resolved run is still one `SCENARIO`-scope run at that
  outline's line, consistent with how single-scenario runs already work today — confirm this
  matches expectations before `coder` starts, since example-table expansion is a bigger change.
- Suite name uniqueness is scoped per-repository with a 409 on collision — confirm that's the
  desired UX versus silently allowing duplicate names or auto-suffixing.
