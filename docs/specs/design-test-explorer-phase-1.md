# Design: Test Explorer (Phase 1) — three layout directions

Date: 2026-09-25

## Problem

`/features` (`apps/web/app/features/page.tsx`) today is a read-only catalog with a single-select
tag `<select>`, a static feature tree, and one "Test Local" button that queues exactly one
feature/scenario at a time (`createLocalTestRun`, `LocalTestRun` row, redirect-with-flash-message
back to `/features`). `/local-test-runs/page.tsx` shows one feature's run history as a flat table,
mixing every scenario's runs together with no way to scope to a single scenario. Per
`docs/specs/test-explorer-phase-1.md`, Phase 1 turns this into a real batch test runner: multi-select
across scenarios/features/tags, a selection-to-run flow, saved suites, live multi-item progress, a
rerun-failures action, per-scenario history, and a duration-trend signal. None of that has a
shape yet — this spec proposes three genuinely different visual/interaction treatments of the same
functional requirements, for the user to pick one before `coder` builds it.

All three directions satisfy every acceptance criterion in `test-explorer-phase-1.md`: tag rail
with per-tag scenario counts, checkbox multi-select (scenario/feature/tag), a way to reach Run Now
and Save as Suite from a selection, a Saved Suites list with Run/Load/Delete, a live-updating
progress view for a batch, a Rerun Failures action once a batch has failures, a per-scenario
history view, and a duration-trend badge gated on 6+ completed timed runs.

## Shared foundation (all three directions build on this — not re-specified per direction)

- **Type/color system**: use the tokens already defined in `apps/web/app/styles.css` (`:root`) and
  formalized in `docs/specs/design-status-signal-system.md` — `--font-display` (Space Grotesk) for
  headings/panel titles, `--font-body` (IBM Plex Sans) for copy, `--font-mono` (IBM Plex Mono) for
  IDs/paths/counts/anything reading as system output. Structural tokens `--ink`/`--paper`/`--surface`/
  `--border`/`--action` for chrome; signal tokens `--signal-waiting`/`--signal-decision`/
  `--signal-active`/`--signal-success`/`--signal-attention`/`--signal-inactive` for all status
  meaning.
- **`LocalTestRunStatus` → tone** (already specified in the signal-system doc, just not yet wired
  into `/features` or `/local-test-runs` — this build should do that wiring, not invent new status
  colors): `QUEUED`→waiting, `RUNNING`→active, `PASSED`→success, `FAILED`→attention,
  `CANCELED`→inactive. Use the shared `Beacon` component/markup from that spec
  (`<span class="beacon beacon--{tone}"><span class="beacon-dot"/>{Label}</span>`) everywhere a
  `LocalTestRun` or batch status is shown, replacing the legacy `.local-test-run-status.queued/
  .running/.passed/.failed/.canceled` ad hoc palette in all three directions below. This closes the
  gap the signal-system spec explicitly left as a follow-up.
- **Batch status → tone**: `RUNNING`→active, `QUEUED`→waiting, `FAILED`→attention, `PASSED`→success,
  `CANCELED`→inactive (same mapping, applied to the derived batch `status` from
  `GET /repositories/:id/test-runs/:batchId`).
- **Duration trend → tone, not a new color**: `"slower"` uses `--signal-attention`, `"faster"` uses
  `--signal-success`, `"flat"`/`null` render nothing (per acceptance criteria — no badge, not a
  neutral one). Never invent a 7th tone for this.
- **Spacing**: stay on the existing 8px-multiple scale (8/10/12/14/16/18/20/24/28) already used
  throughout `styles.css` — panels at `padding: 18px 20px`, gaps of 14–20px between panel-level
  blocks, 6–10px inside compact components like chips.
- **Panels**: `.panel` (`background: #fff; border: 1px solid #dce3ee; border-radius: 8px`) is the
  established card language — all three directions reuse it for major regions rather than invent a
  new card style, so this still reads as the same app.

What genuinely differs between the three directions: primary navigation model (tree vs. flat
table vs. tag lanes), where/how the in-progress selection lives on screen, how live batch progress
is rendered, and how history + the trend badge are laid out (table vs. timeline vs. log).

---

