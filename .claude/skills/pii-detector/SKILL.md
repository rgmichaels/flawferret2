---
name: pii-detector
description: Scans the currently-open web page (via the Browser tools) for exposed personally identifiable information — SSNs, street addresses, dates of birth, emails, phone numbers, credit card numbers, IP addresses, passport/driver's license numbers, and bank account/routing numbers — and reports what it finds with location and confidence. Use this proactively during QA/testing whenever you're about to take a screenshot for a bug report, file a ticket, share a page capture, or audit a staging/demo/production page for real user data leaking into a test environment — even if the user only says something like "check this page before I screenshot it" or "make sure this demo doesn't show real customer info," not just when they explicitly say "PII" or "personally identifiable information."
---

# PII Detector

## Why this exists

QA and testing workflows constantly generate artifacts that leave the app —
screenshots, bug reports, shared page captures, demo recordings. If the page
being captured happens to be showing a real SSN, a real credit card number,
or a real customer's address (a seeded test account that got real data, a
staging environment pointed at a production database copy, an unmasked form
field), that PII now lives in a Jira ticket, a Slack thread, or a screen
recording — somewhere much harder to delete than the original page. Catching
this *before* the capture happens is the whole point.

## When to run this

Run it whenever you're about to do something that will make a page's content
persist somewhere else: take a screenshot, attach a page capture to a bug
report, record a demo, or hand off a staging URL. Also run it as a general
audit when the user asks you to check a page, form, or flow for data
exposure — they may not say "PII" explicitly.

## Workflow

1. **Capture what's actually on the page — not just the visible text.**
   PII often sits inside form field *values* (a pre-filled SSN input, an
   autocompleted address) that plain visible-text extraction misses because
   input values aren't part of the rendered text content. So combine two
   sources:
   - `mcp__Claude_Browser__get_page_text` for the rendered text (fast, gets
     most of what a screenshot would show).
   - For pages with forms, also pull input values — `read_page` with
     `filter: "all"` includes field values in its accessibility tree, or use
     `javascript_tool` to run something like
     `[...document.querySelectorAll('input,textarea')].map(el => el.value).join('\n')`
     and append that to the text you scan. Skip this step for pages with no
     forms — no need to run it just to confirm there's nothing there.

   If you're scanning something other than a live browser page (a pasted
   capture, a saved HTML/text file), just use that text directly as the
   input in step 2.

2. **Run the detector script on the captured text:**
   ```bash
   python3 <skill-dir>/scripts/detect_pii.py --file /tmp/page_capture.txt
   ```
   or pipe text directly via stdin. It's stdlib-only Python 3, no
   installation needed. It returns JSON with a `findings` list and a
   `counts` summary. It already does the hard part — real validation, not
   just shape-matching — so trust its confidence levels rather than
   re-deriving your own:
   - **high** — matched the pattern *and* passed a real check (Luhn for
     card numbers, ABA checksum for routing numbers, SSA-plausible ranges
     for SSNs, a state+ZIP tail for addresses).
   - **medium** — matched a well-defined format with no independent
     validator to run against it (email, phone, IP, DOB).
   - **low** — keyword-proximity heuristic only (street addresses without a
     state+ZIP, passport/driver's-license numbers, bank account numbers) —
     formats for these vary too much across jurisdictions/institutions to
     validate structurally, so treat these as "worth a human look," not
     confirmed.

3. **Report findings as a table**, one row per finding:

   | Type | Confidence | Value | Line/Context |
   |---|---|---|---|
   | ssn | high | `***-**-1120` | `...SSN: 078-05-1120 Date of...` |

   Use the `matched_masked` field from the JSON as-is — it's already masked
   sensibly (SSNs and card numbers show only a trailing fragment; emails,
   phones, addresses, and DOBs are shown in full since withholding them
   makes the finding useless for actually fixing the page). Don't re-mask
   or further truncate what the script gives you, and don't paste the raw
   unmasked value into your report even if you can see it in the script's
   context snippet.

4. **If nothing is found, say so plainly** — "No PII detected on this page"
   is a complete and useful answer. Don't pad a clean scan with caveats or
   manufacture low-confidence findings to seem thorough.

5. **If findings exist and you're about to screenshot/capture anyway**
   (because the user asked you to proceed regardless, or the PII is
   incidental to what's being reported), call it out explicitly before
   doing so rather than silently including it — the user gets to decide
   whether to redact, crop, or use different test data first.

## Notes on the detector's judgment calls

- It only validates U.S.-format SSNs, ABA routing numbers, and standard
  card networks — for other countries' national ID or account number
  formats, everything falls back to keyword-proximity ("low" confidence),
  which still catches things but won't structurally validate them.
- It intentionally does *not* try to detect names on their own — a bare
  name has too many legitimate non-PII appearances (nav bars, headers,
  "logged in as") to be a useful signal without also finding an SSN,
  address, DOB, etc. nearby. If you need name-in-context detection, treat
  a name appearing right next to a high-confidence finding as part of that
  finding's context rather than something to flag separately.
- Order/tracking/reference numbers that happen to be 9 or 13-19 digits are
  common false-positive shapes for SSNs and card numbers respectively —
  the script's validators (SSA area-code rules, Luhn) reject the vast
  majority of these automatically, which is why "matches the shape" alone
  isn't treated as a finding.
