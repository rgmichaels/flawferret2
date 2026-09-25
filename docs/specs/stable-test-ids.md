# Stable Test IDs for Cucumber Scenarios

Status: Draft
Date: 2026-09-25

## Problem

Every place FlawFerret persists something about a specific scenario keys it by
`{featurePath, scenarioLine}`: `LocalTestRun.featurePath` / `LocalTestRun.scenarioLine`
(`packages/db/prisma/schema.prisma`), the history/stats routes in `apps/api/src/server.ts`
(`GET /repositories/:id/features/local-test-runs`, `GET
/repositories/:id/features/local-test-runs/stats`), and the `TestSuite.scenarios` selection
(`Array<{ featurePath, line }>`, proposed in `docs/specs/test-explorer-phase-1.md`). Line
numbers shift every time a `.feature` file above a scenario gets an added/removed line, and a
rename or file move changes `featurePath` outright. Either one silently orphans that scenario's
run history, breaks any saved suite referencing it, and would undermine every future
duration-trend, flake-detection, or staleness feature built on top of this history — all of
which assume "this scenario" is a stable identity, not a coordinate that drifts with unrelated
edits above it in the file.

## Proposed change

Introduce a stable, scenario-scoped ID carried as a Cucumber tag directly in the feature file,
parsed by FlawFerret, and used going forward as the primary key for test identity — with
`{featurePath, line}` remaining a fallback/display concern, not an identity concern.

### ID format and uniqueness

- Format: `@id:ff-` followed by 6 lowercase base36 characters (`[a-z0-9]`), e.g. `@id:ff-k3p9qz`.
  6 characters of base36 is ~2.2 billion combinations — comfortably collision-resistant for any
  single repository's scenario count, while staying short enough to sit on the same line as
  other tags without dominating the diff.
- Generated with a CSPRNG (`crypto.randomInt`/`randomBytes`), not derived from content or
  position, so a copy-pasted scenario doesn't silently inherit its sibling's identity by
  construction (see "Duplicate IDs" below).
- Uniqueness is enforced **per repository** (matching every other identity concept in this repo
  — `TestSuite.name` is unique per `repositoryId`, not globally), by checking the full set of IDs
  already present across that repository's `.feature` files at assignment time and rejecting/
  regenerating on collision. IDs are not required to be globally unique across repositories,
  since `LocalTestRun`/`TestSuite` rows are always scoped by `repositoryId` already.
- The tag lives on its own line directly above `Scenario:` / `Scenario Outline:`, alongside any
  other tags (order doesn't matter, consistent with how `cucumber-features.ts` already collects
  all `@`-prefixed tokens on tag lines preceding a scenario into one `pendingTags` set). Example:
  ```gherkin
  @smoke @id:ff-k3p9qz
  Scenario: Configured base URL loads successfully
  ```
- `@id:` is a reserved tag prefix. A scenario tagged with more than one `@id:...` tag is invalid
  (see acceptance criteria) — FlawFerret always treats the first one found as authoritative when
  parsing but surfaces this as a warning.

### Parsing (`apps/api/src/cucumber-features.ts`)

- `parseFeatureFile` extracts an `@id:xxxxxx` tag from a scenario's `pendingTags` the same way it
  already collects other tags, and sets it on a new `testId: string | null` field on
  `CucumberScenario` (`packages/job-schemas`: add `testId: z.string().regex(/^ff-[a-z0-9]{6}$/).nullable()`
  to `cucumberScenarioSchema`).
- The `@id:...` tag is **excluded** from `CucumberScenario.tags` and from the feature-level
  `CucumberFeatureSummary.tags` set (and therefore from the `/features` tag rail's counts in the
  Test Explorer Phase 1 spec) — it's an identity, not a user-facing label, and showing "47 tags
  including `@id:k3p9qz`, `@id:m2x8j1`, ..." in the tag rail would be noise. `tags` continues to
  hold every other `@`-prefixed token as it does today.