## Direction A — "Tree Console" (tree-first navigation, persistent compact tray, dense table history)

**Core idea**: the smallest possible delta from what's already built. Keep the existing two-column
`.feature-explorer` (tag/tree rail + preview panel) exactly as today's structure, add tag chips
into the rail above the tree, make every tree node and chip checkbox-selectable, and dock
selection state as a slim persistent bar at the bottom of the content column — always present,
never a modal, so building a run never interrupts browsing. This is the safest, most "evolutionary"
of the three: reviewer confidence over novelty.

**Layout / navigation**:
- Left rail (`.feature-tree-panel`, unchanged width `minmax(320px, 460px)`) gains a **Tags**
  sub-panel above the existing tree, inside the same `.panel`: a wrapped row of chips, each
  `<label class="tag-chip"><input type="checkbox"/> auth <span class="tag-chip-count">12</span></label>`,
  sorted by count descending. A thin `border-bottom: 1px solid var(--border)` separates it from the
  tree below, so it reads as "two sections of one panel," not a new panel.
- The feature tree (`renderFeatureTree`) becomes a client component; each `<li>` gets a checkbox
  before the folder/feature icon. Checking a feature checks all its scenarios; an indeterminate
  (`-`) state shows when some-but-not-all of a feature's scenarios are checked (native
  `input.indeterminate` via a small effect).
- Right pane keeps today's feature-preview content, but each scenario row in
  `.feature-preview-scenario-list` gets its own checkbox at the start of the `<li>`, plus a small
  "View History" text link at the end (satisfies the per-scenario history link requirement) next to
  the existing "Matched"/"N unmatched" text.
- **Saved Suites** becomes a third stacked sub-panel in the left rail, below the tree, in its own
  `.panel` (separate card so it doesn't scroll away with a long tree — tree panel keeps its
  existing `position: sticky`, Suites panel sits below it in normal flow). Each row:
  `name · N scenarios` with three small icon-buttons (Run / Load / Delete) right-aligned, reusing
  `.secondary-button` sizing at a smaller `padding: 4px 8px`.

**Selection tray**: a `.selection-tray` bar pinned to the bottom of `.app-content` (not the
viewport — stays inside the scrollable content area, `position: sticky; bottom: 0`), full width of
the content column, `background: var(--ink); color: #fff; border-radius: 8px 8px 0 0` — a
deliberately darker strip so it reads as "the console," distinct from the white panels above it.
- Empty state: collapsed to a 34px slim strip with muted text "No scenarios selected — check items
  in the tree or a tag to build a run." (low-contrast, `opacity: 0.55`), no buttons rendered.
- Populated state expands to ~64px: left side shows a running count as three small stats in mono
  type — `8 scenarios · 3 features · 2 tags` — right side has three actions: `Run Now` (primary,
  `--action` background, white text), `Save as Suite` (`.secondary-button` but inverted for the
  dark bar — white 1px border, transparent fill), and a plain-text `Clear` link.
- `Save as Suite` opens a small centered `<dialog>` (native) with a single name `<input>` and
  Save/Cancel — the only place in Direction A that uses a modal, kept minimal (one field).

**Live progress**: `/test-runs/[batchId]` keeps the existing `.panel` page chrome (topbar +
one panel), but the panel body is a **dense table** — same visual family as today's
`.local-test-run-list.wide` — one row per `LocalTestRun`: Beacon · scenario/feature label · duration
· exit code · "View Output" link. Header row above the table is a horizontal segmented progress bar:
a single `<div class="batch-progress-bar">` split into N equal segments (N = total runs), each
segment tinted by that run's current tone (waiting/active/success/attention/inactive), updating
in place as polling refreshes — no re-layout, just segment color changes, so it reads as a literal
progress meter rather than a redrawn chart. Directly above the bar: `<strong>3 of 8 complete</strong>`
plus the required sequential-execution note in smaller muted text. Polling: `setInterval` every 2s
while batch `status` is `QUEUED`/`RUNNING`, cleared on terminal state (client component, same
pattern as other polling already in the codebase — mirrors readiness polling conventions).
- Loading (pre-first-response) state: the table renders as 8 skeleton rows (`background: var(--paper)`
  pulsing) — count matches `runs.length` once the first response lands, so no layout jump.
