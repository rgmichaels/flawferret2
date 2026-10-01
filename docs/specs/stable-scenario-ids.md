# Stable Scenario IDs (Cucumber tags)

Status: Draft
Date: 2026-10-01

## Problem
Scenarios have no stable identity. They are parsed on every request from `.feature` files in `Repository.localPath` (`apps/api/src/cucumber-features.ts`) and the only DB link is `LocalTestRun.featurePath` + `scenarioLine`. Identity is therefore path + line number, which breaks when lines shift, scenarios are renamed, or files move. The redesigned Scenario Explorer (`docs/design-references/scenario-explorer-mockups.html`) needs per-scenario run history, pass rate, "never run" and per-scenario run buttons, which cannot be built reliably on line numbers.

## Proposed change
Split into two phases. Phase 1 ships alone and writes nothing to user repos.

### Phase 1: read IDs, persist identity, no file writes
- **Tag format**: `@ff-<6-8 lowercase hex>` (e.g. `@ff-8f3a2c`), random, not sequential, so concurrent branches do not collide. Matched by a pattern (see Open question 1); default `^@ff-[0-9a-f]{6,8}$`.
- **Parser** (`apps/api/src/cucumber-features.ts`): read the ID tag from a scenario's own tags into a new nullable `CucumberScenario.id` in `cucumberScenarioSchema` (`packages/job-schemas/src/index.ts`). Add `idSource: "tag" | "fingerprint"` and a `fingerprint` string (see below) so the UI can distinguish. Duplicate IDs within a repo are reported, not merged: feature summary/catalog response gains `duplicateScenarioIds: { id, locations: {path, line}[] }[]`, and each affected scenario gets `idConflict: true`.
- **Fingerprint fallback** for untagged scenarios: `sha1(path + "\0" + normalizedName)`, with a step-text hash used only to disambiguate when two scenarios in the same file share a name. Fingerprints are best-effort and change on rename; the UI must label them as "unstable".
- **DB** (migration): new `Scenario` table, unique on `(repositoryId, scenarioId)`, storing `lastSeenPath`, `lastSeenLine`, `lastSeenName`, `contentHash`, `idSource`, `firstSeenAt`, `lastSeenAt`, `missingSince` (nullable). Upserted when the catalog/detail is built (or on a local test run create), never deleted automatically; scenarios no longer found get `missingSince` set so history survives a rename/move/delete. Add nullable `LocalTestRun.scenarioId` (+ index `repositoryId, scenarioId, createdAt`). Keep `scenarioLine`.
- **API** (`apps/api/src/server.ts`): `POST /repositories/:id/features/local-test-runs` accepts optional `scenarioId` (tag ID or fingerprint) as an alternative to `scenarioLine`; the server resolves it against the current parse, returns 400 if not found or if the ID is duplicated (ambiguous). Stats/list endpoints accept `scenarioId` and add per-scenario stats (last status, run count, pass rate, lastRunAt; "never run" = zero rows).
- **Runner** (`apps/ferret-runner/src/local-test-run.ts`): when the run has a tag-sourced `scenarioId`, invoke `npx cucumber-js <featurePath> --tags @ff-xxxx` instead of `featurePath:line`. Fingerprint-sourced and legacy runs keep `path:line`. Guard: if the ID is duplicated the API already refused the run, so the runner never executes two scenarios by accident.
- **Backfill of existing `LocalTestRun` rows** (in the migration or a one-off script): `scenarioId` stays NULL for FEATURE-scope rows. For SCENARIO-scope rows, there is no historical file content, so resolve best-effort against the current checkout by `(featurePath, scenarioLine)`; if a scenario sits at that line now, set its current ID/fingerprint, otherwise leave NULL. Rows left NULL remain visible at feature level only. Backfill must be idempotent and must not fail the migration if a `localPath` is missing.
- **Web**: only what is needed to expose the data (scenario ID chip, "unstable ID" indicator, duplicate warning). The Scenario Explorer redesign itself is a separate spec (`docs/specs/design-*` / `graphic-designer`).

