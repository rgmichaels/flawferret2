# `CREATE_BUG_REPORT` as JobType #2

Status: **Shelved** (2026-08-13) — user's call on FLW-4: "Shelve this for now. I'm not sure what the intention for this was." Not ready for `coder`, not being actively pursued. See Open Questions below for what would need answering to revive it.
Date: 2026-08-13

## Reconciling the two research bets

See `docs/specs/console-network-capture-and-prompt-wiring.md` for the full reconciliation
reasoning between `docs/research/vision-beyond-add-playwright-test.md` (this bet) and
`docs/research/capture-pipeline-and-job-type-expansion.md`. Summary: the two bets compose —
richer capture is a prerequisite for a good bug-report job, not a competitor to it — but this
spec is the slower, riskier half and should land after (or independent of) that one, and only
once the open questions below are resolved by the user. It is written now so the shape of the
decision is concrete, not to hand to `coder` as-is.

## Problem

`docs/research/vision-beyond-add-playwright-test.md` proposes `CREATE_BUG_REPORT` as `JobType`
#2 to (a) prove the job/queue/worker machinery generalizes past `ADD_PLAYWRIGHT_TEST`, since
every schema decision (`Job.payload: Json`, `JobType` enum, `TrackerIntegration`) was designed
for multiple job types but only one has ever been implemented, and (b) give the extension a
"file this as a bug" path, which the research doc frames as "the extension's
already-promised-but-unbuilt Create Bug action" per `VISION.md`.

Grounding this against the real extension surfaces a real complication the research doc did not
account for: **the extension already has a working, shipping "Create Jira Ticket" button.**
`apps/extension/src/sw/qa_issue_background_service.ts` (`handleJiraCreateIssue` and friends)
files a Jira issue directly from the capture overlay, synchronously, with no FlawFerret2
involvement at all — no `Job`, no `JobEvent`, no review step. `VISION.md`'s "Create Bug" line
item may just describe that existing button, not a new job type. Before scoping a
`CREATE_BUG_REPORT` job type, the user needs to say what problem it solves that the existing
button doesn't (see Open Questions #1) — otherwise this is two competing paths to the same
outcome (file a bug in Jira from the extension).

Separately, the research doc's sizing undersells the reuse it proposes. It says
`CREATE_BUG_REPORT` can "call the Jira ticket-creation logic that already exists." That logic
(`createJiraIssueForJob` in `apps/api/src/server.ts`) does exist and is real — it's used today
by the optional `createJiraTicket` flag on `POST /jobs/:id/approve-review`, which creates a
companion Jira ticket for an `ADD_PLAYWRIGHT_TEST` job. But it is hardcoded to that job type's
payload shape (`{ acceptanceCriteria: string; targetBranch: string }` and repository
owner/name) — it is not a generic "create a bug ticket" function today and would need
generalizing to take a bug-report-shaped payload (summary, repro steps, capture context) instead.

## Proposed change (pending open questions below)

