# Design: Status Signal System (visual identity + status representation)

Date: 2026-08-13

Status: Draft

**Resolved (2026-08-13):** Open Question 4 (whether `#2563eb` → `--action` should apply app-wide vs. only Dashboard/Job Detail) is resolved as **app-wide** — the user confirmed one consistent action color everywhere is the intended outcome, superseding the original "scoped to two pages" instruction. Also extending this pass to migrate `.diagnostic-item`/`.validation-trust-card` (Job Detail) to signal tokens, closing the gap flagged in code review.

## Problem

Every page in `apps/web/app` currently reads as a default admin-dashboard template rather than a tool with a point of view. Concretely:

1. **One accent color does every job.** `#2563eb` is used for primary buttons, links, active nav, eyebrows, focus/hover borders, form submit, pagination, `.panel-actions`, and more (`apps/web/app/styles.css:308-363` and throughout). Nothing signals "this is an action" vs. "this is informational" vs. "this is a warning" — it's all the same blue.

2. **Status color is assigned by rough vibe, not by what the operator actually needs to know.** `.status-pill` (`styles.css:2485-2541`) buckets 16 `JobStatus` values into 5 stoplight colors:
   - `QUEUED` and `NEEDS_REVIEW` → blue, but one is "system will get to it" and the other is "a human must act right now." Same color, opposite urgency.
   - `CLAIMED`/`RUNNING`/`VALIDATING`/`READY_FOR_CODEX` → green, but `READY_FOR_CODEX` is a human approval gate, not "in progress." Green usually reads as "good/done," which is wrong here.
   - `REVIEW`/`PR_APPROVED`/`PR_CREATED`/`CODEX_APPROVED` → amber, mixing "needs your click" (`REVIEW`) with "you already approved this, it's just waiting on the runner" (`PR_APPROVED`, `CODEX_APPROVED`).
   - `COMPLETED` → purple, for no legible reason.
   - `.run-pill` (`styles.css:2543-2575`) then re-buckets the overlapping `RunStatus` enum with a **different** mapping (`STARTED`/`CODEX_RUNNING`/`VALIDATING`/`PUSHING`/`READY_FOR_CODEX` → blue, not green), so the same words mean different colors depending on which pill you're looking at.

3. **Three separate, uncoordinated tone vocabularies exist in the same app**: `.system-status-list dd` uses `positive`/`warning`/`danger` (`styles.css:199-209`); `.diagnostic-item` and `.validation-trust-card` use `ok`/`warn`/`danger`/`muted` (`styles.css:4929-5002`, `5203-5221`); the `framework-*` components use `passed`/`installed`/`failed`/`skipped` (`styles.css:1281-1337`, `1853-1907`). None of these share tokens, so fixing or extending status logic means touching N different color tables.

4. **The page whose entire job is "help me decide if this PR is safe to merge" — the job detail page (`apps/web/app/jobs/[id]/page.tsx`) — has no synthesis.** It renders ~10 white bordered panels of equal visual weight in sequence (execution-mode, stage-tracker, validation-trust, diagnostics ×2, pipeline grid, timeline). The actual trust signal a reviewer needs (validation tone + job status + PR lifecycle) is scattered across three of those panels with no single answer up top.

5. **Typography carries no personality.** Inter/system-ui everywhere, hierarchy built almost entirely from `font-weight: 800/900` rather than a real type scale — when everything is bold, nothing stands out (see `h1`/`h2`/`.eyebrow`/`.metric-card strong` all fighting for the same visual register).

This is the highest-impact area to fix because it's not one page — it's the token layer every page inherits, and it directly serves the one thing VISION.md says this tool exists for: letting a human make a fast, confident call on AI-generated work.

## Direction

**Concept**: an instrumentation panel for an automated QA operation, not a SaaS admin template. The product name is literally about hunting flaws; the UI should read like the console a QA engineer watches while autonomous agents work, not like a generic CRM.

### Typography

- **Display** — `Space Grotesk` (500/700). Used for `h1`, `h2`, panel titles, the sidebar brand lockup, eyebrows. Geometric and slightly technical — distinct from the Inter-everywhere default without becoming decorative.
- **Body** — `IBM Plex Sans` (400/600). Used for paragraph text, table cells, form labels, descriptions. More character than Inter at small sizes, still highly legible in dense tables.
- **Mono/utility** — `IBM Plex Mono` (400/600). Used for job/run IDs, branch names, commands, log paths, diffs, status codes — anywhere the content is literally system output. Several places already reach for a monospace stack ad hoc (`.framework-build-detail-topbar p`, `.generated-diff-output`, `.detail-list dd` via `code`); this makes it one deliberate choice instead of three different fallback stacks.