- Terminal + has failures: a `Rerun Failures` button appears left-aligned below the table, styled as
  `.secondary-button` with `border-color: var(--signal-attention); color: var(--signal-attention)` —
  the one spot color leaves the neutral secondary-button palette, because it's specifically "redo
  the bad ones."

**History + duration trend**: `/local-test-runs` keeps its existing flat `<ol class="local-test-run-list
wide">` table layout unchanged structurally, just re-skinned with `Beacon` instead of
`.local-test-run-status`. The duration-trend badge sits inline next to the existing "Avg Time" stat
in both `.feature-preview-stats`-style `dl`s and the history page header:
`<dd>{avg} <span class="trend-badge trend-badge--attention">↑ Trending slower</span></dd>` — text
badge, no background fill (just colored text + a tiny arrow glyph), so it reads as an annotation on
the number rather than a competing status pill. Omitted entirely for `flat`/`null`.

**Typography/color notes specific to A**: the dark `.selection-tray` is the only non-white surface
introduced; everything else stays on existing panel/paper backgrounds. Tag chip counts use
`--font-mono` at 11px to visually match the existing caption/mono-for-counts convention already
used in the tree (`<small>{count} scenarios</small>`).

---

## Direction B — "Selection Drawer" (tag-first flat table, drawer/modal selection flow, card progress, timeline history)

**Core idea**: lead with tags and a flat, sortable, filterable scenario table instead of a file
tree — closer to how someone thinks about "run everything tagged `@checkout`" than "find it in the
folder structure." Selection is deliberately out-of-the-way (a floating summary pill that opens a
bottom drawer on demand) rather than always-visible, favoring a bigger, less-obstructed browsing
area over Direction A's persistent tray. This direction should feel the most like a purpose-built
test-runner tool and the least like an extension of the existing catalog page.

**Layout / navigation**:
- Full-width toolbar at the top of the page: a horizontal, wrapping row of tag chips
  (`.tag-filter-bar`), each `<button class="tag-chip" aria-pressed>` — clicking a chip **filters**
  the table below to that tag (single click) while a small checkbox inset in the same chip
  (`<input type="checkbox" class="tag-chip-select"/>`) is the actual "select every scenario with
  this tag" control — filtering and selecting are separate, deliberately: browsing shouldn't force
  a selection side-effect. A "Browse by file" toggle (`<button class="ghost-toggle">`) top-right
  switches the main area to the existing tree view for people who prefer it — off by default in
  this direction, present so folder-oriented users aren't stranded, but the tag/table view is what
  ships as primary.
- Below the toolbar: a full-width `.panel` containing a **flat scenario table** (not grouped by
  feature file): columns `[checkbox] Scenario · Feature · Tags · Last Run · Avg Duration (+ trend
  badge) · [View History]`. Sortable by clicking column headers (client-side sort on already-fetched
  catalog data — no new API needed). A `Feature` column value links to that feature's detail page;
  a small caret before each scenario row can expand to show its steps inline (progressive disclosure
  instead of the separate feature-detail page being the only way to see steps) — optional nicety,
  not required for acceptance criteria, flag as an enhancement `coder` can drop if time-boxed.
- Each feature can also be selected as a whole via a `Select all N scenarios in this feature`
  affordance in a small header strip row inserted above each feature's group of scenario rows when
  the table is in "grouped" mode (a view toggle: Flat / By Feature) — satisfies feature-level
  selection without bringing back a tree.

