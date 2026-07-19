import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getDefaultAcceptanceCriteria,
  getDefaultFeatureArea,
  getDefaultGoal,
  parseCaptureContextValue,
} from "./page.js";

describe("new job capture context", () => {
  it("parses encoded extension capture context", () => {
    const captureContext = parseCaptureContextValue(
      JSON.stringify({
        url: "https://example.test/login",
        title: "Login",
        elementKey: "button_sign_in",
        role: "button",
        name: "Sign in",
        outerHTML: "<button>Sign in</button>",
        selectors: ["getByRole('button', { name: 'Sign in' })"],
        locatorCandidates: [
          {
            strategy: "byRole",
            value: "getByRole('button', { name: 'Sign in' })",
          },
        ],
        thenLine: 'Then the "button_sign_in" should be visible',
      })
    );

    assert.equal(captureContext?.url, "https://example.test/login");
    assert.equal(captureContext?.name, "Sign in");
    assert.equal(captureContext?.locatorCandidates[0]?.strategy, "byRole");
  });

  it("ignores invalid capture context", () => {
    assert.equal(parseCaptureContextValue("{not-json"), null);
    assert.equal(parseCaptureContextValue(JSON.stringify({ url: "not a url" })), null);
  });

  it("builds useful defaults from capture context", () => {
    const captureContext = parseCaptureContextValue(
      JSON.stringify({
        url: "https://example.test/login",
        title: "Login",
        elementKey: "button_sign_in",
        name: "Sign in",
        selectors: ["getByRole('button', { name: 'Sign in' })"],
        thenLine: 'Then the "button_sign_in" should be visible',
      })
    );

    assert.ok(captureContext);
    assert.equal(getDefaultFeatureArea(captureContext), "Sign in on Login");
    assert.equal(
      getDefaultGoal(captureContext),
      "Add Playwright coverage for Sign in on https://example.test/login."
    );
    assert.match(
      getDefaultAcceptanceCriteria(captureContext),
      /Prefer locator getByRole\('button', \{ name: 'Sign in' \}\)\./
    );
  });
});