All three are open-license (Google Fonts / OFL), loadable via `next/font/google` with no runtime fetch.

Type scale (replace the current "everything is 800/900 weight" approach):

| Token | Size/line | Weight | Use |
|---|---|---|---|
| `--text-display-l` | 28px/34px | 600 | `h1` |
| `--text-display-m` | 19px/25px | 600 | `h2`, panel titles |
| `--text-display-s` | 14px/20px | 600 | card labels, nav items |
| `--text-body` | 14px/21px | 400 | default copy |
| `--text-body-s` | 13px/19px | 400 | secondary/meta text |
| `--text-caption` | 11px/16px | 600, uppercase, tracked 0.04em | eyebrows, status labels — the one place uppercase+tracking stays, because it's a real structural signal ("this is a category label") used consistently |

### Color

Two independent palettes: **structural** (chrome, actions, surfaces) and **signal** (status meaning). Keeping them separate is what fixes problem #1 — blue stops being a status color.

Structural tokens:

```css
--ink: #12161f;        /* body text, dark surfaces (sidebar) */
--paper: #e9ecf2;       /* page background — cooler/deeper than current #eef2f7 */
--surface: #ffffff;     /* card backgrounds (unchanged — not the problem) */
--border: #d7dce6;      /* default card/table border */
--action: #2f4d8f;      /* links, nav active state, primary buttons — deliberately a deeper, less "default Tailwind blue-600" indigo than #2563eb */
```

Signal tokens — one 6-tone system replacing `status-pill`/`run-pill`/`positive-warning-danger`/`ok-warn-danger-muted`/`passed-installed-failed-skipped` everywhere:

```css
--signal-waiting:   #5b6472;  /* slate — queued, no action needed from anyone yet */
--signal-decision:  #b8791c;  /* brass/amber — a human must act now. Reserved exclusively for this. */
--signal-active:    #1c7c86;  /* teal — automated work in progress */
--signal-success:   #2f7d4f;  /* green — terminal success only */
--signal-attention: #b3402d;  /* brick red — failed/blocked, needs investigation */
--signal-inactive:  #9aa2b1;  /* gray — canceled/draft/not applicable */
```

The rule that makes this a system instead of six more arbitrary colors: **`--signal-decision` (amber) is the only tone ever used for "a human must click something."** It never means anything else. Once a reviewer learns "amber = my turn," that reading holds everywhere: sidebar, list, detail, approval cards. This directly replaces the current situation where amber/orange shows up for `.approval-card`, `.status-pill.review`, `.framework-pipeline-note`, and `.notice.error` with no shared meaning.

Why not the cream/serif or near-black/acid-accent defaults: this tool's job is triage under time pressure across a real state machine, not a landing page. The signature is the tone system itself, not a hero color — restraint here is the point.

### Spacing

No change. The existing 8px-multiple scale (8/10/12/14/16/18/20/24/28) is already disciplined and appropriate for a dense ops tool — see "Out of scope."

## Component specs

### 1. Status Beacon (new shared component — the signature element)

Current state: `.status-pill` and `.run-pill` (`styles.css:2485-2575`) are `border-radius: 999px` badges colored per-state with no shared logic; `LocalTestRunStatus` and the `framework-*` result states each invented their own separate tone class names.

Proposed: one shared "beacon" treatment — a filled dot + label in a squared tag (4px radius, not a full pill — visually distinct from a generic SaaS badge, reads more like a physical indicator light) — driven by a single tone, never a hardcoded color:

```html
<span class="beacon beacon--decision">
  <span class="beacon-dot" aria-hidden="true"></span>
  Ready for Codex
</span>
```

