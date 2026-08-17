# Framework Builder wizard consolidation

Status: Draft
Date: 2026-08-17

Design source: `docs/specs/design-framework-builder-facelift.md` (structural
sections adopted from Turn 2a — see "What Turn 2a gets right (adopt as-is)"
and the "Page shell" component spec). This ticket implements the flow/state
change only; no visual restyle (typography, color, chip/section styling) is
in scope here — see the companion spec
`docs/specs/framework-builder-visual-restyle.md`.

## Problem

`apps/web/app/framework/new/page.tsx` is a five-step GET-param wizard
(`framework` → `local-git` → `github` → `register` → `validate`), each step
a full page reload (`FrameworkWizardStep`, `wizardSteps`, `getWizardStep`,
`buildFrameworkHref` — `page.tsx:120-270`), with a separate right-hand
`framework-builder-summary` aside restating state the user just entered.
Five steps for what is functionally three decisions (where, what to name
it, what to include) plus three yes/no toggles (git init, GitHub push,
register in FF2) forces a full round trip per toggle, and the step nav
(`framework-wizard-steps`) plus the summary aside both exist only to answer
"what have I chosen so far," which isn't needed once every choice is
visible on one page.

## Proposed change

App: `apps/web` only. Primary file: `apps/web/app/framework/new/page.tsx`
(2179 lines today). No API or `packages/job-schemas` changes — the
underlying server actions (`createFramework`, `installFrameworkDependencies`,
`openGeneratedFrameworkFolder`, `registerGeneratedFramework`,
`validateFramework`) and their request/response shapes are unaffected. No
Prisma migration.

Collapse the five `FrameworkWizardStep` values into one page, one form, five
visible sections in submit order, no step nav, no summary aside:

1. **Where** — `FrameworkFolderPicker` (component reused as-is) + a
   destination toggle between local folder and GitHub repository.
2. **Naming** — Project name / Package name / Base URL (current
   `framework-basics-grid` fields, unchanged).
3. **Include** — the five `featureOptions` as togglable controls (visual
   chip styling is out of scope here; keep them functionally equivalent
   checkboxes for this ticket, restyled in the follow-up).
4. **After building** — the three current step toggles
   (`initializeGitRepository`, `createGithubRepository` + owner/repo/branch
   fields, `registerLocalRepository`) as one checklist block instead of
   separate wizard pages. GitHub owner/repo/branch fields are only visible
   when `createGithubRepository` is checked — use the existing
   progressive-disclosure pattern already in the app (`<details>`, as used
   for `framework-command-copy`), not a new one.
5. **Files** — preview list showing file count + conflict count, with the
   full per-file list available on request (e.g. behind `<details>`)
   instead of always-expanded `framework-file-card` cards for every file.

Replace the current split between the "Review & Validate" step and the
separate `framework-create-form` "Create" step with a single persistent
build/submit control at the bottom of the page showing target, file count,
and post-build actions, with one "Build framework" submit button. (Exact
visual treatment — sticky positioning, dark background, serif CTA text — is
the visual-restyle ticket's job; this ticket needs the control present and
functional, styled consistently with the rest of the page's current
look-and-feel until the restyle lands.)

Concretely, this touches:
- The `FrameworkWizardStep` type and `wizardSteps` array — removed or
  collapsed to a single implicit step.
- `getWizardStep`, `buildFrameworkHref` — the query-param step-routing logic
  goes away; state now lives in one form/page render rather than being
  passed step-to-step via URL params.
- The four `hidden*Inputs` blocks that currently pass state between wizard
  steps — audit at implementation time; most should collapse since there's
  only one step to pass state *to*, but the underlying server-action
  payload fields (`createGithubRepository`, `githubOwner`, etc.) stay as
  they are today, just collected in one submit instead of accumulated
  across steps.
- `framework-wizard-steps` step nav markup — removed.
- `framework-builder-summary` aside — removed (the form itself now shows
  all selected state).

Post-build results (install/validate/register status, PR link, action
center via `framework-results-checklist`, `framework-pipeline-list`) stay
where they are conceptually — this ticket is about the *build request* form
only, not the results view.

## User stories / acceptance criteria

- As an operator creating a new framework, I can see and set all build
  options (destination, naming, included features, post-build actions,
  file preview) on one scrollable page, without a page reload between
  steps.
- Given I have filled in destination and naming, when I toggle
  "Push to GitHub," then the GitHub owner/repo/branch fields become visible
  inline, without navigating away from the current view.
- Given I have made my selections, when I click the single build/submit
  control, then the framework is created exactly as it is today (same
  `createFramework` server action, same payload shape) — behavior parity
  with the current multi-step flow's end state, not new build capability.
- Given a destination folder already contains conflicting files, when I
  expand the file preview, then conflicts are still visible before I
  submit (current conflict-detection behavior is preserved, not dropped
  during consolidation).
- As a user who submits the form with a validation error (e.g. missing
  project name), I see the same error feedback the current flow gives me,
  now surfaced on the single page rather than on whichever wizard step
  happened to be showing.
- Given the build completes, when results render, then the post-build
  results view (`framework-results-checklist`, pipeline status, PR link)
  is unaffected by this change — same component, same location on the
  page.

## Out of scope

- Any visual/typography/color restyling — covered by
  `docs/specs/framework-builder-visual-restyle.md`, which depends on this
  ticket landing first.
- The results/validation view after a build completes
  (`framework-results-checklist`, action center, PR/registration cards) —
  layout unchanged.
- `apps/web/app/framework/builds/*` (saved-build detail view) — not
  touched.
- Any other page in `apps/web`.
- Any change to `createFramework`/`installFrameworkDependencies`/
  `openGeneratedFrameworkFolder`/`registerGeneratedFramework`/
  `validateFramework` server actions or their payload/response shapes.
- Migrating the three ad hoc `.ready`/`.muted`/`.future` classes in
  `framework-pipeline-list` to `--signal-*` tones — that's flagged in the
  design spec as bundled with the *visual* restyle ticket, not this one,
  since it's a styling change, not a flow change.

## Open questions

None blocking — the design spec's open question 1 ("should consolidation
and restyle ship together or in sequence") has been resolved by Rob's
decision to split this into two tickets, with consolidation shipping
first. This spec is ready for `coder`.
