#!/usr/bin/env python3
"""
detect_pii.py — scan text for likely personally identifiable information.

Usage:
    python3 detect_pii.py < page_text.txt
    python3 detect_pii.py --file page_text.txt
    echo "some text" | python3 detect_pii.py

Reads text from stdin (or --file), finds candidate PII, applies real
validation where one exists (Luhn for card numbers, ABA checksum for
routing numbers, plausible ranges for SSNs/dates), and prints a JSON
report to stdout:

{
  "findings": [
    {
      "type": "ssn",
      "confidence": "high",
      "matched_masked": "***-**-6789",
      "context": "...patient SSN: 123-45-6789 on file...",
      "line": 14
    },
    ...
  ],
  "counts": {"ssn": 1, "email": 3, ...}
}

No external dependencies — stdlib only, so it runs anywhere Python 3 does.
"""

import argparse
import json
import re
import sys
from datetime import datetime

# ---------------------------------------------------------------------------
# Validators — these are what separate "matches the shape of an SSN" from
# "is actually plausible as an SSN". Cutting false positives here matters:
# a tool that cries wolf on every 9-digit tracking number stops getting used.
# ---------------------------------------------------------------------------


def luhn_check(digits: str) -> bool:
    """Standard Luhn checksum, used by all major card networks."""
    total = 0
    reverse_digits = digits[::-1]
    for i, ch in enumerate(reverse_digits):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def aba_checksum(routing: str) -> bool:
    """ABA routing number checksum (weights 3,7,1 repeating)."""
    if len(routing) != 9 or not routing.isdigit():
        return False
    weights = [3, 7, 1, 3, 7, 1, 3, 7, 1]
    total = sum(int(d) * w for d, w in zip(routing, weights))
    return total % 10 == 0


def plausible_ssn(ssn_digits: str) -> bool:
    """Reject SSNs that are structurally impossible, per SSA rules."""
    area, group, serial = ssn_digits[:3], ssn_digits[3:5], ssn_digits[5:]
    if area in ("000", "666") or area.startswith("9"):
        return False
    if group == "00" or serial == "0000":
        return False
    return True


def plausible_dob_year(year: int) -> bool:
    current_year = datetime.now().year
    return (current_year - 120) <= year <= current_year


# ---------------------------------------------------------------------------
# Detectors — each returns a list of (start, end, matched_text, confidence)
# tuples. Confidence:
#   high   - shape matched AND passed a real validation check
#   medium - shape matched, format-only (no independent validator exists)
#   low    - keyword-proximity heuristic (formats vary too much to validate,
#            e.g. street addresses, passport/DL numbers, bank account #s)
# ---------------------------------------------------------------------------

SSN_RE = re.compile(r"\b(\d{3})[-\s]?(\d{2})[-\s]?(\d{4})\b")
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
PHONE_RE = re.compile(
    r"(?<!\d)(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)"
)
IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
CARD_RE = re.compile(r"\b(?:\d[ -]?){13,19}\b")
ROUTING_RE = re.compile(r"\b\d{9}\b")
DOB_KEYWORD_RE = re.compile(
    r"(date of birth|d\.?o\.?b\.?|birth ?date|born on|birthday)\s*[:\-]?\s*"
    r"([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})",
    re.IGNORECASE,
)
STREET_TYPES = (
    r"street|st\.?|avenue|ave\.?|boulevard|blvd\.?|road|rd\.?|lane|ln\.?|"
    r"drive|dr\.?|court|ct\.?|way|place|pl\.?|circle|cir\.?|terrace|trail|"
    r"parkway|pkwy\.?|highway|hwy\.?"
)
ADDRESS_RE = re.compile(
    rf"\b\d{{1,6}}\s+([A-Za-z0-9.'\s]{{2,30}})\s+(?:{STREET_TYPES})\b"
    rf"(?:\s*,?\s*(?:Apt|Suite|Ste|Unit|#)\.?\s*[\w-]+)?"
    rf"(?:\s*,\s*[A-Za-z\s]{{2,25}}\s*,?\s*[A-Z]{{2}}\s+\d{{5}}(?:-\d{{4}})?)?",
    re.IGNORECASE,
)
GOV_ID_KEYWORD_RE = re.compile(
    r"(passport\s*(?:no\.?|number|#)?|driver'?s?\s*licen[cs]e\s*(?:no\.?|number|#)?|"
    r"\bdl\s*#)\s*[:\-]?\s*([A-Z0-9]{5,12})",
    re.IGNORECASE,
)
BANK_ACCOUNT_KEYWORD_RE = re.compile(
    r"(account\s*(?:no\.?|number|#)|acct\.?\s*(?:no\.?|#))\s*[:\-]?\s*(\d{4,17})",
    re.IGNORECASE,
)


def find_ssns(text):
    out = []
    for m in SSN_RE.finditer(text):
        digits = "".join(m.groups())
        if plausible_ssn(digits):
            out.append((m.start(), m.end(), m.group(0), "ssn", "high"))
    return out


def find_emails(text):
    return [
        (m.start(), m.end(), m.group(0), "email", "medium")
        for m in EMAIL_RE.finditer(text)
    ]


