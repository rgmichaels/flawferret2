# Framework Builder visual restyle

Status: Draft
Date: 2026-08-17

Design source: `docs/specs/design-framework-builder-facelift.md` (Typography
and Color sections, both marked DECIDED, plus the Component specs for
section headers, Include chips, "After building" captions, files preview,
and the sticky build bar).

**Depends on `docs/specs/framework-builder-wizard-consolidation.md` landing
first** (or at minimum being scoped/in-progress with an agreed section
structure). This ticket restyles the consolidated one-page layout (Where /
Naming / Include / After building / Files sections + sticky build bar); it
does not restyle the current five-step wizard, and should not start
implementation until the consolidated section markup exists to style
against.

## Problem

Visually, `apps/web/app/framework/new/page.tsx` is undifferentiated from
every other panel-and-form page in the app (`.panel`, `.job-form`,
`.framework-wizard-section`), which is fine for Jobs/Settings but undersells
this page's actual job: it's the one place a user commits to generating real
files on disk (or a PR), and nothing about its current presentation signals
"this is the moment of commitment" any more than a settings toggle does.

## Proposed change

App: `apps/web` only. Files: `apps/web/app/framework/new/page.tsx` (markup/
class names for the consolidated sections built by the companion ticket)
and `apps/web/app/styles.css` (new page-scoped rules). No API, schema, or
Prisma changes.

### Scope: token overrides, page-scoped only

Add a `.framework-builder-page` scope (or `coder`'s equivalent chosen name —
not load-bearing) overriding `--font-display` to `"Source Serif 4", ui-serif,
Georgia, serif` at the page root, per the design spec's modularity section.
Do **not** edit `--action`, `--paper`, `--surface`, `--border`, or any
`--signal-*` token, and do **not** promote any value to `:root` — this is a
page-scoped CSS custom-property override, not a global theme change.

Load `Source Serif 4` (Google Fonts or self-hosted, `coder`'s call, matching
however the app currently loads `IBM Plex Sans`/`IBM Plex Mono`) at the
weights the spec requires: 600 (headings/CTA), 500 (labels/captions/chips),
400 (descriptions).

### Typography — exact scope (do not extend beyond this list)

**Moves to `--font-display` (Source Serif 4):**
1. `h1` "Framework Builder" — 42px / 600.
2. The five section `h5` labels (Where / Naming / Include / After building /
   Files) — 16px / 600.
3. The one-line section description under each label (e.g. "Folder or
   GitHub repo.") — 14px / 400.
4. Field labels above inputs ("Project name," "Package name," "Base URL,"
   "Destination folder") — 13px / 500.
5. The three "After building" toggle captions ("Initialize git repository,"
   "Push to GitHub," "Register in FlawFerret2") — 14px / 500. Any longer
   helper/explanatory copy under a toggle stays `--font-body`.
6. Include chip text (the five `featureOptions` names) — 13px / 500.
7. The primary CTA text, "Build framework" — 15px / 600.

**Explicitly stays `--font-body` (IBM Plex Sans) or `--font-mono` (IBM Plex
Mono) — do not extend serif here even if it looks visually consistent:**
- Typed input values (live text inside Project name / Package name / Base
  URL / folder path fields) — stays sans. Users verify their own typed text
  precisely at this size range; also keeps consistency with sans
  validation/error states elsewhere.
- The files list (`framework-files-grid`) — stays mono, the app's
  established signal for literal system output (paths, commands, package
  names).
- The sticky build bar's `dt`/`dd` pairs (Target / Files / Then and their
  values) — stays sans/mono. Uppercase `dt` captions don't have well-
  designed serif small-caps forms; `dd` is computed data, not a heading.
- Conflict/error flags on individual files — stays sans, tied to
  `--signal-*` tones.

### Color — no change to accent hue

