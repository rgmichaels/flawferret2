import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRecommendations } from "./local-recommendations.js";

describe("local discover recommendations", () => {
  it("prioritizes search-bar recommendations when tester notes request them", () => {
    const recommendations = buildRecommendations({
      notes: "Focus on the search bar",
      pageUrl: "https://www.yahoo.com/",
    });

    const titles = recommendations.map((recommendation) => recommendation.title);
    const scenarios = recommendations.flatMap((recommendation) => recommendation.scenario);
    const tags = new Set(recommendations.flatMap((recommendation) => recommendation.tags));

    assert.match(titles.slice(0, 7).join("\n"), /search bar submits a query/);
    assert.match(scenarios.join("\n"), /search query/);
    assert.ok(tags.has("@search-bar"));
  });

  it("keeps generic search intent broader when the notes do not target the search bar", () => {
    const recommendations = buildRecommendations({
      notes: "Focus on search results filtering",
      pageUrl: "https://example.com/catalog",
    });

    assert.ok(recommendations.some((recommendation) => recommendation.title.includes("filtering narrows results")));
    assert.equal(recommendations.some((recommendation) => recommendation.tags.includes("@search-bar")), false);
  });
});
