import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscoverExistingCoverage, DiscoverTestRecommendation } from "@flawferret2/job-schemas";
import { classifyRecommendationsByCoverage, summarizeRelatedCoverage } from "./coverage-matching.js";

const existingLoginCoverage: DiscoverExistingCoverage = {
  feature: "Login",
  path: "features/login.feature",
  scenario: "Invalid login is rejected",
  steps: [
    "Given I am on the login page",
    "When I submit invalid credentials",
    "Then I should see an authentication error",
  ],
  tags: ["@auth", "@negative"],
};

const recommendation = (overrides: Partial<DiscoverTestRecommendation>): DiscoverTestRecommendation => ({
  acceptance: ["Assert visible behavior."],
  impact: "High",
  reason: "This protects an important user path.",
  scenario: ["Given I am on the page", "Then visible behavior should be correct"],
  tags: ["@smoke"],
  title: "New behavior is covered",
  ...overrides,
});

describe("discover coverage matching", () => {
  it("hides recommendations with the same scenario name", () => {
    const [decision] = classifyRecommendationsByCoverage({
      existingCoverage: [existingLoginCoverage],
      recommendations: [
        recommendation({
          title: "Invalid login is rejected",
        }),
      ],
    });

    assert.equal(decision.status, "hide");
    assert.equal(decision.score, 1);
    assert.equal(decision.matchedCoverage?.scenario, "Invalid login is rejected");
    assert.match(decision.reason, /Same scenario name/);
  });

  it("hides recommendations that substantially overlap existing steps", () => {
    const [decision] = classifyRecommendationsByCoverage({
      existingCoverage: [existingLoginCoverage],
      recommendations: [
        recommendation({
          reason: "Authentication failure is a critical negative path.",
          scenario: [
            "Given I am on the login page",
            "When I submit invalid credentials",
            "Then I should see an authentication error",
          ],
          tags: ["@auth", "@negative"],
          title: "Login rejects invalid credentials",
        }),
      ],
    });

    assert.equal(decision.status, "hide");
    assert.equal(decision.matchedCoverage?.path, "features/login.feature");
    assert.ok(decision.score >= 0.78);
  });

  it("keeps recommendations that are only loosely related", () => {
    const [decision] = classifyRecommendationsByCoverage({
      existingCoverage: [existingLoginCoverage],
      recommendations: [
        recommendation({
          reason: "Keyboard access catches accessibility regressions.",
          scenario: [
            "Given I am on the login page",
            "When I navigate controls with the keyboard",
            "Then every primary control should be reachable and named",
          ],
          tags: ["@accessibility", "@keyboard"],
          title: "Login primary controls are keyboard reachable",
        }),
      ],
    });

    assert.equal(decision.status, "keep");
    assert.equal(decision.matchedCoverage?.scenario, "Invalid login is rejected");
    assert.match(decision.reason, /Closest existing scenario/);
  });

  it("summarizes related feature catalog scenarios for a page", () => {
    const coverage = summarizeRelatedCoverage({
      catalog: {
        features: [
          {
            description: "",
            feature: "Login",
            modifiedAt: new Date().toISOString(),
            path: "features/login.feature",
            scenarioCount: 1,
            scenarios: [
              {
                keyword: "Scenario",
                line: 4,
                name: "Login page loads",
                steps: [
                  {
                    keyword: "Given",
                    line: 5,
                    matchedDefinition: null,
                    text: "I am on the login page",
                  },
                ],
                tags: ["@smoke"],
                unmatchedStepCount: 0,
              },
            ],
            tags: ["@auth"],
          },
        ],
        localPath: "/tmp/repo",
        repository: {
          cloneUrl: "https://github.com/rgmichaels/example.git",
          createdAt: new Date().toISOString(),
          defaultBranch: "main",
          id: "repo-1",
          localPath: "/tmp/repo",
          name: "example",
          owner: "rgmichaels",
          provider: "GITHUB",
          trackerIntegration: null,
          trackerIntegrationId: null,
          updatedAt: new Date().toISOString(),
          validationCommand: "pnpm test",
          webUrl: "https://github.com/rgmichaels/example",
        },
        root: "features",
        totalScenarios: 1,
      },
      notes: "auth smoke",
      pageLabel: "login",
      pageUrl: "https://example.com/login",
    });

    assert.equal(coverage.length, 1);
    assert.equal(coverage[0].scenario, "Login page loads");
    assert.deepEqual(coverage[0].tags, ["@auth", "@smoke"]);
  });
});