### Phase 2: "Assign IDs" via human-approved PR (separate spec, gated)
Untagged scenarios show an "Assign ID" action. It edits user feature files, so it must not write directly to the checkout; it goes through branch + PR with a human approving, consistent with `CLAUDE.md` (humans are the approval gate; Codex/PR steps are behind per-job approvals and `FERRET_RUNNER_ENABLE_CODEX` / `FERRET_RUNNER_ENABLE_PR_CREATION`, both off by default).

Tension to resolve: `JobType` has only `ADD_PLAYWRIGHT_TEST`, and the job lifecycle (`JobStatus`, `JobEventType`) is built around Codex invocation. Tag insertion is deterministic and needs no Codex. Options: (a) new `JobType` (e.g. `ASSIGN_SCENARIO_IDS`) that reuses checkout/branch/PR steps and skips Codex and Playwright-generation (needs schema enum migration, and likely no new `JobEventType`s if existing branch/PR events are reused; any new event must be named in that spec); (b) reuse `ADD_PLAYWRIGHT_TEST` with a deterministic path, which misrepresents the job. Recommendation: (a), but decide in the Phase 2 spec. Phase 2 is out of scope for this document beyond that constraint.

## User stories / acceptance criteria
- As a user, I see a stable ID for each scenario that carries an `@ff-` tag, so I can refer to it across renames and line shifts.
- Given a scenario tagged `@ff-8f3a2c`, when the catalog is built, then `scenario.id === "ff-8f3a2c"` (or the agreed canonical form) and `idSource === "tag"`.
- Given an untagged scenario, then `id` is null, `idSource === "fingerprint"`, and `fingerprint` is deterministic for identical path + name.
- Given two scenarios (same or different files) with the same ID tag, then both are returned with `idConflict: true`, the catalog lists the ID in `duplicateScenarioIds` with both locations, and no merge occurs.
- Given a duplicated ID, when `POST .../local-test-runs` is called with that `scenarioId`, then the response is 400 with an ambiguity message and no run is created.
- Given a scenario with a tag ID moves lines or files, or is renamed, when the catalog is rebuilt, then the `Scenario` row keeps the same `scenarioId` and updates `lastSeenPath/Line/Name`, and earlier `LocalTestRun` rows with that `scenarioId` still count toward its history.
- Given a scenario disappears from the checkout, then its `Scenario` row and runs remain, with `missingSince` set; reappearing clears it.
- Given a run created with a tag-sourced `scenarioId`, then the runner command contains `--tags @ff-xxxx` and not `:<line>`.
- Given a run created with only `scenarioLine` (existing behavior), then the command is unchanged (`path:line`) and existing tests in `apps/api/src/local-test-routes.test.ts` still pass.
- Given a scenario with zero `LocalTestRun` rows, then per-scenario stats report "never run".
- Given the migration runs on a DB with existing `LocalTestRun` rows, then it succeeds, FEATURE-scope rows have NULL `scenarioId`, and SCENARIO-scope rows are backfilled best-effort and idempotently.
- Tests: unit tests for `parseFeatureFile` covering every edge case below; API route tests for `scenarioId` create/lookup/ambiguity; runner test for command construction. `pnpm test`, `pnpm typecheck` pass. OpenAPI docs test (`api-docs.test.ts`) updated for new params.

