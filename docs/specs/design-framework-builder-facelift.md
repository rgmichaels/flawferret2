# Design: Framework Builder facelift (Turn 2a pilot)

Date: 2026-08-17

## Problem

`apps/web/app/framework/new/page.tsx` is a five-step GET-param wizard
(`framework` → `local-git` → `github` → `register` → `validate`), each step a
full page reload, with a right-hand "Build Plan" summary panel duplicating
state the user just entered. Concretely:

- Five steps for what is functionally three decisions (where, what to name
  it, what to include) plus three yes/no toggles (git init, GitHub push,
  register in FF2) that don't need their own pages — `wizardSteps` in
  `page.tsx:122-152` forces a full round trip per toggle.
- The step nav (`framework-wizard-steps`, `page.tsx:1499-1517`) and the
  summary aside (`framework-builder-summary`, `page.tsx:1710-1776`) both
  exist to answer "what have I chosen so far," which a single scrollable
  page with visible state doesn't need.
- Visually the page is undifferentiated from every other panel-and-form page
  in the app — `.panel`, `.job-form`, `.framework-wizard-section` — which is
  fine for Jobs/Settings but undersells this page's actual job: this is the
  one place a user commits to generating real files on disk (or a PR), and
  right now nothing about its presentation signals "this is the moment of
  commitment" any more than a settings toggle does.