**Selection interaction**: as scenarios/tags are checked, a small floating pill
(`.selection-pill`, `position: fixed; bottom: 24px; right: 24px`) appears —
`background: var(--action); color: #fff; border-radius: 999px; padding: 10px 18px` —
reading `8 selected`. Clicking it (or it auto-opens on first selection, user's call to disable
auto-open) slides up a **bottom drawer** (`.selection-drawer`, `position: fixed; bottom: 0; left: 0;
right: 0; height: 34vh; background: var(--surface); border-top: 1px solid var(--border);
box-shadow: 0 -8px 24px rgb(0 0 0 / 8%)`) containing: a chip list of everything selected (each chip
individually removable, `×` button), the same running count breakdown as Direction A
(scenarios/features/tags), and the Run Now / Save as Suite / Clear actions along the bottom edge of
the drawer. The drawer is dismissible (swipe-down affordance / explicit `×` top-right) without
losing selection — closing it just collapses back to the pill.
- Empty state: no pill renders at all until the first checkbox is checked (nothing persistent
  taking up space, unlike Direction A's always-visible slim strip).
- `Save as Suite` inside the drawer opens a modal `<dialog>` exactly as in Direction A (shared
  pattern, not re-specified differently here).

**Saved Suites**: rendered as a horizontal card row (`.suite-card-row`, flex with horizontal
scroll on overflow) directly under the tag toolbar, above the scenario table — each
`.suite-card` is a small `.panel`-styled tile (`min-width: 200px`): suite name in
`--text-display-s`, `N scenarios` in muted mono caption, and three icon-only buttons (▶ Run, ⇪
Load, 🗑 Delete) in a row at the card's bottom edge. Cards, not a list, because this direction
generally favors compact glanceable tiles over Direction A's list-row treatment.

**Live progress**: `/test-runs/[batchId]` renders as a **card grid** instead of a table —
`.batch-run-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
gap: 12px; }`, one `.batch-run-card` per `LocalTestRun`: Beacon top-left, scenario/feature name,
duration, a "View Output" link bottom-right. Cards update in place on each poll; a card that just
transitioned to a terminal state gets a brief `outline: 2px solid var(--signal-{tone})` pulse
(CSS `@keyframes`, ~600ms, then removed) so a change is noticeable in a grid where nothing scrolls
into view like a table row would. Above the grid: a segmented progress bar identical in spirit to
Direction A's (same component, shared across directions is fine and encouraged — it's not a
differentiator), plus the "X of N complete" count and sequential-execution note.
- Loading state: grid renders `N` skeleton cards (gray pulsing rectangles) sized to match real
  cards, same rationale as Direction A.
- Rerun Failures: appears as a `.selection-pill`-style floating action bottom-right once the batch
  is terminal with failures — consistent with this direction's "floating action" language rather
  than an inline button, so the two directions read differently even in this shared moment.

