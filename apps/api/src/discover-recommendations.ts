import {
  type DiscoverExistingCoverage,
  discoverTestRecommendationSchema,
  type DiscoverTestRecommendation,
  type DiscoverTestRecommendationsResponse,
} from "@flawferret2/job-schemas";
import { getConfiguredModelPromptPreface } from "@flawferret2/shared";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_PAGE_CONTEXT_CHARS = 18_000;

type DiscoverRecommendationsInput = {
  existingCoverage: DiscoverExistingCoverage[];
  maxRecommendations: number;
  notes: string;
  pageUrl: string;
};

type FetchLike = typeof fetch;

const extractOutputText = (body: unknown) => {
  if (!body || typeof body !== "object") {
    return null;
  }

  const record = body as {
    output_text?: unknown;
    output?: Array<{
      content?: Array<{
        text?: unknown;
      }>;
    }>;
  };

  if (typeof record.output_text === "string" && record.output_text.trim().length > 0) {
    return record.output_text.trim();
  }

  const text = record.output
    ?.flatMap((item) => item.content ?? [])
    .map((item) => item.text)
    .filter((item): item is string => typeof item === "string")
    .join("\n")
    .trim();

  return text && text.length > 0 ? text : null;
};

const parseJsonObject = (text: string) => {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const candidate = fenced ?? trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace < firstBrace) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as unknown;
  } catch {
    return null;
  }
};

const normalizeTags = (tags: string[]) =>
  [...new Set(tags.map((tag) => tag.trim()).filter(Boolean).map((tag) => (tag.startsWith("@") ? tag : `@${tag}`)))]
    .filter((tag) => /^@[A-Za-z0-9_-]+$/.test(tag))
    .slice(0, 8);

export const parseDiscoverRecommendations = (
  text: string,
  maxRecommendations: number,
): DiscoverTestRecommendation[] => {
  const parsed = parseJsonObject(text);

  if (!parsed || typeof parsed !== "object" || !("recommendations" in parsed)) {
    return [];
  }

  const recommendations = (parsed as { recommendations?: unknown }).recommendations;

  if (!Array.isArray(recommendations)) {
    return [];
  }

  return recommendations
    .map((recommendation) => {
      if (!recommendation || typeof recommendation !== "object") {
        return null;
      }

      const record = recommendation as Record<string, unknown>;
      const candidate = {
        acceptance: Array.isArray(record.acceptance) ? record.acceptance : [],
        impact: record.impact,
        reason: record.reason,
        scenario: Array.isArray(record.scenario) ? record.scenario : [],
        tags: normalizeTags(Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : []),
        title: record.title,
      };
      const result = discoverTestRecommendationSchema.safeParse(candidate);

      return result.success ? result.data : null;
    })
    .filter((recommendation): recommendation is DiscoverTestRecommendation => Boolean(recommendation))
    .slice(0, maxRecommendations);
};

const stripHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const fetchPageContext = async ({
  fetchImpl,
  pageUrl,
}: {
  fetchImpl: FetchLike;
  pageUrl: string;
}) => {
  try {
    const response = await fetchImpl(pageUrl, {
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      return "";
    }

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    const pageText = contentType.includes("html") ? stripHtml(text) : text.replace(/\s+/g, " ").trim();

    return pageText.slice(0, MAX_PAGE_CONTEXT_CHARS);
  } catch {
    return "";
  }
};

export const buildDiscoverRecommendationsPrompt = ({
  existingCoverage,
  maxRecommendations,
  notes,
  pageContext,
  pageUrl,
}: DiscoverRecommendationsInput & {
  pageContext: string;
}) =>
  [
    getConfiguredModelPromptPreface(),
    "",
    "You are helping a manual QA tester discover high-impact Playwright/Cucumber automation candidates for a web page.",
    `Recommend ${maxRecommendations} focused tests. Prefer user-visible behavior, failure-prone workflows, accessibility, edge cases, and regression-prone states.`,
    "Each recommendation must be small enough to become one Cucumber scenario/job.",
    "Do not recommend tests that are already covered by the existing Cucumber scenarios listed below.",
    "If similar coverage exists, recommend a meaningfully different gap or edge case.",
    "",
    "Return JSON only with this shape:",
    JSON.stringify(
      {
        recommendations: [
          {
            acceptance: ["Concrete implementation guidance"],
            impact: "High",
            reason: "Why this test matters",
            scenario: ["Given ...", "When ...", "Then ..."],
            tags: ["@smoke"],
            title: "Short test title",
          },
        ],
      },
      null,
      2,
    ),
    "",
    "Rules:",
    "- Use impact values High or Medium only.",
    "- Use Cucumber-style scenario lines.",
    "- Prefer precise behavior over vague phrases like exercise the page.",
    "- Do not invent credentials, private data, or internal endpoints.",
    "- Keep each title unique.",
    "- Include 1-5 tags per recommendation.",
    "",
    `Page URL: ${pageUrl}`,
    notes ? `Tester notes: ${notes}` : "Tester notes: none",
    "",
    "Related existing Cucumber coverage:",
    existingCoverage.length > 0
      ? existingCoverage
          .map((item, index) =>
            [
              `${index + 1}. ${item.feature} - ${item.scenario}`,
              `Path: ${item.path}`,
              item.tags.length > 0 ? `Tags: ${item.tags.join(" ")}` : "Tags: none",
              "Steps:",
              ...item.steps.map((step) => `- ${step}`),
            ].join("\n"),
          )
          .join("\n\n")
      : "No related existing scenarios were found.",
    "",
    "Visible page/context text:",
    pageContext || "No page text was available. Infer from the URL and tester notes.",
  ].join("\n");

export const buildDiscoverRecommendations = async ({
  fetchImpl = fetch,
  input,
}: {
  fetchImpl?: FetchLike;
  input: DiscoverRecommendationsInput;
}): Promise<DiscoverTestRecommendationsResponse> => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return {
      message: "OpenAI is not configured, so local recommendations were used.",
      provider: "local",
      recommendations: [],
    };
  }

  const pageContext = await fetchPageContext({
    fetchImpl,
    pageUrl: input.pageUrl,
  });
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    body: JSON.stringify({
      input: buildDiscoverRecommendationsPrompt({
        ...input,
        pageContext,
      }),
      model: process.env.OPENAI_DISCOVER_TESTS_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    return {
      message: `OpenAI recommendation request failed with ${response.status}. Local recommendations were used.`,
      provider: "local",
      recommendations: [],
    };
  }

  const outputText = extractOutputText(await response.json());
  const recommendations = outputText ? parseDiscoverRecommendations(outputText, input.maxRecommendations) : [];

  if (recommendations.length === 0) {
    return {
      message: "OpenAI did not return valid recommendations, so local recommendations were used.",
      provider: "local",
      recommendations: [],
    };
  }

  return {
    message: null,
    provider: "openai",
    recommendations,
  };
};
