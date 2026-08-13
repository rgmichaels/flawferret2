# PII Scan Report — http://localhost:8743/dashboard-clean.html

**Scanned:** 2026-08-13
**Method:** Rendered page text captured via browser (no forms/inputs present on this page, so no field-value scan was needed) and run through detect_pii.py.

## Page content scanned

Team Dashboard

Welcome back! You have 3 open PRs and 2 pending reviews.

PR #94 - Wire console capture
PR #95 - Status signal system
PR #96 - Repository base URL

Server region: us-east-1

Build: v2.4.1 (commit a1b2c3d)

## Findings

No PII detected on this page.

| Type | Confidence | Value | Line/Context |
|---|---|---|---|
| — | — | — | — |

The page content is limited to PR titles/numbers, a build version string, a commit hash, and a server region identifier — none of which are personal or customer data. No SSNs, addresses, dates of birth, emails, phone numbers, credit card numbers, IP addresses, passport/driver's license numbers, or bank account/routing numbers were found.

## Conclusion

Safe to record a demo video of this page as-is — no exposed customer data detected.
