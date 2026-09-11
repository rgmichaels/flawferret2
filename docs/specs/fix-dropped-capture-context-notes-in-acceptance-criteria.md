# Fix dropped capture-context notes in Acceptance Criteria default

Status: Draft
Date: 2026-09-11

## Problem

When a user types a Gherkin scenario into the extension overlay textarea and
clicks "Add Playwright Test," the extension correctly captures that text into
`captureContext.notes` and passes it through the `captureContext` query param
to `apps/web`'s `/jobs/new` page. But `getDefaultAcceptanceCriteria()` in
`apps/web/app/jobs/new/page.tsx` never reads `captureContext.notes` — it only
builds the Acceptance Criteria default from `thenLine`, `url`, `selectors[0]`,
and `outerHTML`/`domSnippet`. The user's full typed scenario silently
disappears; the field fills in with a generic auto-generated line instead of
what they actually wrote.

## Proposed change

This is a UI/data-flow bug fix, not a new feature. The fix is scoped to one
function in one file plus its test coverage:

- `apps/web/app/jobs/new/page.tsx`: update `getDefaultAcceptanceCriteria()` to
  read `captureContext.notes` and include it in the returned string.
- No schema change needed — `captureContext.notes` already exists and is
  validated (`packages/job-schemas/src/index.ts` line 296:
  `notes: z.string().trim().optional()`).
- No new route, no new job type, no migration, no `JobEventType` change —
  this only affects what text pre-fills a form field on `/jobs/new` before
  the user submits.
- No changes needed in `apps/extension` — the capture side already works
  correctly per the root-cause investigation.

### Merge/precedence decision

When `captureContext.notes` is present, it should be prepended as its own
block **above** the existing auto-generated lines (`thenLine`, "Navigate to
...", "Prefer locator ...", "Use the captured DOM snippet..."), not replace
them and not be appended after them.

Rationale:
- `notes` is the user's own words — the thing they explicitly typed with
  intent, describing the scenario in Gherkin. It should be what they see
  first when they land on the Create Test page, so it reads as "here's what
  you wrote" rather than being buried under boilerplate.
- The auto-generated lines aren't redundant with `notes` — they encode
  structured detail (exact locator string, exact URL) that a free-typed
  Gherkon scenario likely doesn't repeat verbatim, and that `coder`/Codex
  benefit from having explicit later in the pipeline. Dropping them would
  regress the existing behavior for users who never typed notes-worthy text
  but still want locator/URL hints.
  So: keep both, `notes` first.
- If `notes` is present, separate it from the auto-generated block with a
  blank line so it reads as a distinct block, not a run-on list item.
  Exact suggested shape (illustrative, not literal template code):

  ```
  <captureContext.notes>

  <thenLine>
  Navigate to <url>.
  Prefer locator <selectors[0]>.
  Use the captured DOM snippet to keep the assertion focused.
  ```

- If `captureContext.notes` is absent/empty (e.g. user clicked a capture
  action without typing anything, or an older extension version), behavior
  is unchanged from today — only the auto-generated lines appear, no blank
  leading line.

## User stories / acceptance criteria

- As a user, when I type a Gherkin scenario into the extension overlay
  textarea and click "Add Playwright Test," I land on `/jobs/new` and see my
  typed text at the top of the Acceptance Criteria field, not silently
  dropped.
- Given a `captureContext` with a non-empty `notes` field and other
  auto-generated fields present (`thenLine`, `url`, `selectors`,
  `outerHTML`/`domSnippet`), when `getDefaultAcceptanceCriteria()` is called,
  then its return value starts with the `notes` text, followed by a blank
  line, followed by the existing auto-generated lines in their current
  order.
- Given a `captureContext` with `notes` present but all other
  notes-unrelated fields absent (no `thenLine`, `url`, `selectors`, or
  `outerHTML`/`domSnippet`), when `getDefaultAcceptanceCriteria()` is called,
  then its return value is just the `notes` text (no trailing blank line or
  stray whitespace).
- Given a `captureContext` with `notes` absent or empty string, when
  `getDefaultAcceptanceCriteria()` is called, then behavior matches today's
  output exactly (auto-generated lines only, no leading blank line).
- Given `captureContext` is `null`, when `getDefaultAcceptanceCriteria()` is
  called, then it still returns `""` (unchanged from current behavior).
- `apps/web/app/jobs/new/page.test.ts` must be updated: the existing test
  "builds useful defaults from capture context" continues to pass, and at
  least one new test case is added asserting the `notes`-present ordering
  described above, and one asserting the `notes`-absent case is unchanged.
- No other caller of `getDefaultAcceptanceCriteria` exists today per
  repo-wide search (only `page.tsx` itself and `page.test.ts`) — confirm this
  is still true at implementation time; if a new caller has since appeared,
  it must be checked against this behavior change too.
- `pnpm --filter @flawferret2/web typecheck` and
  `pnpm --filter @flawferret2/web test` (or repo-root `pnpm typecheck` /
  `pnpm test`) pass after the change.

## Out of scope

- Any change to `apps/extension`'s capture/serialization logic — it already
  works correctly.
- Any change to `packages/job-schemas`'s `captureContextSchema` — `notes` is
  already defined and validated.
- Any change to `getDefaultFeatureArea()` or `getDefaultGoal()` — this spec
  only touches `getDefaultAcceptanceCriteria()`.
- Any change to how the Acceptance Criteria field is rendered, styled, or
  editable on the page — it's a plain pre-filled textarea today and stays
  that way.
- Any new job type, API route, or job lifecycle change.
- Retroactively fixing jobs already created before this change ships — this
  only affects the form pre-fill going forward.

## Open questions

None blocking. The only judgment call (notes placement/precedence) is
resolved above with rationale; `coder` can implement directly against the
acceptance criteria.