- Scenario Outlines get exactly one `@id:...` tag on the outline itself (not one per generated
  Examples row) — matching how `LocalTestRun`/history already treat an outline as a single line-
  addressed scenario today (see the Phase 1 spec's open question on the same point). Per-example
  identity is out of scope here and there.
- A scenario with no `@id:...` tag parses with `testId: null` — this is not a parse error, since
  older/un-migrated checkouts and manually-added scenarios will legitimately lack one until
  assigned (see below).

### Assigning/rewriting IDs in a user's checkout

Scenario source lives in the user's registered checkout, not this repo, so FlawFerret cannot
silently add tags to a working tree — CLAUDE.md/VISION.md's human-approval principle requires
changes to a user's repository go through a reviewable branch/PR, exactly like `ADD_PLAYWRIGHT_TEST`
already does. The runner also requires a clean checkout, so an in-place background rewrite is not
an option regardless.

Proposed flow, a new **"Assign test IDs"** action on `/features`:

1. A new endpoint, `POST /repositories/:id/test-ids/assign`, scans the repository's feature
   catalog (reusing `buildFeatureCatalog`) for every scenario/outline with `testId: null` or a
   malformed/duplicate `@id:...` tag, generates a fresh unique ID for each, and produces a diff —
   one new tag line inserted above each affected `Scenario:`/`Scenario Outline:` line, nothing
   else touched. Returns a preview response (`AssignTestIdsPreviewResponse`: affected
   `{featurePath, line, name, assignedId}[]`, plus a unified diff or per-file before/after) without
   writing anything yet, so the UI can show "N scenarios across M files will get an ID" before
   committing to it.
2. A confirm step, `POST /repositories/:id/test-ids/assign/apply` (or a `confirm: true` flag on
   the same call), requires a clean checkout (reuse the existing dirty-checkout guard from the
   `ADD_PLAYWRIGHT_TEST` checkout step) and then follows the same shape as today's job pipeline:
   create a branch (e.g. `flawferret/assign-test-ids-<short-id>`), write the tag insertions,
   commit, push, and open a **draft PR** for human review via the existing GitHub PR helpers in
   `apps/ferret-runner/src/pull-request.ts` (`createDraftPullRequest` and friends) — reused rather
   than reimplemented. Nothing merges without the human clicking merge on GitHub, same as today.
3. Whether this runs as a genuinely new `JobType` (e.g. `ASSIGN_TEST_IDS`) through the full
   event-sourced `Job`/`ferret-runner` claim loop, or as a narrower synchronous/lighter-weight
   action that directly reuses the checkout+branch+PR helpers without the full `JobStatus`
   state machine (`CODEX_RUNNING`/`VALIDATING` don't apply here — there's no Codex step and no
   Playwright validation, just a mechanical tag insertion), is an **open question** — see below.
   Either way this must **not** silently write to a repo outside of the branch/PR flow.
4. Once the PR merges (out of band, on GitHub — FlawFerret doesn't auto-merge), the next time the
   repository's feature catalog is fetched (`GET /repositories/:id/features`), scenarios show
   their new `testId`. There is no separate "sync" step needed since the catalog is read live from
   the checkout.

### New scenarios added later without an ID

- The feature catalog and detail responses report an `unassignedScenarioCount` (or equivalent)
  so `/features` can show a persistent, non-blocking banner ("3 scenarios don't have a test ID —
  Assign test IDs") whenever `testId: null` scenarios exist, reusing the same "Assign test IDs"
  action from above (it already skips scenarios that already have a valid ID, so it's safe to
  re-run any time).
- No auto-assignment on run: a scenario without an ID can still be selected and run via
  `POST /repositories/:id/features/local-test-runs` (existing route) or the Phase 1 batch route —
  its `LocalTestRun.testId` (see Data below) is simply `null` for those runs, same as today's
  `{featurePath, line}` behavior. FlawFerret never writes to the checkout as a side effect of
  running a test.

### Duplicate IDs (copy-paste)

- If a scenario is copy-pasted (including its `@id:...` tag), the catalog parse will see the same
  `testId` on two scenarios in the repository. `buildFeatureCatalog` detects this (a `Map<testId,
  location[]>` pass over all parsed features) and the catalog/detail response marks both
  scenarios' `testId` as duplicated (`CucumberScenario.testIdDuplicate: boolean`, default
  `false`) rather than silently treating one as canonical. `/features` shows a warning badge on
  duplicated scenarios and the "Assign test IDs" action (item 1 above) also detects and re-assigns
  a fresh ID to every duplicate beyond the first occurrence (in file-then-line order) as part of
  its preview/apply flow, so running it clears duplicates as a side effect.
- History rows already recorded against a since-duplicated ID stay associated with whichever
  scenario the ID was originally assigned to; there's no way to retroactively disambiguate which
  physical scenario a past run belonged to once the tag was copied, so this is accepted as a known
  limitation, not solved here.

### Deleted scenarios

- If a scenario with a `testId` is deleted from a feature file, its `LocalTestRun` history rows
  and any `TestSuite` selection referencing that `testId` simply stop resolving to anything live.
  History rows are kept (never deleted) so past runs remain visible via direct history queries
  (`GET .../local-test-runs?scenarioLine=...` style, now addressable by `testId` too — see Data
  below); the `/features` catalog view naturally stops showing that scenario since it's reading
  the live checkout. A `TestSuite` that references a now-missing `testId` is not auto-pruned — it
  simply resolves to a smaller set (or errors, consistent with Phase 1's "validity is checked at
  run time" design) the next time the suite is run.

### Data model (`packages/db/prisma/schema.prisma`, new migration)

1. **`LocalTestRun.testId String? @map("test_id")`** — nullable, alongside the existing
   `featurePath`/`scenarioLine` (kept, not replaced: `featurePath`/`scenarioLine` remain the
   record of what actually ran, useful for display and for repos/scenarios that don't have an ID
   yet). Add `@@index([repositoryId, testId, createdAt])` for per-scenario history lookups by ID.
2. Every route/helper that creates a `LocalTestRun` (`POST
   /repositories/:id/features/local-test-runs` today, and the Phase 1 batch route if that spec
   proceeds) resolves the scenario's `testId` from the current catalog at creation time (same
   moment `featurePath`/`scenarioLine` are already resolved) and stores it alongside — `null` if
   the scenario has none.
3. History/stats routes gain an optional `testId` query parameter as an alternative to
   `featurePath`+`scenarioLine` for the same "one scenario's own history" filtering Phase 1
   already proposes adding via `scenarioLine`. When both a `testId`-bearing history and legacy
   `featurePath+scenarioLine` rows exist for what is now the same scenario (see backfill below),
   querying by `testId` returns the merged, correct history; querying by the old
   `featurePath+scenarioLine` pair only returns what matches literally, which will under-count
   once lines have shifted — this is expected and is exactly the problem this spec fixes going
   forward.
4. If `docs/specs/test-explorer-phase-1.md` proceeds, its `TestSuite.scenarios` column should
   store `Array<{ testId: string } | { featurePath: string; line: number }>` (a tagged union
   allowing both, since not every scenario will have an ID immediately after this spec ships) —
   noted here so the two specs don't define incompatible shapes; the authoritative shape update
   belongs in whichever spec's migration lands second in `coder`'s implementation order.

### Backfill: mapping existing history rows to new IDs

When the "Assign test IDs" apply step (above) successfully creates a PR and that PR's branch is
what actually carries the new tags, FlawFerret cannot know the IDs are "live" until the PR merges
(the checkout only reflects merged tags once the user pulls `main`/re-syncs). So backfill happens
lazily, not synchronously with PR creation:

- Each time the feature catalog is built for a repository (`buildFeatureCatalog`, called from the
  existing `GET /repositories/:id/features` route) and finds scenarios with a `testId` that no
  `LocalTestRun` row has ever recorded against that `testId` for this repository, run a one-time
  match: for each such scenario, find `LocalTestRun` rows in this repository with `testId: null`
  and matching `featurePath` + `scenarioLine` equal to the scenario's **current** line, and
  backfill `testId` onto them. This only catches rows whose line hadn't shifted between the ID
  being assigned and this matching pass running — which is the common case (ID assignment PRs
  only add a tag line above the `Scenario:` line, keeping the scenario's own line stable unless a
  human further edits the file before merging).
- Rows that can't be matched this way (line shifted between assignment and merge, or the run
  predates any ID work entirely) are **not** retroactively guessed — `testId` stays `null` on
  them permanently. They remain visible in `featurePath`-scoped history (today's behavior,
  unaffected) but won't appear in `testId`-scoped history for the now-current scenario. This is
  stated as an accepted, permanent gap: a burst of pre-existing history becomes effectively
  "before the ID era" for scenarios whose line moved, rather than a best-effort guess that could
  attach wrong history to the wrong scenario.
- This backfill pass is idempotent and cheap enough to run inline on catalog fetch (bounded by
  scenario count in one repository); it does not need a background job/cron.

### Framework Builder (`apps/api/src/framework-template.ts`)

- `sampleFeatureFiles()` (the `features/smoke/configured-base-url.feature` sample shipped by
  `POST /frameworks/create` and previewed by `/frameworks/preview` and `/frameworks/browser-template`)
  gets a generated `@id:ff-xxxxxx` tag added to its one sample scenario, so newly scaffolded
  frameworks start with an ID already present rather than immediately needing an "Assign test
  IDs" pass. Since each scaffold is a fresh, ungenerated file (not yet written into any git
  history), the ID can simply be generated once at build time in the template function — no
  uniqueness check against a live repository is needed here since there's no existing repository
  yet to collide with.