If the user confirms this should proceed as a FlawFerret2-job (not a bypass, see Open
Questions #1):

- **New `JobType` value** `CREATE_BUG_REPORT` in `packages/db/prisma/schema.prisma` (migration)
  and `jobTypeSchema` in `packages/job-schemas/src/index.ts`.
- **New payload schema** (`createBugReportPayloadSchema` or similar) — likely: `repositoryId`
  (to resolve the `TrackerIntegration`, same pattern as today — see Open Questions #3 on whether
  this is required), `summary`, `description`/`reproSteps`, `captureContext` (reusing the
  existing schema, now hopefully populated per the sibling capture spec).
- **`POST /jobs` and `createJobRequestSchema` generalized** to a discriminated union keyed on
  `jobType`, since both the schema and the route handler (`apps/api/src/server.ts`, around line
  2824) currently hardcode `ADD_PLAYWRIGHT_TEST`-shaped payload fields (`targetBranch` appears in
  the `JOB_CREATED` event metadata and the Slack notification text, for example) and would need
  per-jobType branching.
- **Generalize `createJiraIssueForJob`** to accept a bug-report-shaped payload instead of (or in
  addition to) the current `ADD_PLAYWRIGHT_TEST`-shaped one.
- **Lifecycle**: no new `JobStatus` values look necessary — both plausible shapes below reuse
  the existing enum. Which shape to build is Open Questions #2:
  - *Thin*: `NEEDS_REVIEW` -> (human approves, ticket created synchronously in the API, same
    pattern as today's `createJiraTicket` flag) -> `COMPLETED`. Never claimed by
    `ferret-runner`.
  - *Full loop*: `NEEDS_REVIEW` -> `QUEUED` -> `CLAIMED` -> `RUNNING` (claimed and processed by
    `ferret-runner`, which calls the Jira API and reports back) -> `COMPLETED`. Skips
    `CODEX_RUNNING`/`VALIDATING`/`PUSHING`/`PR_CREATED` entirely.
- **Reuse existing `JobEventType`s**: `JIRA_TICKET_CREATED`, `JIRA_TICKET_CREATION_FAILED`,
  `JIRA_TICKET_CREATION_SKIPPED` are already generic (not `ADD_PLAYWRIGHT_TEST`-named) and should
  cover this job type's terminal events without new enum values.
- **Extension**: new "Create Bug" action alongside the existing "Add Playwright Test" button in
  `content_script.ts`, building a `/jobs/new`-style URL (or a dedicated form) carrying
  `captureContext` for a `CREATE_BUG_REPORT` payload instead of an `ADD_PLAYWRIGHT_TEST` one.
- **Web**: `apps/web/app/jobs/new/page.tsx` and the review page
  (`apps/web/app/jobs/[id]/review`) are currently `ADD_PLAYWRIGHT_TEST`-shaped forms
  (`featureArea`/`goal`/`acceptanceCriteria`/`targetBranch`/`runAffectedTests`/`createDraftPr`);
  a `CREATE_BUG_REPORT` job needs its own form fields and its own review-page rendering.

## User stories / acceptance criteria

(To be finalized once Open Questions are resolved — sketch pending confirmation of shape)

- As a tester using the extension, I can trigger "Create Bug" on a captured element and have it
  produce a FlawFerret2 job (not an instant Jira call), so a human reviews/approves it before
  the ticket is filed.
- Given a `CREATE_BUG_REPORT` job in `NEEDS_REVIEW`, when a reviewer approves it, then a Jira
  ticket is created via the repository's `TrackerIntegration`, the job's payload records the
  resulting `jiraIssue.key`/`url`, and the job reaches `COMPLETED`.
- Given a `CREATE_BUG_REPORT` job whose repository has no `TrackerIntegration` configured, when
  a reviewer attempts to approve it, then the job is blocked/rejected with a clear message
  (mirroring today's `!job.repository?.trackerIntegration` handling in `approve-review`).

## Out of scope

- Any change to the existing extension "Create Jira Ticket" button or `ADD_PLAYWRIGHT_TEST`'s
  optional `createJiraTicket` companion-ticket flag — both keep working as-is regardless of
  what this spec decides.
- `VISION.md`'s other named future job types (`INVESTIGATE_FAILURE`, `FIX_FAILED_TEST`,
  `REVIEW_PR_FOR_TEST_GAPS`, etc.) — not addressed here; per
  `docs/research/capture-pipeline-and-job-type-expansion.md`, most of these don't need a new
  `JobType` at all since `ADD_PLAYWRIGHT_TEST`'s free-text `goal`/`acceptanceCriteria` already
  accept arbitrary requests.
- Flaky-test quarantine as a job type (a separate, plausibly-legitimate new-`JobType` candidate
  per the qa-strategist doc) — not addressed here.

## Open questions

These block handing this to `coder`; nothing above should be implemented until they're answered.

1. **What does this add over the extension's existing "Create Jira Ticket" button?** That button
   already files a bug to Jira in one click, synchronously, today. Routing bug-filing through a
   FlawFerret2 job instead means: it shows up in the jobs list/timeline alongside test-writing
   work, it goes through a human-approval gate before the ticket is filed (the existing button
   files immediately), and it's auditable via `JobEvent`. Is that the value the user wants (a
   reviewed, queued bug-filing path), or would this just be a second, more roundabout way to do
   something the extension already does well? If the answer is "the extension button is fine,
   don't build this," this spec should be shelved entirely.
2. **Thin vs. full-loop lifecycle.** The "thin" shape (never claimed by `ferret-runner`) is far
   cheaper to build but does not exercise the queue/claim/worker path at all — which undercuts
   this bet's own stated purpose (proving the *worker* machinery generalizes, per the research
   doc's Risk section). The "full loop" shape actually tests that but is more work for a job
   that structurally does nothing `ferret-runner`-specific (no checkout, no Codex, no
   validation, no PR). Which is worth building, given the goal is specifically to de-risk the
   worker/queue layer?
3. **Does a bug report require a registered `Repository`?** Today `TrackerIntegration` is only
   reachable via `Repository.trackerIntegrationId`, and `POST /jobs` requires
   `payload.repositoryId` to resolve to a registered repository. A bug a tester spots may be on
   an app with no FlawFerret2-registered code repository at all (e.g., no Playwright framework
   set up yet). Should `CREATE_BUG_REPORT` still require picking an existing `Repository` (reuse
   today's constraint, simplest but blocks bug-filing on repo-less apps), or should
   `TrackerIntegration` become independently selectable without a `Repository` (bigger change,
   affects the data model)?
4. **Volume/priority.** Is this worth prioritizing now, or should it wait behind the capture
   pipeline spec and any real usage signal on how often testers reach for "file a bug" vs. "add
   a test" from the extension?