**History + duration trend**: `/local-test-runs` becomes a **vertical timeline**, not a table:
`.run-timeline { display: grid; gap: 0; border-left: 2px solid var(--border); margin-left: 6px;
padding-left: 20px; }`, each entry a `.run-timeline-item` with a small filled dot in the run's
signal tone sitting on the border line (`margin-left: -26px`), the date/time in mono caption above,
and a one-line summary (`Passed · 1.4s · exit 0`) below, with "View Output" as a trailing link.
Newest at top. The duration-trend badge appears once, in the page header stat block (not per-row —
it's a trend across the whole scoped run set, not a per-run fact), styled as in the shared
foundation section, placed next to the header's average-duration figure.

**Typography/color notes specific to B**: this is the most "product-y" of the three — card corner
radius can go slightly larger (`10px` vs. the standard `8px`) on `.suite-card`/`.batch-run-card`
only, as a deliberate small differentiator for "selectable/actionable tile" vs. the standard
`.panel`'s `8px`, everything else stays on the shared tokens.

---

## Direction C — "Workbench Console" (tag-lane navigation, terminal-style tray, log-style progress/history)

**Core idea**: lean hardest into the existing design system's own stated concept — "an
instrumentation panel... the console a QA engineer watches while autonomous agents work"
(`design-status-signal-system.md`). Tags become horizontal lanes (kanban-style) of scenario chips
you scan and click through; the selection tray is a full-width, always-docked terminal-styled bar
at the very bottom of the viewport (not just the content column); and both live progress and
history render as literal scrolling log feeds rather than tables or cards. This is the most visually
distinctive of the three and the biggest departure from today's `/features` page structure.

**Layout / navigation**:
- Main content area is a horizontally-scrollable row of **tag lanes**: `.tag-lane-board {
  display: flex; gap: 16px; overflow-x: auto; padding-bottom: 8px; }`. Each `.tag-lane` is a
  fixed-width (`280px`) `.panel` column: header = tag name + count + a lane-level "select all"
  checkbox (`padding: 14px 16px; border-bottom: 1px solid var(--border)`), body = a vertical list
  of compact scenario chips (`padding: 8px 16px`, checkbox + truncated scenario name + feature
  filename in mono caption below it). An "Untagged" lane always appears last for scenarios with no
  tags, so nothing is unreachable from this view. A `View as file tree` toggle top-of-page switches
  to the existing tree layout (same escape hatch as Direction B, offered for the same reason —
  folder-oriented users shouldn't be stuck), off by default.
- Whole-feature selection: a feature-level chip can appear inside any lane its scenarios belong to,
  but the authoritative place to select an entire feature is a small **Features** rail collapsed by
  default at the left edge of the lane board (`<details>` disclosure, closed on load) — kept minor
  because lanes are the primary unit of this direction; feature-level selection is a secondary path,
  not the headline interaction.
- **Saved Suites** lives as its own lane at the far left of the board, visually distinct
  (`background: color-mix(in srgb, var(--ink) 4%, var(--surface))` — the same "recessed" treatment
  the signal-system spec already uses for secondary/reference panels on job detail), each suite
  rendered as a chip with Run/Load/Delete as a 3-icon row, same as Direction A's compact icon
  buttons.

**Selection tray**: a full-viewport-width bar fixed to the bottom of the browser window (`position:
fixed; bottom: 0; left: 0; right: 0`, sits below `.app-shell`'s content, above nothing — this is the
one direction where the tray breaks out of the sidebar+content grid entirely), styled explicitly as
a terminal: `background: var(--ink); color: #d9e3f3; font-family: var(--font-mono); font-size: 13px;
padding: 10px 24px; border-top: 1px solid rgb(255 255 255 / 12%)`. Content reads like a status line:
`> 8 scenarios selected (3 features, 2 tags)` with `Run Now` / `Save as Suite` / `Clear` rendered as
inline bracketed pseudo-commands — `[Run Now]` `[Save as Suite]` `[Clear]` — each a real `<button>`
underneath, just typeset to look like terminal affordances (`background: transparent; border: 1px
solid currentColor; color: var(--signal-active)` for `[Run Now]` specifically, so the one
colored element in the bar is the primary action).
- Empty state: `> No selection. Check scenarios in a lane, or a whole tag, to build a run.` in
  `opacity: 0.5`, no buttons.
- This tray is always present at a fixed 40px height (never collapses to nothing), reinforcing the
  "always-on console" feel — the tradeoff (permanently reserved vertical space) is called out below
  for the user's judgment.

**Live progress**: `/test-runs/[batchId]` renders as a **scrolling log feed**, not a table or grid:
`.batch-log { background: var(--ink); color: #d9e3f3; font-family: var(--font-mono); font-size: 13px;
line-height: 1.7; border-radius: 8px; padding: 16px 20px; max-height: 520px; overflow-y: auto; }`.
Each `LocalTestRun` renders one line, prefixed with a bracketed status token colored by tone —
`[QUEUED]`, `[RUNNING]`, `[PASS]`, `[FAIL]`, `[SKIP]` — followed by the scenario/feature label and,
once terminal, duration and a `→ view output` link at line end. New/changed lines on each poll get
a brief highlight flash (`background` transition), then settle. Above the log: a single-line header
`8 of 8 complete — 6 passed, 2 failed` (composed from the `summary` object directly, no separate
progress bar graphic in this direction — the log itself and the header line are the progress
indicator, consistent with "console output" rather than a dashboard widget) plus the required
sequential-execution note, still in prose, just smaller/muted below the header line.
- Loading state: the log shows a single pulsing line, `> resolving batch…`, before the first
  response.
- Rerun Failures: rendered as another bracketed pseudo-command, `[Rerun Failures]`, appended as the
  last line of the log once terminal-with-failures, colored `var(--signal-attention)` — keeps the
  entire progress view feeling like one continuous console stream rather than log-plus-UI-chrome.

**History + duration trend**: `/local-test-runs` mirrors the same log aesthetic —
`.run-log-history` with the same `.batch-log`-style dark monospace block, one line per past run,
newest first, format: `2026-09-24 14:02  [PASS]  1.4s  exit 0`. Pagination becomes `[← older]` /
`[newer →]` bracketed-command links at the bottom of the block, matching the tray's typographic
language. The duration-trend badge is folded directly into the block's header line as a data
readout rather than a separate badge element: `Avg 1.6s  (Δ +38% vs. prior — trending slower)` in
`--signal-attention`; nothing appended when `flat`/`null`. This is the direction where the trend
signal is treated as "another log fact," not a UI badge — consistent with the rest of the page.

**Typography/color notes specific to C**: this direction introduces the most net-new dark surface
area (lane board stays light/panel-based, but tray + both progress and history views go dark
monospace) — flag this explicitly as a tradeoff: it's the most thematically "on brand" for
VISION.md's instrumentation-console framing, but is a bigger visual departure from today's
otherwise all-light-surface app than A or B, and commits the team to maintaining a second
(dark-on-`--ink`) rendering path for run status text (legible signal-tone-on-`--ink` contrast needs
checking at implementation time, same way `.generated-diff-output` already does on job detail).

---

## Empty/loading states — common checklist per direction

Each direction must define, and does above:
- **No tags discovered** (repository has scenarios but none tagged): tag rail/bar/lane still
  renders, just showing only the "Untagged"/no-tags case — never hide the region entirely, since
  its presence is how a user learns tagging would help.
- **No scenarios selected**: tray/pill/log-line shows the muted empty copy specified per direction
  above; Run Now/Save as Suite are not rendered (not present, not merely disabled — matches how
  `createLocalTestRun`'s form already only renders when there's something to act on).
- **No saved suites yet**: the Suites panel/lane/row still renders with a one-line "No saved suites
  yet — save a selection to reuse it later" instead of disappearing.
- **Batch progress loading** (pre-first-poll-response): skeleton table rows / skeleton cards /
  single pulsing log line, per direction, sized so the first real response doesn't cause layout
  jump.
- **No run history for a scenario yet**: reuse the existing `<p className="empty">No local test runs
  have been recorded yet.</p>` pattern already on `/local-test-runs` — no new empty-state language
  needed here.
- **Fewer than 6 completed timed runs**: duration-trend element renders nothing (already specified
  per-direction above) — not a "not enough data" placeholder, per the spec's explicit acceptance
  criterion that no misleading/hedged claim should show either.

## Out of scope (all directions)

- Any new data/API shape beyond what `test-explorer-phase-1.md` already specifies — these are
  purely rendering/layout choices over the same `TestSuiteResponse`/`TestRunBatchResponse`/
  `TestRunBatchStatusResponse`/`LocalTestRunStatsResponse.durationTrend` shapes.
- Dark mode, mobile-specific layout beyond the existing responsive breakpoints already in
  `styles.css` (each direction should respect the existing `@media` collapse points, not introduce
  new ones, except where a direction's own structure requires an equivalent stack-to-one-column
  rule, e.g. Direction C's lane board scrolling horizontally on narrow viewports instead of
  stacking).
- Flakiness scoring, root-cause clustering, scheduling, CI as a run source, artifacts beyond
  stdout/stderr — unchanged from the product spec's own out-of-scope list.

## Open questions

- Which direction to build: A (lowest-risk evolution of the current page), B (flat/table-first,
  most "purpose-built test runner" feeling, biggest structural change to `/features`), or C (most
  thematically distinctive, biggest visual-surface-area change, commits to a second dark rendering
  path). Recommend the user view all three as HTML comps before deciding — effort to implement is
  roughly A < B < C.
- Direction C's persistently-docked 40px tray permanently reduces vertical content space on every
  visit to `/features`, even with nothing selected — confirm that tradeoff is acceptable before
  committing to it, versus A/B's collapse-when-empty trays.
- Whether the "Browse by file" / "View as file tree" escape hatch in B and C is required for this
  phase or can be deferred — it's not in the product spec's acceptance criteria (which only require
  a tag rail *alongside* the tree, not a full alternate navigation mode), so it's an addition these
  two directions introduce to make tag-first navigation not feel like a regression for
  folder-oriented users. Confirm whether that's wanted now or should be dropped to keep B/C's scope
  tighter.
