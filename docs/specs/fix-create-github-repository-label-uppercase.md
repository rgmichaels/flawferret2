# Fix "Create GitHub repository" checkbox label rendering in all caps

Status: Draft
Date: 2026-09-11

## Problem

On the Create Framework page (`apps/web/app/framework/new`), the "Create
GitHub repository" checkbox label under the "After building" section renders
in all caps ("CREATE GITHUB REPOSITORY"), which looks unintentional and is
visually inconsistent with every other checkbox label in that section (e.g.
"Install dependencies & run smoke test" in `FrameworkAutoRunToggle`, which
renders in normal sentence case).

### Root cause

`FrameworkGithubPushToggle` (`apps/web/app/framework/new/framework-github-push-toggle.tsx`,
line 55) wraps its `<details>` in `className="framework-command-copy
framework-github-push-toggle"`, reusing the `framework-command-copy` class
purely to get `<details>` structural spacing (`margin-top: 6px`, defined at
`apps/web/app/styles.css` line ~1549). There is currently no CSS rule for
`.framework-github-push-toggle` at all — it's an unstyled marker class.

`framework-command-copy` was designed for a different, unrelated UI element:
a small "Copy command" caption-link disclosure used twice elsewhere on the
same page (`apps/web/app/framework/new/page.tsx` lines 371 and 436, each
`<details className="framework-command-copy"><summary>Copy
command</summary>...`). Its `summary` rule
(`apps/web/app/styles.css` lines 1553-1559) styles that caption as small,
bold (`font-weight: 900`), blue (`#2563eb`), 12px, and `text-transform:
uppercase` — correct for a tiny "COPY COMMAND" link, wrong for a full
sentence-case checkbox label.

Because `text-transform` is an inherited CSS property, the `uppercase` set
on `.framework-command-copy summary` cascades down through
`<summary><label className="framework-overwrite-option"><span><strong>Create
GitHub repository</strong>` (line 67), even though `<strong>`'s own rules
(`.framework-overwrite-option strong` at `styles.css` lines 2228-2231, and
the serif override at lines 745-747) never set `text-transform`
themselves — they simply inherit whatever the ancestor `summary` sets. The
component borrowed `framework-command-copy` for its `<details>` spacing but
inadvertently inherited unrelated caption styling (color, weight,
uppercase) that leaks onto a more prominent, unrelated checkbox label.

Confirmed by comparison: `FrameworkAutoRunToggle`
(`apps/web/app/framework/new/framework-auto-run-toggle.tsx`) renders the
exact same `.framework-overwrite-option` checkbox-label markup, but as a
plain `<label>` with no `.framework-command-copy`-classed `<details>`
ancestor — and its label renders correctly in normal sentence case. This is
the working reference for what "Create GitHub repository" should look like.

## Proposed change

Pure CSS/markup fix in `apps/web/app`. No behavior change, no new route, no
job/event type, no migration.

Chosen approach: **give `FrameworkGithubPushToggle`'s `<details>` a
dedicated class instead of reusing `framework-command-copy`.**

Rationale for picking this over tightening `.framework-command-copy
summary`'s selector:
- `framework-command-copy` is a caption/link style intentionally scoped to
  its two genuine "Copy command" usages in `page.tsx` (lines 371, 436).
  Narrowing its selector (e.g. to exclude `.framework-overwrite-option`)
  would work today, but couples an unrelated component's internal markup
  (`.framework-overwrite-option`) to a caption class's exclusion list —
  fragile if either component's markup changes later, and it keeps the
  `<details>` for a full checkbox+description control classed as a "command
  copy" element, which is misleading to future readers.
- `FrameworkAutoRunToggle` already establishes the pattern for this
  page's "After building" toggles: a plain, dedicated structural wrapper
  around `.framework-overwrite-option`, with no caption-class involved.
  `FrameworkGithubPushToggle` differs only in that it needs a `<details>`
  (to progressively disclose the owner/repository/branch fields), not a
  plain `<label>`. Giving it its own class keeps that difference contained
  to this one component and matches the existing convention.