## Edge cases (Phase 1 behavior)
- **Duplicates** (copy-paste of a tagged scenario): flagged, never merged; runs by that ID refused. Duplicates are detected repo-wide, not per file.
- **Scenario Outline**: the ID tags the outline; example rows are `<id>#<rowIndex>` (1-based, order in file). Running an outline by ID runs all rows. Per-example tags (tags above `Examples:`) are ignored for identity.
- **Existing parser bug to fix as part of this work**: tags placed above an `Examples:` block currently stay in `pendingTags` and leak onto the next scenario (the `Examples:` line is not consumed), which could assign an ID to the wrong scenario. Likewise, multiple consecutive tag lines overwrite rather than accumulate (`pendingTags = ...`), so an `@ff-` tag on a line above another tag line would be lost. Both must be fixed with tests.
- **ID tag on Feature vs Scenario**: only scenario-level tags (own line(s) directly above the scenario/outline) count as the ID. An `@ff-` tag on the `Feature:` line is ignored for scenario identity and reported as a warning (it would be inherited by every scenario and break `--tags` targeting). Note `featureTags` currently collects every tag in the file, not just feature-level ones; do not rely on it for this.
- **Rule blocks**: `Rule:` is currently skipped without effect; scenarios under a `Rule` are parsed as normal and identity is unaffected by the Rule. Tags above a `Rule:` line are not scenario IDs (consume and discard so they do not leak).
- **Background**: has no ID; unchanged.
- **Tags on Examples**: see Outline; also must not leak (bug above).
- **Renamed/moved untagged scenarios**: fingerprint changes, so history is not carried over; the UI shows the unstable indicator. This is the accepted limitation until IDs are assigned.
- **Malformed tag** (e.g. `@ff-XYZ`, wrong length): not treated as an ID; scenario falls back to fingerprint.
- **Multiple ID tags on one scenario**: treat as conflict, use none, warn.
- **Two identical-name untagged scenarios in one file**: disambiguated by step hash, then by order index as last resort.

## Out of scope
- Phase 2 file writes (Assign IDs PR flow, new job type, new events). Phase 1 never modifies user files.
- Per-example (row-level) tag IDs.
- Storing scenarios' full content in the DB; parsing stays on-demand.
- Scenario Explorer UI redesign (three-pane inspector, flat table, tag health board) and per-scenario run buttons beyond exposing the API.
- Non-Cucumber test frameworks; Playwright `.spec.ts` test identity.
- Sequential or human-readable IDs; cross-repo ID uniqueness.
- Auto-deleting stale `Scenario` rows.

## Open questions
1. **Fixed `@ff-` prefix vs per-repo configurable pattern.** Repos with an existing convention (e.g. `@TC-\d+`) should not receive a second ID. Recommendation: build the parser against a configurable regex from day one (stored on `Repository`, e.g. `scenarioIdPattern`, nullable), defaulting to `@ff-[0-9a-f]{6,8}`. Phase 1 can read any matching existing tag as the ID; only Phase 2 generation needs a template, and it should generate `@ff-` only when no pattern is configured. Caveat: externally managed IDs (`@TC-123`) are human-assigned and can collide or be non-unique by design; duplicate detection covers that.
2. **Backfill via PR vs opt-in direct write to local checkout.** Recommendation: PR (Phase 2), per the human-approval principle. Direct write would modify a developer's working tree with uncommitted edits, risk conflicts with their branch, and bypass review. If direct write is ever wanted, it should be an explicit per-repo opt-in and out of this spec.
3. **Canonical ID form in the API**: with or without the leading `@` (`ff-8f3a2c` vs `@ff-8f3a2c`)? Recommendation: without `@` in `id`, with it in `tags`; and `--tags` built by the runner.
4. **Phase 2 job type**: new `JobType` vs reuse (see Phase 2). Recommendation: new type, decided in its own spec.
5. **Where the `Scenario` table is upserted**: on catalog read (cheap, but a GET with a write side effect) vs on run creation only. Recommendation: on catalog/detail read, so "never run" and rename tracking work without a run, accepting the write on GET; confirm.
6. **Run-by-tag collisions across features**: `--tags @ff-x` plus `featurePath` narrows to one file, but if cucumber config sets default paths this may need verification against the framework template (`apps/api/src/framework-template.ts`).
