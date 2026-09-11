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

  it("puts capture context notes above the generated acceptance criteria", () => {
    const notes = [
      "Scenario: Sign in with valid credentials",
      "  Given I am on the login page",
      "  Then I should see the dashboard",
    ].join("\n");
    const captureContext = parseCaptureContextValue(
      JSON.stringify({
        url: "https://example.test/login",
        title: "Login",
        elementKey: "button_sign_in",
        name: "Sign in",
        outerHTML: "<button>Sign in</button>",
        selectors: ["getByRole('button', { name: 'Sign in' })"],
        thenLine: 'Then the "button_sign_in" should be visible',
        notes,
      })
    );

    assert.ok(captureContext);
    assert.equal(
      getDefaultAcceptanceCriteria(captureContext),
      [
        notes,
        "",
        'Then the "button_sign_in" should be visible',
        "Navigate to https://example.test/login.",
        "Prefer locator getByRole('button', { name: 'Sign in' }).",
        "Use the captured DOM snippet to keep the assertion focused.",
      ].join("\n")
    );
  });

  it("returns only the notes when no other capture context details are present", () => {
    const captureContext = parseCaptureContextValue(
      JSON.stringify({
        notes: "Scenario: the user can sign out",
      })
    );

    assert.ok(captureContext);
    assert.equal(
      getDefaultAcceptanceCriteria(captureContext),
      "Scenario: the user can sign out"
    );
  });

  it("leaves acceptance criteria unchanged when notes are missing or empty", () => {
    const base = {
      url: "https://example.test/login",
      title: "Login",
      elementKey: "button_sign_in",
      name: "Sign in",
      outerHTML: "<button>Sign in</button>",
      selectors: ["getByRole('button', { name: 'Sign in' })"],
      thenLine: 'Then the "button_sign_in" should be visible',
    };
    const expected = [
      'Then the "button_sign_in" should be visible',
      "Navigate to https://example.test/login.",
      "Prefer locator getByRole('button', { name: 'Sign in' }).",
      "Use the captured DOM snippet to keep the assertion focused.",
    ].join("\n");

    const withoutNotes = parseCaptureContextValue(JSON.stringify(base));
    const withEmptyNotes = parseCaptureContextValue(JSON.stringify({ ...base, notes: "   " }));

    assert.ok(withoutNotes);
    assert.ok(withEmptyNotes);
    assert.equal(getDefaultAcceptanceCriteria(withoutNotes), expected);
    assert.equal(getDefaultAcceptanceCriteria(withEmptyNotes), expected);
  });

  it("returns an empty string without capture context", () => {
    assert.equal(getDefaultAcceptanceCriteria(null), "");
  });
});
