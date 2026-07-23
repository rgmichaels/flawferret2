import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDiscoverAcceptanceCriteria } from "./review-request.js";

describe("review request helpers", () => {
  it("parses Discover-generated acceptance criteria into display sections", () => {
    const summary = parseDiscoverAcceptanceCriteria([
      "Source: Page discovery recommendation",
      "Page URL: https://example.com/login",
      "Impact: High",
      "Tags: @auth @negative",
      "Discovery notes: Focus invalid credentials.",
      "",
      "Suggested scenario:",
      "Given I am on the login page",
      "When I submit invalid credentials",
      "Then I should see an authentication error",
      "",
      "Why this matters:",
      "Authentication failures are critical regression paths.",
      "",
      "Implementation guidance:",
      "- Reuse existing page objects.",
      "- Keep the scenario focused on one behavior.",
    ].join("\n"));

    assert.ok(summary);
    assert.equal(summary.pageUrl, "https://example.com/login");
    assert.equal(summary.impact, "High");
    assert.deepEqual(summary.tags, ["@auth", "@negative"]);
    assert.equal(summary.notes, "Focus invalid credentials.");
    assert.deepEqual(summary.scenario, [
      "Given I am on the login page",
      "When I submit invalid credentials",
      "Then I should see an authentication error",
    ]);
    assert.deepEqual(summary.guidance, ["Reuse existing page objects.", "Keep the scenario focused on one behavior."]);
  });

  it("ignores non-Discover acceptance criteria", () => {
    assert.equal(parseDiscoverAcceptanceCriteria("Add coverage for login.\nAssert the error message."), null);
  });
});