- The only thing `FrameworkGithubPushToggle` actually needs from
  `framework-command-copy` is the `margin-top: 6px` on the `<details>`
  element itself — none of the `summary` color/weight/uppercase styling
  applies to it. Moving over just that one declaration is a minimal, safe
  change.

Concrete change:
1. In `apps/web/app/framework/new/framework-github-push-toggle.tsx` line 55,
   drop `framework-command-copy` from the `className`, leaving just
   `className="framework-github-push-toggle"`.
2. In `apps/web/app/styles.css`, add a new rule
   `.framework-github-push-toggle { margin-top: 6px; }` (matching the
   spacing currently inherited from `.framework-command-copy`), placed near
   the other `framework-overwrite-option`/toggle-related rules (e.g. near
   line 2209) rather than near the unrelated `framework-command-copy` block
   (line 1549). Do not add a `summary` rule for this class — the
   `<summary><label className="framework-overwrite-option">...` markup
   already gets its full styling (color `#172033`, 14px, serif font
   override, no uppercase) from the existing `.framework-overwrite-option
   strong` rules (styles.css lines 745-747, 2228-2231), same as
   `FrameworkAutoRunToggle`. No change needed there.
3. Leave `.framework-command-copy` and `.framework-command-copy summary`
   (styles.css lines 1549-1559) completely untouched — the two genuine
   "Copy command" disclosures in `page.tsx` (lines 371, 436) keep their
   current small/bold/blue/uppercase caption styling exactly as-is.

No other part of the Create Framework page is touched.

## User stories / acceptance criteria

- As a user creating a framework, when I view the "After building" section
  on the Create Framework page, I see the "Create GitHub repository" label
  rendered in normal sentence case ("Create GitHub repository"), matching
  the visual style of the "Install dependencies & run smoke test" label
  directly above it in the same section.
- Given the fix is applied, when I inspect the rendered "Create GitHub
  repository" `<strong>` in devtools, its computed `text-transform` is
  `none`, its `color` is `#172033`, and its `font-size` is `14px` (i.e. it
  picks up `.framework-overwrite-option strong` / the serif override, with
  nothing else layered on top).
- Given the fix is applied, when I expand either of the two "Copy command"
  disclosures elsewhere on the page (`page.tsx` lines 371 and 436), their
  `<summary>` text is visually unchanged: small, bold, blue, uppercase,
  exactly as before.
- Given the fix is applied, the "Create GitHub repository" disclosure's
  spacing above it in the "After building" section is visually unchanged
  from before the fix (the `margin-top: 6px` is preserved via the new
  dedicated class).
- Given the fix is applied, expanding/collapsing the "Create GitHub
  repository" disclosure (clicking the checkbox row to reveal the
  Owner/Repository/Initial Branch fields) still works exactly as before —
  this is a pure styling fix, no `<details>`/`<summary>` behavior changes.

## Out of scope

- No changes to any other styling on the Create Framework page (framework
  chips, files list, action result cards, auto-run toggle, folder picker,
  etc.).
- No changes to the `FrameworkGithubPushToggle` component's logic, props,
  form field names/values, or the `useFrameworkDestination` behavior.
- No changes to `.framework-command-copy`'s two genuine "Copy command"
  usages in `page.tsx`.
- No new automated tests. This is a visual-only fix; a manual visual check
  (render the page, confirm the label reads in sentence case, confirm the
  two "Copy command" disclosures are unchanged) is sufficient. A repo-wide
  search (`grep -rn "framework-command-copy\|framework-github-push-toggle"`)
  found no test files or snapshots referencing either class name, so no
  test updates are expected to be needed — `coder` should re-run that grep
  before finishing to confirm this hasn't changed.

## Open questions

None. The root cause, fix approach, and acceptance criteria are unambiguous
enough for `coder` to implement directly.