```css
.beacon {
  align-items: center;
  border-radius: 4px;
  display: inline-flex;
  font: 600 11px/1 "IBM Plex Mono", ui-monospace, monospace;
  gap: 6px;
  letter-spacing: 0.03em;
  padding: 5px 8px;
  text-transform: uppercase;
}
.beacon-dot { border-radius: 50%; display: block; height: 7px; width: 7px; }

.beacon--waiting   { background: color-mix(in srgb, var(--signal-waiting) 12%, white);   color: var(--signal-waiting); }
.beacon--waiting .beacon-dot   { background: var(--signal-waiting); }
.beacon--decision  { background: color-mix(in srgb, var(--signal-decision) 14%, white);  color: var(--signal-decision); }
.beacon--decision .beacon-dot  { background: var(--signal-decision); box-shadow: 0 0 0 3px color-mix(in srgb, var(--signal-decision) 25%, transparent); }
.beacon--active    { background: color-mix(in srgb, var(--signal-active) 12%, white);    color: var(--signal-active); }
.beacon--active .beacon-dot    { background: var(--signal-active); }
.beacon--success   { background: color-mix(in srgb, var(--signal-success) 12%, white);   color: var(--signal-success); }
.beacon--success .beacon-dot   { background: var(--signal-success); }
.beacon--attention { background: color-mix(in srgb, var(--signal-attention) 12%, white); color: var(--signal-attention); }
.beacon--attention .beacon-dot { background: var(--signal-attention); }
.beacon--inactive  { background: color-mix(in srgb, var(--signal-inactive) 12%, white);  color: var(--signal-inactive); opacity: 0.85; }
.beacon--inactive .beacon-dot  { background: var(--signal-inactive); }
```

Only `beacon--decision` gets the subtle glow ring — that's the visual cue that this one is different from the rest ("this one needs you").

**Tone mapping (concrete, per the real enums in `packages/db/prisma/schema.prisma`)** — this table is the artifact `coder` should turn directly into a lookup object, replacing the ad hoc CSS class-per-value approach:

| `JobStatus` | tone | | `RunStatus` | tone |
|---|---|---|---|---|
| `DRAFT` | inactive | | `STARTED` | active |
| `QUEUED` | waiting | | `CODEX_RUNNING` | active |
| `NEEDS_REVIEW` | **decision** | | `VALIDATING` | active |
| `CLAIMED` | active | | `PUSHING` | active |
| `RUNNING` | active | | `READY_FOR_CODEX` | **decision** |
| `VALIDATING` | active | | `PR_CREATED` | success |
| `READY_FOR_CODEX` | **decision** | | `SUCCEEDED` | success |
| `CODEX_APPROVED` | active | | `FAILED` | attention |
| `REVIEW` | **decision** | | | |
| `PR_APPROVED` | active | | `LocalTestRunStatus` | tone |
| `PR_CREATED` | active | | `QUEUED` | waiting |
| `COMPLETED` | success | | `RUNNING` | active |
| `FAILED` | attention | | `PASSED` | success |
| `BLOCKED` | attention | | `FAILED` | attention |
| `RETRY` | attention | | `CANCELED` | inactive |
| `CANCELED` | inactive | | | |

Note on `READY_FOR_CODEX` and `REVIEW`: both are `decision` in `JobStatus`, but `CODEX_APPROVED` and `PR_APPROVED` (the states right after approval, waiting on the runner) are `active`, not `decision` — approving something doesn't mean it needs you again until the runner hands it back. This is the exact distinction the current green/amber bucketing collapses.

### 2. Dashboard (`apps/web/app/page.tsx`)

Current: `.metric-grid` top-border colors (`styles.css:410-432`: blue/green/amber/red/purple/gray) don't match the `.status-pill` colors shown in the table one scroll down — a person has to relearn the palette between the summary cards and the list.

Proposed:
- Recolor the six metric card top-borders using the exact signal tokens: Queued→waiting, Running→active, Approval→decision, Failed→attention, Completed→success, Canceled→inactive. Same hex values as the beacons below them.
- Replace the table's Status column `.status-pill` + `.stage-note` stack with `<Beacon>` + the existing stage note text (kept, just tone-tinted to match).
- Add a left rule to table rows whose job is currently `decision` tone: `tr:has(.beacon--decision) { border-left: 3px solid var(--signal-decision); }` (or an explicit class if `:has()` support is a concern) — so a reviewer scanning the table can find "things waiting on me" without reading every row. This is the single highest-value change on this page for VISION's "fast trust decisions" goal.

### 3. Job detail (`apps/web/app/jobs/[id]/page.tsx`)

Current: ten equal-weight white panels in sequence; the actual "is this safe" signal is implied by combining `.status-pill` (header), `.validation-trust-card` tone, and PR lifecycle text buried in the `pipeline-card` — no single synthesized answer.

Proposed: add a **Trust Header** directly under the `h1`/goal text, before the execution-mode card:

```html
<section class="trust-header trust-header--decision">
  <span class="beacon beacon--decision">Ready for Codex</span>
  <strong>Waiting on your approval to spend model credits.</strong>
  <p>Validation hasn't run yet — nothing to verify until Codex produces a change.</p>
</section>
```