## User stories / acceptance criteria

- As a QA engineer, when I view a feature's scenarios (catalog, detail, or feature-tree views),
  each scenario shows its stable test ID (or a "no ID" indicator) rather than only its line
  number.
- Given a repository has scenarios without IDs, when I visit `/features`, then I see a banner
  telling me how many scenarios are missing IDs, with an "Assign test IDs" action.
- Given I click "Assign test IDs", when the preview loads, then I see exactly which scenarios
  will get a new tag and in which files, before anything is written.
- Given I confirm the assignment, when it completes, then FlawFerret opens a draft PR on the
  scenario's repository containing only added `@id:...` tag lines — no other file content
  changes — and nothing is written directly to the checkout's working tree outside that PR.
- Given the checkout is not clean (uncommitted changes), when I try to assign test IDs, then the
  action is rejected with the same clean-checkout error message pattern already used elsewhere in
  the pipeline, and no PR is created.
- Given a scenario is copy-pasted along with its `@id:...` tag, when the feature catalog is next
  read, then both scenarios are flagged as having a duplicate ID, and running "Assign test IDs"
  resolves the duplicate by assigning a fresh ID to the later occurrence.
- Given a scenario has a `testId`, when I request its run history, then I can query by `testId`
  and get every run recorded against that ID, independent of the scenario's current line number.
