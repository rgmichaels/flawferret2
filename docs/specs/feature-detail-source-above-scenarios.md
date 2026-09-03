# Feature Detail: Show Feature Source above Scenarios

Status: Draft
Date: 2026-09-03

## Problem
On the Feature detail page, the "Feature Source" panel (the raw `.feature` file
contents) currently renders below the "Scenarios" panel. The user wants Feature
Source shown first, so the raw file is visible before the parsed scenario
breakdown.

## Proposed change
Pure presentation reorder in `apps/web/app/features/[repositoryId]/[...featurePath]/page.tsx`.

Inside `<div className="feature-detail-main">`, swap the render order of the two
`<section>` elements so that:

1. `<section className="panel feature-source-panel">` (contains `<h2>Feature Source</h2>`
   and `<pre>{detail.content}</pre>`) renders first.
2. `<section className="panel feature-detail-panel">` (contains `<h2>Scenarios</h2>`)
   renders second.

No markup, className, prop, data-fetching, or styling changes — only the order of
the two existing `<section>` blocks.

No migration, no API change, no new route, no new job type or event.

## User stories / acceptance criteria
- As a user viewing a feature, I see the "Feature Source" panel above the
  "Scenarios" panel within the main column of the page.
- Given the Feature detail page renders successfully, when it loads, then
  "Feature Source" appears before "Scenarios" in the DOM and on screen.
- The right-hand "Associated Files" column is unchanged in content and position.
- The "Local Test Runs" panel above the grid is unchanged.
- The page still renders the "Feature not found" fallback unchanged when
  `detail` is null.
- `pnpm --filter @flawferret2/web lint` (tsc) passes.

## Out of scope
- Any change to the "Associated Files" column.
- Any change to the "Local Test Runs" panel.
- Any styling, spacing, heading-text, or component changes.
- Collapsing/expanding behavior or any new interactivity on either panel.

## Open questions
None.