Rob picked **Turn 2a** from
`docs/design-references/framework-builder-facelift/` (dark sidebar kept,
content re-themed to Broadsheet's serif/cyan system) as the direction to
design from. This spec adopts 2a's structural idea, adapts its type
treatment, and rejects its color system — see Direction below for why.

## Direction

### What Turn 2a gets right (adopt as-is)

**The consolidation is the real win, independent of any color/type choice.**
2a collapses the five wizard steps into one page with five labelled sections
(Where / Naming / Include / After building / Files), a persistent sticky
build bar at the bottom (Target · Files · Then · [Build framework]), and no
separate summary panel — the form *is* the summary, because every choice is
visible at once instead of hidden behind "step 3 of 5." For an operator who
already knows roughly what they want (a folder, a name, a few checkboxes),
this removes four page loads for zero loss of clarity. Adopt this
regardless of the typography/color question below.

Also adopt from 2a's markup, independent of theme:
- The `label-column + content-column` section pattern (180px label, hairline
  rule between sections) — reads as a spec sheet, not a form wizard. Fits an
  operational tool better than boxed `.panel` cards for a single linear
  task.
- The segmented toggle for **Where** (`Local folder` / `GitHub repository`)
  replacing the current implicit radio treatment.
- **Include** as toggleable tag/chips instead of a `<fieldset>` list of
  checkbox rows — same five features, more scannable, no loss of
  information (each chip still needs a visible on/off state, not just
  color, for colorblind/contrast reasons — see Component specs).
- **Files** as a dense two-column monospace list in a bordered block instead
  of the current `framework-file-card` article-per-file layout, which at 12
  files is already the tallest section on the page for the least-important
  information at build time (the user already knows roughly what a
  Playwright+Cucumber scaffold contains; they need the count and any
  conflicts, not a card per file).
- The sticky bottom bar's three-stat-plus-CTA shape (Target / Files / Then)
  as the final commit point, replacing the current split between a "Review
  & Validate" step and a separate `framework-create-form` "Create" step.

### What Turn 2a gets right in principle, wrong in specifics (adapt)

**Typography — DECIDED.** 2a sets `--font-heading` *and* `--font-body` to
Source Serif 4 across the whole page, including form labels, checkbox
captions, and the "Package name" input. My original recommendation was to
limit the serif to just the `h1` and the five section labels, on the
grounds that small-size serif body text is measurably harder to scan than a
sans body face at the 13–14px sizes this page is full of. **Rob has
overridden that scope call and wants serif usage closer to 2a's full-serif
look.** Final scope, decided:

**Moves to `Source Serif 4` (via `--font-display`):**
1. `h1` "Framework Builder" — 42px / 600, as in 2a.
2. The five section `h5` labels (Where / Naming / Include / After building /
   Files) — 16px / 600, as in 2a.
3. The one-line section description under each label (e.g. "Folder or
   GitHub repo.", "24 to create, 0 conflicts.") — 14px / 400. These read as
   editorial captions, not data, so the serif's higher-contrast strokes
   work in their favor rather than against scanability.
4. Field labels above inputs — "Project name," "Package name," "Base URL,"
   "Destination folder" — 13px / 500. Short, fixed vocabulary the user reads
   once per session, not re-scanned character-by-character the way a typed
   value is.
5. The three "After building" toggle captions ("Initialize git repository,"
   "Push to GitHub," "Register in FlawFerret2") — 14px / 500. Same
   reasoning as field labels: short fixed phrases, not data to verify.
6. Include chip text (the five `featureOptions` names) — 13px / 500.
7. The primary CTA text, "Build framework" — 15px / 600. This is the single
   commitment action on the page; a distinct display face here is
   defensible as emphasis, not decoration.

**Stays on `--font-body` (IBM Plex Sans) or `--font-mono` (IBM Plex Mono) —
explicitly rejected from the serif expansion, and flagged as the specific
places I'd still push back even under the broader direction:**
- **Typed input values** (the live text inside Project name / Package name /
  Base URL / folder path fields) — stays sans. This is the one place serif
  genuinely costs something real: the user has to verify their own typed
  text precisely (hyphens, camelCase, path separators), at exactly the size
  range where serif body legibility degrades most, and it's the only text
  on the page the user edits rather than reads. Keeping it sans also keeps
  it visually consistent with validation/error states elsewhere in the app,
  which are sans everywhere else.
- **The files list** (`framework-files-grid`) — stays mono. These are
  literal file paths; mono is already the app's established signal for
  "literal system output" (commands, paths, package names elsewhere in the
  app). Moving it to serif would blur that distinction for no benefit at a
  point in the flow where scanning 12–24 paths for a name you recognize is
  the whole task.
- **The sticky build bar's `dt`/`dd` pairs** (Target / Files / Then and
  their values) — stays sans/mono. `dt` is an uppercase, letter-spaced
  caption; serif faces generally don't have well-designed small-caps/
  uppercase forms and the combination reads worse, not more editorial. `dd`
  is computed data (a path, a count, a comma list) — same category as the
  files list, not a heading.
- **Conflict/error flags** on individual files — stays sans, tied to
  `--signal-*` tones, because legibility matters most exactly where the
  user needs to catch something before a destructive action.

This is a real widening from my original "title + labels only" scope — it
now touches every static/editorial string on the page (labels, captions,
descriptions, chip text, the CTA) rather than just the two headline
elements. The tradeoff I flagged originally is still real and worth stating
plainly: serif body-weight text at 13–14px is objectively harder to scan
than sans at the same size, and this page now carries more of it than my
original recommendation would have risked. Rob has seen that tradeoff and
is accepting it in exchange for a more distinctly "designed" surface;
implement per the scope above rather than re-litigating it, but the three
"stays sans/mono" categories above are not optional exceptions — they're
the minimum legibility floor I'd hold even under the broader direction, and
`coder` should not extend serif into typed values, the files list, or the
sticky bar's data cells even if it seems visually consistent to do so.

Candidate face: `Source Serif 4` at the weights above, matching 2a.

**Color — DECIDED.** This is the part of 2a Rob asked to see live before
deciding. I served the reference HTML locally with 2a's cyan
(`--color-accent: #0088b0`) rendered as the primary action color and
screenshotted it for him. After seeing it, Rob agreed with the original
recommendation below and confirmed: **keep the existing `--action: #2f4d8f`
indigo, do not adopt 2a's cyan/magenta accent system.** Reasoning, for the
record:

The existing six-tone status system
(`docs/specs/design-status-signal-system.md`, implemented in `styles.css`'s
`:root`) already assigns `--signal-active: #1c7c86` — a teal that sits in
the same hue family as 2a's cyan accent (both ~185–195° hue, differing
mainly in saturation/lightness). That prior spec's entire thesis is that
**one tone always means one thing** — teal/`active` currently means "a job
or run is in progress, no action needed yet," nothing else, anywhere in the
app. If the Framework Builder's primary action color also landed in that
hue, a "Build framework" button, an active nav item, and an in-progress job
pill would start reading as the same signal by proximity of color even
though they mean unrelated things — exactly the failure mode the six-tone
system was built to eliminate ("Nothing signals 'this is an action' vs.
'this is informational'" — the same complaint that motivated `--action:
#2f4d8f` in the first place).

`--action: #2f4d8f` (the existing deep indigo) stays this page's primary-
action color, including the "Build framework" button and the active
sidebar nav item. This preserves the six-tone system's invariant with zero
cost — the indigo already reads as "an actionable control," which is all
this page needs from it. 2a's secondary magenta accent
(`--color-accent-2: #d6006c`, unused in the 2a markup itself but present in
the token file) is also rejected — a second decorative accent color in a
review tool risks reading as playful/branded rather than operational,
which cuts against the same "fast trust decision" goal the signal system
was built around. If a distinct visual identity for Framework Builder
specifically is wanted later, that's a real product question ("should the
Create flows feel different from the review flows?") worth its own
conversation, not something to back into via a facelift spec.

Keep the paper/surface backgrounds as they are (`--paper: #e9ecf2`,
`--surface: #ffffff`) — 2a's `--color-bg: #f3f2f2` is close enough in
lightness/neutrality that swapping it buys nothing and 2a's own warmer
`--color-surface: #eae9e9` reads closer to "cream default" than the current
cooler paper does. No change here.

### Modularity: how this gets built without hardcoding Turn 2a

Two questions from the reference package, answered:

**1. Update existing token names, or add a parallel set?** Existing names,
not parallel — but **scoped to this page**, not promoted to `:root` yet.
Rob's "snap-in-able" goal implies token *values* should be swappable without
touching component markup — that's exactly what CSS custom properties do,
but only if the override happens at a scope, not by editing `:root`
directly for one page's sake. Concretely:

```css
/* apps/web/app/framework/new/ — page-scoped override, not a :root edit.
   Same token names the rest of the app already reads; only this subtree's
   resolved values change. */
.framework-builder-page {
  --font-display: "Source Serif 4", ui-serif, Georgia, serif;
  --font-display-weight: 600;
  /* --action, --paper, --surface, --border, --signal-* : intentionally
     NOT overridden here — see Color above. */
}
```

`h1`, the five section `h5`s, section descriptions, field labels, chip
text, the "After building" toggle captions, and the primary CTA all
reference `--font-display` (see Typography scope above). Typed input
values, the files list, and the sticky build bar's `dt`/`dd` cells
deliberately keep referencing `--font-body`/`--font-mono` instead — those
three are exceptions to carry forward even though the serif footprint on
this page is now much larger than "two elements."

This also directly answers "is this Turn 2a hardcoded into components?" —
no: swapping the look later (a different display face, a different accent
hue that doesn't collide with signal tones) is a one-block CSS change
scoped to `.framework-builder-page`, not a hunt through JSX for inline
styles. If a *second* page later wants its own look, it gets its own scope
block the same way. If the app-wide look changes for real, the values move
from this scope up into `:root` — the names don't change either way.

**2. Does the rest of `styles.css` actually consume tokens consistently
enough for "snap in a new look" to be true today?** No — and this is worth
flagging plainly rather than quietly working around it. A quick count:
`styles.css` (~6,500 lines) contains **753 raw hex-color literals**
(`grep -c '#[0-9a-fA-F]\{3,6\}'`). Some of that is legitimate (the tokens'
own hex definitions, `color-mix()` inputs, gradients), but a meaningful
fraction is component CSS reaching for a literal hex instead of
`var(--ink)` / `var(--border)` / a signal token — anywhere that's true, a
future token-value change silently won't reach that component. That gap is
exactly what would block "snap in a new look" from being true app-wide.

**Recommendation: scope that audit as its own follow-up spec, not part of
this one.** 753 occurrences across a 6,500-line file is too large to
responsibly fold into a page-level facelift — auditing which are
legitimate (token definitions, one-off `color-mix()` inputs, third-party
overrides) versus which are silent hardcoding that should become a `var()`
reference is its own scoped piece of work (`product-manager` should scope
it as a design-system audit ticket, not something `coder` improvises while
also reskinning a wizard page). This spec's scoped-override approach above
works today regardless of that audit's outcome — it doesn't depend on the
rest of the file being clean, it just doesn't try to fix the rest of the
file's hygiene as a side effect.

## Component specs

### Page shell (`apps/web/app/framework/new/page.tsx`)

Current: five `FrameworkWizardStep` values (`framework`, `local-git`,
`github`, `register`, `validate`) each rendered as a distinct step with its
own `<form method="get">` submit that reloads the page with updated query
params (`wizardSteps`, `getWizardStep`, `buildFrameworkHref`,
`page.tsx:120–270`), plus a separate right-column `framework-builder-summary`
aside restating the same state.

Proposed: one page, one form, five visible sections in submit order (Where,
Naming, Include, After building, Files-preview-on-request), no step nav, no
summary aside. This is a real change to the page's control flow, not just
its CSS — flag this to `coder` explicitly as touching `page.tsx`'s
state/step logic (the `FrameworkWizardStep` type, `wizardSteps`,
`getWizardStep`, `buildFrameworkHref`, and the four `hidden*Inputs` blocks
that currently pass state between steps can likely collapse once there's
only one step to pass state *to*), not a pure `styles.css` change. The
underlying server actions (`createFramework`, `installFrameworkDependencies`,
`openGeneratedFrameworkFolder`, `registerGeneratedFramework`,
`validateFramework`) and their request/response shapes are unaffected —
this is a presentation/flow change, not an API change.

Sections, in order, matching 2a's grouping:

1. **Where** — `FrameworkFolderPicker` (unchanged component) + destination
   segmented toggle.
2. **Naming** — Project name / Package name / Base URL (currently
   `framework-basics-grid`, unchanged fields; labels move to
   `--font-display`, typed values stay `--font-body` — see Typography).
3. **Include** — the five `featureOptions` as toggle chips (see below),
   replacing `framework-options`/`framework-option`.
4. **After building** — the three current step-2/3/4 toggles
   (`initializeGitRepository`, `createGithubRepository` +
   owner/repo/branch fields, `registerLocalRepository`) as one checklist
   block, each row showing its toggle inline rather than as a separate
   wizard page. The GitHub owner/repo/branch fields only need to be visible
   when `createGithubRepository` is checked — use existing
   progressive-disclosure patterns already in the app (e.g. `<details>`,
   already used for `framework-command-copy`) rather than a new pattern.
5. **Files** — preview list, collapsed to file count + conflict count by
   default with the file list itself behind a `<details>` (matching 2a's
   "24 to create, 0 conflicts" summary line), not always-expanded per-file
   cards.

Sticky bottom bar (new, replaces the current split between "Review &
Validate" step and separate `framework-create-form` "Create" step):

```html
<div class="framework-build-bar">
  <dl>
    <div><dt>Target</dt><dd class="mono">~/dev/acme-web/qa/e2e</dd></div>
    <div><dt>Files</dt><dd>24 new</dd></div>
    <div><dt>Then</dt><dd>git init · register · smoke</dd></div>
  </dl>
  <button type="submit" class="primary-button">Build framework</button>
</div>
```

```css
.framework-build-bar {
  position: sticky;
  bottom: 0;
  background: var(--ink);
  color: var(--paper);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 32px;
  margin-top: auto;
}
.framework-build-bar dt {
  font: var(--text-caption); /* sans, not --font-display — see Typography */
  letter-spacing: .08em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--paper) 60%, transparent);
}
.framework-build-bar dd {
  font: var(--text-body-s); /* sans/mono per field — see Typography */
  margin: 0;
}
.framework-build-bar .primary-button {
  background: var(--action);
  color: var(--paper);
  font: 600 15px var(--font-display); /* CTA text is serif — see Typography scope item 7 */
}
```

(`var(--ink)` for the bar background matches the existing dark sidebar
color already used elsewhere in the app — no new dark value needed.)

Post-build results (install/validate/register status, PR link, action
center) stay conceptually where they are today — this spec is about the
*build request* flow, not the results view, which already has its own
status treatment via `framework-results-checklist` and should be left as
the FLW-8 status-signal-system work already set it up (`pipelineSteps`
`state` values map to the six-tone system already; verify at implementation
time they use `--signal-*` tokens, not the ad hoc `.ready`/`.muted`/
`.future` classes currently in `framework-pipeline-list` — those three
classes predate the signal system and should migrate to `waiting` /
`inactive` / `active` tones as part of this pass since they're on the same
page).

### Section header (label column)

```html
<div class="framework-section">
  <div class="framework-section-label">
    <h5>Where</h5>
    <p>Folder or GitHub repo.</p>
  </div>
  <div class="framework-section-body"> …fields… </div>
</div>
```

```css
.framework-section {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 32px;
  padding: 26px 0;
  border-top: 1px solid var(--border);
}
.framework-section-label h5 {
  font: 600 16px/1.2 var(--font-display);
  margin: 0 0 4px;
}
.framework-section-label p {
  font: 400 14px/1.4 var(--font-display); /* description text — serif, see Typography scope item 3 */
  color: color-mix(in srgb, var(--ink) 55%, transparent);
  margin: 0;
}
.framework-field-label {
  font: 500 13px/1.2 var(--font-display); /* field labels — serif, scope item 4 */
  margin: 0 0 4px;
  display: block;
}
/* the <input>/<select> itself keeps --font-body — typed values are not part
   of the serif scope, see Typography */
```

### Include chips

Current `framework-option` is a checkbox row with label/description text.
Proposed chip keeps the checkbox (for keyboard/screen-reader semantics —
2a's mockup uses a plain `<span>` swatch, which is a decorative-only
on/off indicator; don't drop the real `<input type="checkbox">`) but
restyles it as a chip, and — unlike 2a's color-only checked state — pairs
the fill with a checkmark glyph so the state doesn't rely on color alone
(accessibility floor, not a Turn 2a addition):

```css
.framework-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  font: 500 13px var(--font-display); /* chip text — serif, scope item 6 */
  border: 1px solid var(--border);
  border-radius: 4px; /* matches the signal-system "beacon" radius, not a full pill */
  cursor: pointer;
}
.framework-chip:has(input:checked) {
  background: color-mix(in srgb, var(--action) 10%, var(--surface));
  border-color: var(--action);
}
.framework-chip input { position: absolute; opacity: 0; }
.framework-chip .framework-chip-mark {
  width: 14px; height: 14px; border-radius: 2px;
  border: 1px solid var(--border);
  display: grid; place-items: center; flex: none;
}
.framework-chip:has(input:checked) .framework-chip-mark {
  background: var(--action); border-color: var(--action);
}
/* checkmark glyph via ::after on .framework-chip-mark when checked,
   not color fill alone */
```

### After building toggle captions

Same treatment as chip text — the three toggle row labels ("Initialize git
repository," "Push to GitHub," "Register in FlawFerret2") use
`font: 500 14px var(--font-display)`. Any longer helper/explanatory copy
under a toggle (if `coder` adds any) stays `--font-body` — the serif scope
covers short fixed captions, not paragraph-length explanatory text.

### Files preview

Replace the per-file `framework-file-card` article list with the summary +
disclosed list pattern:

```html
<div class="framework-section">
  <div class="framework-section-label">
    <h5>Files</h5>
    <p>24 to create, 0 conflicts.</p>
  </div>
  <details class="framework-files-list">
    <summary>View files</summary>
    <div class="framework-files-grid">
      <span>package.json</span>
      <span>playwright.config.ts</span>
      <!-- … -->
    </div>
  </details>
</div>
```

```css
.framework-files-grid {
  font: var(--text-body-s) var(--font-mono); /* stays mono — not part of serif scope */
  line-height: 1.9;
  columns: 2;
  column-gap: 32px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 16px 20px;
}
```

If a file has a conflict (`status === "exists"` and overwrite behavior
matters), keep it visually flagged inline — don't let the density win
suppress the one piece of file-level information that actually matters
before a destructive action (overwrite). Use the existing
`--signal-attention` tone for conflicting entries, not a new color.

## Out of scope

- The results/validation view after a build completes
  (`framework-results-checklist`, action center, PR/registration cards) —
  leave its layout as-is; only migrate its three ad hoc `.ready`/`.muted`/
  `.future` classes to the existing `--signal-*` tones since that's a
  same-page consistency fix, not new design work.
- `apps/web/app/framework/builds/*` (the saved-build detail view) — not
  part of this reference package, not touched here.
- Any other page in `apps/web` — this is scoped to the Framework Builder
  create flow only. No `:root` token values change.
- The hardcoded-hex audit of `styles.css` (753 occurrences) — flagged
  above as a separate follow-up spec, not bundled into this change.
- Dark mode — the app has none today (`color-scheme: light` in `:root`);
  not introduced here.
- `FrameworkFolderPicker` component internals — reused as-is; only its
  container styling changes to fit the new section layout.

## Open questions

1. **Consolidating the wizard into one page is a flow change, not just a
   reskin** — confirm this is in scope for this pass (it's the main thing
   that makes Turn 2a's layout worth adopting) or whether Rob wants the
   visual restyle done first on the existing five-step flow, with
   consolidation as a separate follow-up. This spec assumes both happen
   together since 2a's visual design assumes the consolidated layout.
   **Still open** — not addressed by the two resolved items below; confirm
   before `coder` starts, since it changes the size of the diff
   substantially (page-flow logic in `page.tsx`, not just CSS).
2. **Serif display face — RESOLVED.** Originally scoped to "title + five
   section labels only," on scanability grounds. Rob overrode this and
   asked for serif usage closer to Turn 2a's full-serif look. Decided,
   concrete scope: serif (`Source Serif 4`) now covers the `h1`, the five
   section `h5` labels, the section description lines, field labels, the
   "After building" toggle captions, Include chip text, and the primary
   CTA text. Typed input values, the files list, and the sticky build
   bar's `dt`/`dd` data cells stay sans/mono — see Typography above for the
   full reasoning. The original scanability concern is noted as an accepted
   tradeoff, not resolved away; if labels/captions feel harder to scan in
   review than expected, narrowing back toward the original "title + labels
   only" scope is a small, isolated CSS change (the same tokens, fewer
   selectors referencing `--font-display`), not a rework.
3. **Rejecting 2a's cyan/magenta accents — RESOLVED.** Rob asked to see a
   live render of 2a's cyan accent before deciding; it was served locally
   and screenshotted. After seeing it, Rob confirmed the original
   recommendation: keep `--action: #2f4d8f` (indigo), reject 2a's cyan
   (`#0088b0`) and magenta (`#d6006c`) accents, for the reasons above (hue
   collision with `--signal-active` teal). No further sign-off needed.
4. **`.framework-builder-page` scope name** — placeholder; confirm or let
   `coder` pick during implementation, it's not load-bearing.

**Status: ready for `coder` on everything except open question 1** (whether
the wizard consolidation and visual restyle ship together or in sequence).
Typography and color are both finalized with no remaining ambiguity for
implementation. If Rob confirms question 1 is in scope as written, this
spec has no remaining blockers.