- Background/left-border tinted to the job's tone (same `color-mix` recipe as the beacon).
- Text is generated from the same `stageLabels`/`getApprovalAction` logic already in the page (`page.tsx:271-490`) — no new data needed, just a new rendering slot that synthesizes what's already computed instead of leaving it implicit in the header pill.
- `.stage-tracker` keeps its 1–6 numbering (this is one case where sequence numbering is legitimate — it's a real ordered pipeline) but the `.stage-card` state colors (`styles.css:4892-4927`, currently blue/green/red/gray ad hoc) switch to the signal tokens: complete→success, current→active, blocked→attention, skipped→inactive.
- Secondary/reference panels (`diagnostics-log-grid`, the `pipeline-grid` metadata `dl`s) get a slightly recessed treatment — `background: color-mix(in srgb, var(--ink) 3%, var(--surface))` instead of pure white — so they read as "look here if you need detail" rather than competing with the Trust Header and the diff for attention.
- `.generated-diff-output`/`.generated-diff-stat` (already dark, monospace-appropriate) stay as-is structurally; just move their font to `IBM Plex Mono` for consistency with the rest of the mono-utility usage.

### 4. Sidebar / global chrome (`apps/web/app/app-shell.tsx`, `.sidebar`)

Current: `.system-card` status list (`styles.css:158-209`) uses its own `positive`/`warning`/`danger` tone set, disconnected from `.status-pill`.

Proposed:
- `.sidebar` background moves from `#071426` to `--ink` (#12161f) — same near-black concept, just the token that the rest of the app also uses for text, so dark and light surfaces share one ink value instead of two independently-chosen near-blacks.
- Brand lockup (`FlawFerret 2` / `QA orchestration`) set in Space Grotesk so the app's identity is legible from the first paint, not generic Inter bold.
- `.system-status-list dd.positive/.warning/.danger` map onto `--signal-success`/`--signal-decision`/`--signal-attention` respectively (runner health "Idle/Busy" → success, "Stale" → decision — a stale runner needs someone to look — "Error/Offline" → attention).

## Out of scope

- **Layout/structure**: the two-column `app-shell` grid, `.panel` card pattern, table column-width rules, pagination, and the 8px spacing scale are not the problem and stay as-is.
- **Framework wizard, Discover, Local Test Runs, Readiness, Repositories, Settings, Integrations pages**: their information architecture is fine; once the shared tone tokens exist, updating their `framework-*` result classes (`passed`/`installed`/`failed`/`skipped`) to reference the same signal tokens is a small mechanical follow-up, not part of this pass.
- **Dark mode**: `:root { color-scheme: light }` is hardcoded today and there's no toggle anywhere in the app; not addressing it here (see Open Questions).
- **Brand mark** (`/flawferret2-brand-mark.png`, the circular avatar in the sidebar): left untouched.
- **Checks-aware `PR_CREATED` tone**: `page.tsx` already computes `prCheckCounts` (passed/pending/failed) for the pipeline panel — there's a real future case for `PR_CREATED` becoming `decision` once checks pass (merge is now the human's call), but that's a data-flow change (surfacing check state into the dashboard list), not a token/visual change, and is left for a follow-up spec.

## Open questions

1. **Font loading**: Space Grotesk / IBM Plex Sans / IBM Plex Mono are all OFL-licensed and available via `next/font/google`. Confirm there's no offline/air-gapped build constraint that would require self-hosting the font files instead.
2. **Dark mode**: worth scoping now, or defer until there's an actual toggle requested? Recommend defer — flagging so it's a deliberate choice, not an oversight.
3. **`PR_CREATED` job-status tone**: keep as `active` for this pass (per table above), or is "open PR, checks unknown" important enough to justify pulling check state into the dashboard list now rather than later?
4. Any objection to demoting `#2563eb` off of primary buttons/links in favor of the deeper `--action` indigo (`#2f4d8f`)? It's a visible change to every link and button in the app, not just status.

## Ready for coder?

Ready for `coder` to implement the token layer (structural + signal CSS custom properties, font loading, `Beacon` component/class, and the `JobStatus`/`RunStatus`/`LocalTestRunStatus`→tone lookup table) plus the Dashboard and Job Detail component changes described above — those two views are fully specified. The `framework-*`/other-page token migration and the two dark-mode/check-state questions above should get an explicit answer from the user before `coder` touches those areas, so scope `coder`'s first pass to the Dashboard + Job Detail + shared token/Beacon work only.
