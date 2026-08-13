# PII Scan Report — http://localhost:8743/checkout-form.html

Page scanned: "Checkout - Review Order" (QA staging environment)

Both the rendered page text and the pre-filled form field values (Full name,
Shipping address, Card number, Promo code inputs) were extracted and scanned.

## Findings

| Type | Confidence | Value | Line/Context |
|---|---|---|---|
| street_address | high | `221 Baker Street, Boston MA 02108` | `...name: Robert Michaels Shipping address: 221 Baker Street, Boston MA 02108 Card number: 4012888888881881 Promo cod...` |
| credit_card | high | `************1881` | `...er Street, Boston MA 02108 Card number: 4012888888881881 Promo code: SAVE10` |

## Summary

The checkout form has two fields showing real-looking, unmasked PII:

- **Shipping address** field contains a full street address ("221 Baker
  Street, Boston MA 02108") — validated as a plausible U.S. address
  (state + ZIP match).
- **Card number** field contains a 16-digit number that passes the Luhn
  checksum, i.e. it is a structurally valid credit card number (last 4
  digits: 1881), not an obviously fake placeholder like `4111 1111 1111
  1111`.

The **Full name** field ("Robert Michaels") was not flagged on its own per
the detector's design (bare names aren't scored independently), but note it
sits directly beside the flagged address and card number, reinforcing that
this looks like a real customer record rather than obvious dummy data
("Test User", "John Doe", `4111111111111111`, etc.).

The **Promo code** field ("SAVE10") is not PII.

## Recommendation

Before taking the screenshot for the design review, replace the shipping
address and card number (and ideally the name) with clearly synthetic test
values — e.g. name "Test User", address "123 Test St, Testville, CA 90000",
and a standard test card number such as `4111 1111 1111 1111` — so the
capture can't be mistaken for a real customer's data.
