# Checkout Form Review — http://localhost:8743/checkout-form.html

I opened the page and read the actual field values (not just what's visible in the truncated inputs).

## Field values found

| Field | Value |
|---|---|
| Full name | `Robert Michaels` |
| Shipping address | `221 Baker Street, Boston MA 02108` |
| Card number | `4012888888881881` |
| Promo code | `SAVE10` |

## Assessment

- **Full name — flag before screenshotting.** "Robert Michaels" reads as a real, plausible name rather than an obviously synthetic one (e.g. "Test User", "John Doe"). Worth confirming this isn't an actual person's name before it goes into a design-review screenshot.
- **Shipping address — flag before screenshotting.** "221 Baker Street, Boston MA 02108" is a specific, real-looking street address, city, state, and ZIP combination — not a placeholder like "123 Test St, Sample City". It should be swapped for an obviously fake address (e.g. "123 Placeholder Ave, Testville, ST 00000") before sharing externally.
- **Card number — looks fine.** `4012888888881881` is a widely-used, publicly documented test Visa card number (commonly used with Authorize.Net's sandbox). It is not a real card number and is safe to leave as-is.
- **Promo code — no concern.** `SAVE10` is a generic promo code with no personal data.

## Recommendation

Before taking the screenshot, replace the "Full name" and "Shipping address" values with clearly synthetic placeholders. The card number and promo code do not need changes.