- Given a scenario's `.feature` file is edited so its line number shifts, when I next view its
  history by `testId`, then previously recorded runs for that scenario are still present (as long
  as they were recorded with a resolvable `testId` at run time).
- Given a repository's feature catalog is fetched and some existing `LocalTestRun` rows still have
  `testId: null` but match a newly-ID'd scenario's current `featurePath`+`scenarioLine`, then
  those rows are backfilled with that `testId` automatically, with no user action required.
- As a developer scaffolding a new framework via Framework Builder, the sample feature file it
  produces already has a valid `@id:...` tag on its one scenario.
- The `@id:...` tag never appears in the `/features` tag rail or in any scenario's/feature's
  user-facing `tags` list/count.

## Out of scope

- Per-Examples-row identity for Scenario Outlines (one ID per outline, not per generated example)
  — consistent with how `LocalTestRun`/history already treat outlines today.
- Auto-merging the "Assign test IDs" PR, or any change to the human-approval gate that already
  governs `ADD_PLAYWRIGHT_TEST` PRs.
- Retroactively guessing/reassigning history for rows that can't be matched by the lazy backfill
  pass (accepted permanent gap, documented above).
- Disambiguating which physical scenario a pre-duplication history row "really" belonged to.
- Any change to `TestSuite`'s final shape beyond noting the tagged-union recommendation for
  `docs/specs/test-explorer-phase-1.md` to reconcile with, since that spec's schema hasn't landed
  yet.
- Enforcing ID presence as a hard requirement to run a scenario — un-ID'd scenarios keep working,
  just without stable history.
- Cross-repository ID uniqueness.

## Open questions

1. **Job pipeline shape for "Assign test IDs".** Should this be a genuine new `JobType`
   (`ASSIGN_TEST_IDS`) flowing through the full event-sourced `Job`/`JobEvent`/`ferret-runner`
   claim loop (heavier: per the shelved `docs/specs/create-bug-report-job-type.md`, adding a
   `JobType` means generalizing `POST /jobs`/`createJobRequestSchema` to a discriminated union,
   since both currently hardcode `ADD_PLAYWRIGHT_TEST`-shaped fields), or a narrower, synchronous-
   ish action under `/repositories/:id/test-ids/...` that directly reuses the checkout/branch/PR
   helpers from `apps/ferret-runner/src/pull-request.ts` without the full `JobStatus` state
   machine (since there's no Codex step or Playwright validation to model as
   `CODEX_RUNNING`/`VALIDATING`)? This spec assumes the lighter path but the final call affects
   which package owns the code (`apps/api` directly vs. `apps/ferret-runner` via a claimed job)
   and should be confirmed before `coder` starts.
2. **ID length/format bikeshed.** 6-character base36 with an `ff-` prefix is proposed; confirm
   this is acceptable versus a shorter/longer value or a different alphabet (e.g. excluding
   visually-ambiguous characters like `0`/`o`, `1`/`l`).
