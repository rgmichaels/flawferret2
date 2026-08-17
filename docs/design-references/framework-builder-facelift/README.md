# Framework Builder facelift — reference package

Source: Rob's Claude Design project "Flawferret interface redesign"
(`https://claude.ai/design/p/4b4635e0-1ffa-49ff-a4ed-2a6d20d22b57`), pulled
via the `DesignSync` tool on 2026-08-17.

**Rob picked Turn 2a** ("Dark sidebar kept, content re-themed") as the
direction — see the `id="2a"` block in `Framework-Builder.dc.html`. The
other three variants (1a, 1b, 2b) are still in the file for context on
what was considered and rejected, but 2a is the one to design from.

## What's in this package

- `Framework-Builder.dc.html` — the four-variant exploration doc, as
  authored. Uses Broadsheet's classes (`.btn`, `.input`, `.seg`, `.tag`,
  `.card`, etc.) and CSS custom properties (`--color-*`, `--font-*`,
  `--space-*`).
- `broadsheet-styles.css` — Broadsheet's tokens and component CSS, **with
  the CMYK-separation/halftone/press-registration rules stripped out**
  (`.halftone`, `.cmyk`, `.cmyk-num`, `.cmyk-head` and their supporting
  filters/animation driver). Those exist in the source system for a
  photo/editorial print treatment and aren't used anywhere in Turn 2a's
  markup — they were an elaborate, decorative flourish (misregistered
  ink-plate hover effects) that has no reason to exist in flawferret2. If
  you ever do want to see the stripped rules, they're in the original
  `broadsheet/styles.css` fetched via `DesignSync get_file` — ask the
  orchestrator rather than reinventing them.
- **Not included**: `support.js` (Claude Design's own runtime —
  `"GENERATED from dc-runtime/src/*.ts — do not edit"`, not application
  code) and `broadsheet/print-plates.js` (the JS driver for the stripped
  CMYK effect above — same reasoning, irrelevant to Turn 2a).
- `assets/flawferret2-brand-mark.png` referenced by the mockup but not
  fetched into this package — it's just the existing grayscale-filtered
  logo mark, not a design decision.

## Additional requirement: make this modular, not a one-off reskin

Rob wants the app's styling architecture set up so a future look can be
"snapped in" — i.e. this shouldn't be Turn 2a's hex values hardcoded
into components. **This already has a real foundation to build on**:
`apps/web/app/styles.css`'s `:root` block (from the FLW-5 status-signal-
system work) already defines structural tokens (`--ink`, `--paper`,
`--surface`, `--border`, `--action`), the six-tone status system, and a
type scale as CSS custom properties — the same pattern Broadsheet and
Modernist use in Claude Design.

Two things worth checking as part of this spec:
1. Whether adopting Turn 2a's direction is best done as updates to the
   existing token names/values (keeping the token *names* stable so
   nothing downstream breaks, changing what they resolve to), rather than
   introducing a parallel set.
2. Whether the remaining ~6,500 lines of `styles.css` actually consume
   those tokens consistently, or whether a lot of component CSS
   hardcodes hex values that would silently not update if the tokens
   changed — that gap is what would actually block "snap in a new look"
   from being true. If it's a large audit, it's fine to scope that as
   its own follow-up spec/ticket rather than bundling it into this one.
