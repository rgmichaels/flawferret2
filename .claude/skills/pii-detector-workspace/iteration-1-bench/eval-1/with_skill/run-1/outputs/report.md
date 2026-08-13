# PII Scan Report — http://localhost:8743/patient-profile.html

Scanned via `pii-detector` skill: page has no forms, so visible rendered text
was captured with `get_page_text` (cross-checked against the full accessibility
tree) and run through `detect_pii.py`.

**Result: PII detected. Do not attach a screenshot of this page to the Jira
ticket without redacting first.**

| Type | Confidence | Value | Line/Context |
|---|---|---|---|
| ssn | high | `***-**-1120` | `...Phone: (415) 555-0132  SSN on file: 078-05-1120  Date of Birth: March 3, 1985...` |
| street_address | high | `742 Evergreen Terrace, Springfield, IL 62704` | `...Home Address: 742 Evergreen Terrace, Springfield, IL 62704  Card on file...` |
| credit_card | high | `************1111` | `...Springfield, IL 62704  Card on file: 4111 1111 1111 1111  Order reference...` |
| email | medium | `jane.doe@example.com` | `...Name: Jane Doe  Email: jane.doe@example.com  Phone: (415) 555-0132...` |
| phone | medium | `(415) 555-0132` | `...Email: jane.doe@example.com  Phone: (415) 555-0132  SSN on file: 078-05-1120...` |
| date_of_birth | medium | `Date of Birth: March 3, 1985` | `...SSN on file: 078-05-1120  Date of Birth: March 3, 1985  Home Address...` |

Not flagged: "Order reference: 1234567890123" and "Session ID: a1b2c3d4e5f6" —
these don't match validated PII patterns (order ref fails the credit-card
Luhn/length check; session ID is an opaque token, not an identifier format).

## Recommendation

This demo page renders a full synthetic-but-realistic patient record (name,
email, phone, SSN, DOB, home address, and a card number) directly in the
page body — three of the findings (SSN, address, card number) passed
independent structural validation (SSA range check, state+ZIP match, and
Luhn check respectively), so these are highly likely to actually be the
value they look like, not just shape matches.

Before screenshotting for the Jira ticket:
- Crop the screenshot to just the rendering-bug area if the PII is outside it, or
- Redact/blur the Name, Email, Phone, SSN, DOB, Home Address, and Card fields, or
- Swap the demo/seed data for obviously-fake placeholders (e.g. `000-00-0000`,
  `4242 4242 4242 4242`) before recapturing.

If this data is meant to be fully synthetic test fixture data (not real PII),
it's still worth flagging to the team — data shaped exactly like real PII in
a demo environment creates the same handling risk once it leaves the app via
screenshots, tickets, or recordings.
