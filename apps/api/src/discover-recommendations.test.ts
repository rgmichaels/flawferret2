import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildDiscoverRecommendations,
  buildDiscoverRecommendationsPrompt,
  parseDiscoverRecommendations,
} from "./discover-recommendations.js";

const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalOpenAiModel = process.env.OPENAI_MODEL;
const originalDiscoverModel = process.env.OPENAI_DISCOVER_TESTS_MODEL;

describe("discover recommendations", () => {
  afterEach(() => {
    process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    process.env.OPENAI_MODEL = originalOpenAiModel;
    process.env.OPENAI_DISCOVER_TESTS_MODEL = originalDiscoverModel;
  });

  it("parses model recommendations from JSON text", () => {
    const recommendations = parseDiscoverRecommendations(
      JSON.stringify({
        recommendations: [
          {
            acceptance: ["Assert the error remains visible."],
            impact: "High",
            reason: "Invalid submission is a critical negative path.",
            scenario: ["Given I am on the form page", "When I submit invalid values", "Then I should see an error"],
            tags: ["form", "@negative"],
            title: "Form rejects invalid values",
          },
        ],
      }),
      10,
    );

    assert.equal(recommendations.length, 1);
    assert.deepEqual(recommendations[0].tags, ["@form", "@negative"]);
  });

  it("uses the configured prompt preface", () => {
    const prompt = buildDiscoverRecommendationsPrompt({
      existingCoverage: [],
      maxRecommendations: 12,
      notes: "",
      pageContext: "Sign in form with email and password fields.",
      pageUrl: "https://example.com/login",
    });

    assert.match(prompt, /principal Software Development Engineer in Test/);
    assert.match(prompt, /Engineering Principles/);
    assert.match(prompt, /Return JSON only/);
  });

  it("includes existing Cucumber coverage in the recommendation prompt", () => {
    const prompt = buildDiscoverRecommendationsPrompt({
      existingCoverage: [
        {
          feature: "Login",
          path: "features/login.feature",
          scenario: "Invalid login is rejected",
          steps: [
            "Given I am on the login page",
            "When I submit invalid credentials",
            "Then I should see an authentication error",
          ],
          tags: ["@auth", "@negative"],
        },
      ],
      maxRecommendations: 8,
      notes: "Avoid duplicate auth coverage.",
      pageContext: "Login form",
      pageUrl: "https://example.com/login",
    });

    assert.match(prompt, /Do not recommend tests that are already covered/);
    assert.match(prompt, /Related existing Cucumber coverage/);
    assert.match(prompt, /Invalid login is rejected/);
    assert.match(prompt, /features\/login\.feature/);
  });

  it("returns local fallback when OpenAI is not configured", async () => {
    delete process.env.OPENAI_API_KEY;

    const response = await buildDiscoverRecommendations({
      input: {
        existingCoverage: [],
        maxRecommendations: 10,
        notes: "",
        pageUrl: "https://example.com/login",
      },
    });

    assert.equal(response.provider, "local");
    assert.equal(response.recommendations.length, 0);
  });

  it("builds OpenAI recommendations from page context", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    const fetchCalls: string[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      fetchCalls.push(requestUrl);

      if (requestUrl === "https://example.com/login") {
        return new Response("<html><body><h1>Login</h1><button>Sign in</button></body></html>", {
          headers: {
            "content-type": "text/html",
          },
        });
      }

      assert.equal(requestUrl, "https://api.openai.com/v1/responses");
      assert.match(String(init?.body), /Login/);

      return Response.json({
        output_text: JSON.stringify({
          recommendations: [
            {
              acceptance: ["Submit invalid credentials and assert the error message is visible."],
              impact: "High",
              reason: "Login failure is a high-risk path.",
              scenario: ["Given I am on the login page", "When I submit invalid credentials", "Then I should see an error"],
              tags: ["@auth", "@negative"],
              title: "Invalid login shows an error",
            },
          ],
        }),
      });
    };

    const response = await buildDiscoverRecommendations({
      fetchImpl: fetchImpl as typeof fetch,
      input: {
        existingCoverage: [
          {
            feature: "Login",
            path: "features/login.feature",
            scenario: "Login page loads",
            steps: ["Given I am on the login page", "Then the login page should load"],
            tags: ["@smoke"],
          },
        ],
        maxRecommendations: 10,
        notes: "Prioritize authentication.",
        pageUrl: "https://example.com/login",
      },
    });

    assert.deepEqual(fetchCalls, ["https://example.com/login", "https://api.openai.com/v1/responses"]);
    assert.equal(response.provider, "openai");
    assert.equal(response.recommendations[0].title, "Invalid login shows an error");
  });
});