Keep `--action: #2f4d8f` (existing indigo) as the primary action color,
including the "Build framework" button and active sidebar nav item. Do
**not** adopt Turn 2a's cyan (`--color-accent: #0088b0`) or magenta
(`--color-accent-2: #d6006c`) — both already screenshotted and reviewed by
Rob, rejected because cyan collides in hue with `--signal-active` (the
six-tone status system's "in progress" teal), which would make the primary
build action visually read as a status signal. Keep `--paper`/`--surface`
as they are — no background change.

### Component styling

Per the design spec's Component specs section (implement as written there,
this ticket doesn't restate the CSS verbatim):
- **Section header** (`framework-section`): `label-column + content-column`
  grid (180px label, hairline top border), replacing boxed `.panel` cards.
- **Where**: segmented toggle for Local folder / GitHub repository,
  replacing the current implicit radio treatment.
- **Include chips** (`framework-chip`): checkbox-backed (keep the real
  `<input type="checkbox">` for keyboard/screen-reader semantics — do not
  drop it for a decorative-only span), filled state paired with a checkmark
  glyph, not color alone, for colorblind/contrast reasons. 4px border-radius
  matching the signal-system "beacon" radius, not a full pill.
- **Files preview**: dense two-column monospace list
  (`framework-files-grid`) in a bordered block, collapsed behind
  `<details>`/`<summary>` showing "N to create, M conflicts" by default.
  Conflicting entries flagged inline using the existing `--signal-attention`
  tone, not a new color.
- **Sticky build bar** (`framework-build-bar`): `position: sticky; bottom:
  0`, `var(--ink)` background (matches the existing dark sidebar color, no
  new dark value), Target / Files / Then `dl` plus the "Build framework"
  primary button.
- **Same-page cleanup**: migrate `framework-pipeline-list`'s three ad hoc
  `.ready`/`.muted`/`.future` classes to the existing `--signal-*` tones
  (`waiting` / `inactive` / `active`) as part of this pass — these predate
  the status-signal-system work (`docs/specs/design-status-signal-system.md`)
  and this page is the one place they still linger.

## User stories / acceptance criteria

- As a user on the Framework Builder page, I see the page title, section
  labels, section descriptions, field labels, "After building" toggle
  captions, Include chip text, and the "Build framework" CTA rendered in
  Source Serif 4, at the weights/sizes specified above.
- Given I am typing into Project name, Package name, Base URL, or the
  destination folder field, then the text I type renders in the sans body
  font, not serif.
- Given the files preview is expanded, then the file paths render in
  monospace, not serif.
- Given the sticky build bar is visible, then its Target/Files/Then labels
  and values render in sans/mono, not serif.
- As a user, I see the "Build framework" button and any active/selected
  controls on this page use the existing indigo `--action` color; no cyan
  or magenta appears anywhere on the page.
- Given an Include chip is toggled on, then its checked state is
  distinguishable by both a fill color change and a checkmark glyph, not
  color alone.
- Given a file in the files preview has a naming conflict, then it is
  visually flagged using `--signal-attention`, not a bespoke color.
- Given the framework pipeline/results list on this page, when its steps
  render in `ready`/`waiting`/`future`-equivalent states, then they use the
  `--signal-*` tones (not the legacy `.ready`/`.muted`/`.future` classes).
- No `:root` token value changes as part of this ticket — verify via diff
  that `styles.css`'s `:root` block is untouched and all new rules are
  scoped under the page's container class.

## Out of scope

- Any flow/state change to the wizard (step consolidation, form
  submission logic) — that's the companion ticket,
  `docs/specs/framework-builder-wizard-consolidation.md`, and must land
  first.
- The results/validation view's layout (only its three ad hoc status
  classes are touched, per above).
- `apps/web/app/framework/builds/*`.
- Any other page in `apps/web`.
- The hardcoded-hex audit of `styles.css` (753 raw hex literals per the
  design spec) — flagged there as a separate follow-up spec, not bundled
  into this restyle.
- Dark mode.
- `FrameworkFolderPicker` internals — only its container styling changes.

## Open questions

None blocking, provided the companion consolidation ticket has landed (or
its section markup/class structure is agreed) before this starts — see
Depends-on note above. Typography and color choices are both finalized
(design spec marks both DECIDED with no remaining ambiguity). The
`.framework-builder-page` scope name itself is not load-bearing; `coder`
may pick the exact class/selector name.