def find_phones(text):
    return [
        (m.start(), m.end(), m.group(0), "phone", "medium")
        for m in PHONE_RE.finditer(text)
    ]


def find_ips(text):
    out = []
    for m in IPV4_RE.finditer(text):
        octets = m.group(0).split(".")
        if all(0 <= int(o) <= 255 for o in octets):
            out.append((m.start(), m.end(), m.group(0), "ip_address", "medium"))
    return out


def find_cards(text):
    out = []
    for m in CARD_RE.finditer(text):
        digits = re.sub(r"[ -]", "", m.group(0))
        if 13 <= len(digits) <= 19 and luhn_check(digits):
            out.append((m.start(), m.end(), m.group(0), "credit_card", "high"))
    return out


def find_routing_numbers(text):
    out = []
    for m in ROUTING_RE.finditer(text):
        if aba_checksum(m.group(0)):
            # Cheap disambiguation: a bare valid-checksum 9-digit number is
            # ambiguous with an SSN. Only call it a routing number if
            # "routing" appears nearby, otherwise let the SSN/other
            # detectors handle it and skip here to avoid double-counting.
            window = text[max(0, m.start() - 40) : m.start()]
            if re.search(r"routing", window, re.IGNORECASE):
                out.append((m.start(), m.end(), m.group(0), "bank_routing", "high"))
    return out


def find_dobs(text):
    out = []
    for m in DOB_KEYWORD_RE.finditer(text):
        out.append((m.start(), m.end(), m.group(0), "date_of_birth", "medium"))
    return out


def find_addresses(text):
    out = []
    for m in ADDRESS_RE.finditer(text):
        # Confidence bump: if it also has a state+zip tail, that's a much
        # stronger signal than a bare "123 Main St".
        confidence = "high" if re.search(r"[A-Z]{2}\s+\d{5}", m.group(0)) else "low"
        out.append((m.start(), m.end(), m.group(0), "street_address", confidence))
    return out


def find_gov_ids(text):
    out = []
    for m in GOV_ID_KEYWORD_RE.finditer(text):
        # Mask just the ID itself (group 2), not the whole "Passport No: X1234567"
        # phrase — the keyword stays visible in the context snippet anyway.
        out.append((m.start(), m.end(), m.group(2), "government_id", "low"))
    return out


def find_bank_accounts(text):
    out = []
    for m in BANK_ACCOUNT_KEYWORD_RE.finditer(text):
        out.append((m.start(), m.end(), m.group(2), "bank_account", "low"))
    return out


DETECTORS = [
    find_ssns,
    find_emails,
    find_phones,
    find_ips,
    find_cards,
    find_routing_numbers,
    find_dobs,
    find_addresses,
    find_gov_ids,
    find_bank_accounts,
]


def mask(value: str, kind: str) -> str:
    """Show enough to confirm the finding is real without echoing the
    full value into a report that might get pasted into a ticket, Slack,
    or a screenshot."""
    digits_only = re.sub(r"\D", "", value)
    if kind == "ssn" and len(digits_only) == 9:
        return f"***-**-{digits_only[-4:]}"
    if kind == "credit_card":
        return f"{'*' * (len(digits_only) - 4)}{digits_only[-4:]}"
    if kind in ("bank_routing", "bank_account", "government_id"):
        tail = digits_only[-4:] if digits_only else value[-4:]
        return f"{'*' * max(0, len(value) - 4)}{tail}"
    # Email, phone, IP, address, DOB: showing the full value is what makes
    # the finding actionable (you need it to go verify/fix the page), and
    # these are lower-sensitivity than the ones masked above.
    return value


def build_context(text: str, start: int, end: int, radius: int = 40) -> str:
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    snippet = text[left:right].replace("\n", " ")
    prefix = "..." if left > 0 else ""
    suffix = "..." if right < len(text) else ""
    return f"{prefix}{snippet}{suffix}"


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def scan(text: str) -> dict:
    all_matches = []
    for detector in DETECTORS:
        all_matches.extend(detector(text))

    # Sort by position, then drop matches whose span is fully contained in
    # an earlier, already-kept match (e.g. an SSN found inside a longer
    # DOB keyword match) to avoid redundant noise in the report.
    all_matches.sort(key=lambda m: (m[0], -(m[1] - m[0])))
    kept = []
    for start, end, value, kind, confidence in all_matches:
        if any(k_start <= start and end <= k_end for k_start, k_end, *_ in kept):
            continue
        kept.append((start, end, value, kind, confidence))

    findings = []
    counts = {}
    for start, end, value, kind, confidence in kept:
        findings.append(
            {
                "type": kind,
                "confidence": confidence,
                "matched_masked": mask(value, kind),
                "context": build_context(text, start, end),
                "line": line_number(text, start),
            }
        )
        counts[kind] = counts.get(kind, 0) + 1

    return {"findings": findings, "counts": counts}


def main():
    parser = argparse.ArgumentParser(description="Scan text for likely PII.")
    parser.add_argument(
        "--file", help="Path to a text file to scan (default: read stdin)"
    )
    args = parser.parse_args()

    if args.file:
        with open(args.file, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
    else:
        text = sys.stdin.read()

    result = scan(text)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
