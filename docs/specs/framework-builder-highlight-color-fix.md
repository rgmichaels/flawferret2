# Framework Builder highlight color fix

Status: Draft
Date: 2026-08-24

Jira: FLW-16

## Problem

FLW-16 reports "Color seems to be off on the highlighted areas" on the
Framework Builder page (`apps/web/app/framework/new/`), with a screenshot
showing the blue is "slightly off from the mockups." The mockups referenced
are the design specs that finalized this page's accent color:
`docs/specs/design-framework-builder-facelift.md` and
`docs/specs/framework-builder-visual-restyle.md`, both of which mark the
Color section **DECIDED**: the page's one accent color is `--action:
#2f4d8f` (deep indigo), explicitly chosen over brighter blues/cyans to avoid
colliding in hue with `--signal-active` (`#1c7c86`, the six-tone status
system's "in progress" teal).

## Current implementation

The consolidated single-page Framework Builder form (landed in FLW-12,
`apps/web/app/framework/new/page.tsx`) has not yet had the visual restyle
from those two specs applied — it still uses the pre-restyle wizard-section
markup and `styles.css` rules. Auditing `apps/web/app/styles.css` for the
page's interactive/highlighted states found one spot where the color
doesn't come from `--action` at all, but from a leftover Tailwind palette
literal:

```css
/* apps/web/app/styles.css, lines 789-792 */
.framework-folder-input-row button:hover {
  border-color: #2563eb;
  color: #2563eb;
}
```

`#2563eb` is Tailwind's `blue-600` — a brighter, more saturated blue than
`--action: #2f4d8f`. `.framework-folder-input-row` wraps the "Choose
folder" button in `apps/web/app/framework/new/framework-folder-picker.tsx`
(rendered via `FrameworkFolderPicker` in `page.tsx`, the "Where" section's
local-folder picker) — this is the one hover-highlight state on this page,
and it's the root cause of the reported mismatch: on hover, the button's
border and text render Tailwind's brighter blue instead of the page's
indigo action color.

By contrast, this page's other interactive elements are already correct:
the primary submit CTA and `.secondary-button:hover` both correctly
reference `var(--action)` (`styles.css` lines ~362-391).

This `#2563eb`/`#1d4ed8`/`#93c5fd`/`#dbeafe`/`#bfdbfe` Tailwind-blue family
also appears dozens of other places across `styles.css` (sidebar nav
active state, settings cards, badges, etc.) — that's the broader
hardcoded-hex drift already flagged as a separate follow-up audit in
`docs/specs/design-framework-builder-facelift.md` ("753 raw hex literals").
This ticket does not attempt that audit; it fixes only the one instance
that's actually visible on the Framework Builder page and matches the
reported screenshot.

## Proposed change

App: `apps/web` only. File: `apps/web/app/styles.css`.

Change the hover state of `.framework-folder-input-row button` (lines
789-792) from the hardcoded `#2563eb` to `var(--action)`:

```css
.framework-folder-input-row button:hover {
  border-color: var(--action);
  color: var(--action);
}
```

No other selectors on the Framework Builder page (`apps/web/app/framework/
new/page.tsx` and its co-located components: `framework-folder-picker.tsx`,
`framework-github-push-toggle.tsx`, `framework-destination-context.tsx`)
reference this Tailwind-blue family — confirmed by grepping `styles.css`
for `#2563eb|#1d4ed8|#93c5fd|#dbeafe|#bfdbfe` and cross-referencing which
selectors are reachable from that page's markup.

No markup change, no new class, no token addition, no `:root` edit — this
is a single hardcoded-value-to-existing-token substitution.

## User stories / acceptance criteria

- As a user hovering the "Choose folder" button on the Framework Builder
  page, I see the button's border and text change to the page's indigo
  action color (`--action`, `#2f4d8f`), not Tailwind blue (`#2563eb`).
- Given the Framework Builder page, when I visually diff any highlighted/
  hover state against the design spec mockups, then no `#2563eb`-family
  blue remains distinguishable from `--action`.
- No other page's styling changes — the fix is scoped to the single
  `.framework-folder-input-row button:hover` rule.
- `pnpm --filter @flawferret2/web typecheck` and `pnpm --filter
  @flawferret2/web build` still pass (CSS-only change, but confirms no
  build regression).

## Out of scope

- The full visual restyle (typography, section layout, chips, sticky build
  bar) described in `docs/specs/framework-builder-visual-restyle.md` and
  `docs/specs/design-framework-builder-facelift.md` — that is tracked
  separately and has not landed yet; this ticket is a color-token bug fix,
  not that restyle.
- The broader hardcoded-hex audit of `styles.css` (the Tailwind-blue family
  and other raw hex literals appearing elsewhere in the app — sidebar,
  settings cards, badges, etc.) — flagged in the facelift design spec as
  its own follow-up piece of work, not bundled here.
- Any change to `--action`, `--signal-*`, or any other `:root` token value.
- Any component markup change.

## Open questions

None. The root cause is a single, unambiguous hardcoded-color rule; the
fix is a direct substitution to the already-decided `--action` token.