3. **Reserved-tag conflicts.** If a repository already uses a tag literally matching `@id:...`
   for some unrelated purpose today, assigning test IDs would collide with existing semantics.
   Worth a quick scan-and-warn step before the first "Assign test IDs" run on a given repository,
   or acceptable to just document the reserved prefix and move on?
4. **Multiple `@id:` tags on one scenario.** Proposed: first tag found wins for identity, parsing
   surfaces a warning, and "Assign test IDs" does not auto-fix this case (unlike plain duplicates
   across scenarios) since it likely indicates manual tampering rather than copy-paste. Confirm
   this is the desired handling versus treating it as a hard parse error that blocks the catalog
   view for that scenario.

## Jira ticket

**Summary:** Add stable test IDs to Cucumber scenarios (prerequisite for Test Explorer history)

**Issue type:** Story

**Labels:** `product-manager`

**Description:**

> Per-scenario history (`LocalTestRun`), saved suites, and every future flake/staleness feature
> in Test Explorer are keyed by `featurePath + scenarioLine`, which drifts whenever a feature
> file is edited above a scenario or the scenario is moved/renamed — silently orphaning history.
> This introduces a stable `@id:ff-xxxxxx` tag convention on every `Scenario`/`Scenario Outline`,
> parsed by `apps/api/src/cucumber-features.ts` and exposed on the feature catalog/detail
> responses, a nullable `LocalTestRun.testId` column with a lazy backfill pass matching existing
> history to newly-assigned IDs, an "Assign test IDs" action that writes new tags into a user's
> checkout via a reviewable branch/PR (never a silent write, per the project's human-approval
> principle), and an ID already present on Framework Builder's scaffolded sample scenario.
>
> Full spec: `docs/specs/stable-test-ids.md` (this file). Blocks/precedes
> `docs/specs/test-explorer-phase-1.md`'s per-scenario history and saved-suite work.

**Acceptance criteria:**

- [ ] Scenarios and Scenario Outlines can carry a `@id:ff-xxxxxx` tag; `cucumber-features.ts`
      parses it into `CucumberScenario.testId` and excludes it from the user-facing `tags` list
      and tag-rail counts.
- [ ] A new "Assign test IDs" action previews, then (on confirmation, requiring a clean checkout)
      opens a draft PR adding only missing/duplicate `@id:...` tags — no direct writes to the
      checkout's working tree.
- [ ] `LocalTestRun` gains a nullable `testId` column, populated at run-creation time from the
      current catalog, with history/stats routes queryable by `testId` as an alternative to
      `featurePath` + `scenarioLine`.
- [ ] A lazy, idempotent backfill pass on catalog fetch matches pre-existing `testId: null`
      history rows to newly-ID'd scenarios by current `featurePath` + `scenarioLine`, leaving
      unmatched rows permanently `null` rather than guessing.
- [ ] Duplicate `@id:...` tags across scenarios are detected and flagged in catalog/detail
      responses, and resolved by "Assign test IDs" assigning a fresh ID to later occurrences.
- [ ] Framework Builder's scaffolded sample feature (`framework-template.ts`) ships with an
      `@id:...` tag already on its sample scenario.

**Suggested sub-task split:** yes — this is sizeable enough that a single `coder` pass covering
all of it risks being too large/hard to review. Proposed sub-tasks, in dependency order:

1. **Parser + schema** — `cucumber-features.ts` tag extraction, `testId`/`testIdDuplicate` on
   `CucumberScenario` (`packages/job-schemas`), tag-rail exclusion. No data model or write path
   yet; catalog/detail responses just start reporting `testId: null` for everything until
   sub-task 3 exists.
2. **Framework Builder sample update** — trivial, can land alongside sub-task 1 or independently;
   listed separately since it touches a different file with no shared risk.
3. **Data model + history/stats by `testId`** — `LocalTestRun.testId` migration, run-creation
   resolution, `testId` query param on history/stats routes, the lazy backfill pass.
4. **"Assign test IDs" action** — the preview/apply endpoints, checkout-clean guard, branch/PR
   creation (reusing `apps/ferret-runner/src/pull-request.ts`), and the `/features` banner/action
   UI. Depends on sub-task 1 (needs parsing to compute the preview) and should land after
   Open Question #1 (job-pipeline shape) is answered, since that decision determines which
   package this code lives in.
