import type {
  CucumberFeatureCatalogResponse,
  DiscoverExistingCoverage,
  DiscoverTestRecommendation,
} from "@flawferret2/job-schemas";

const DUPLICATE_OVERLAP_THRESHOLD = 0.78;
const RELATED_COVERAGE_LIMIT = 12;

const STOP_WORDS = new Set(["com", "the", "and", "page", "test", "should"]);

export type CoverageDecision = {
  matchedCoverage: DiscoverExistingCoverage | null;
  recommendation: DiscoverTestRecommendation;
  reason: string;
  score: number;
  status: "keep" | "hide";
};

export const tokenizeCoverageText = (value: string) =>
  new Set(
    value
      .toLowerCase()
      .replace(/https?:\/\/|www\./g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );

export const overlapScore = (left: Set<string>, right: Set<string>) => {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  return [...left].filter((token) => right.has(token)).length / Math.min(left.size, right.size);
};

const coverageText = (coverage: DiscoverExistingCoverage) =>
  [coverage.feature, coverage.scenario, coverage.path, ...coverage.tags, ...coverage.steps].join(" ");

const recommendationText = (recommendation: DiscoverTestRecommendation) =>
  [recommendation.title, recommendation.reason, ...recommendation.scenario, ...recommendation.tags].join(" ");

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const findBestCoverageMatch = ({
  existingCoverage,
  recommendation,
}: {
  existingCoverage: DiscoverExistingCoverage[];
  recommendation: DiscoverTestRecommendation;
}) => {
  const exactMatch = existingCoverage.find(
    (coverage) => coverage.scenario.toLowerCase() === recommendation.title.toLowerCase(),
  );

  if (exactMatch) {
    return {
      coverage: exactMatch,
      reason: "Same scenario name already exists.",
      score: 1,
    };
  }

  const recommendationTokens = tokenizeCoverageText(recommendationText(recommendation));

  return existingCoverage
    .map((coverage) => {
      const score = overlapScore(recommendationTokens, tokenizeCoverageText(coverageText(coverage)));

      return {
        coverage,
        reason: `${formatPercent(score)} token overlap with an existing scenario.`,
        score,
      };
    })
    .sort((left, right) => right.score - left.score)[0] ?? null;
};

export const classifyRecommendationsByCoverage = ({
  existingCoverage,
  recommendations,
}: {
  existingCoverage: DiscoverExistingCoverage[];
  recommendations: DiscoverTestRecommendation[];
}): CoverageDecision[] =>
  recommendations.map((recommendation) => {
    const bestMatch = findBestCoverageMatch({
      existingCoverage,
      recommendation,
    });

    if (bestMatch && bestMatch.score >= DUPLICATE_OVERLAP_THRESHOLD) {
      return {
        matchedCoverage: bestMatch.coverage,
        recommendation,
        reason: bestMatch.reason,
        score: bestMatch.score,
        status: "hide",
      };
    }

    return {
      matchedCoverage: bestMatch?.coverage ?? null,
      recommendation,
      reason: bestMatch
        ? `Closest existing scenario is only ${formatPercent(bestMatch.score)} similar.`
        : "No related Cucumber coverage was found.",
      score: bestMatch?.score ?? 0,
      status: "keep",
    };
  });

export const summarizeRelatedCoverage = ({
  catalog,
  notes,
  pageLabel,
  pageUrl,
}: {
  catalog: CucumberFeatureCatalogResponse | null;
  notes: string;
  pageLabel: string;
  pageUrl: string;
}): DiscoverExistingCoverage[] => {
  if (!catalog || !pageUrl) {
    return [];
  }

  const pageTokens = tokenizeCoverageText(`${pageLabel} ${pageUrl} ${notes}`);

  return catalog.features
    .flatMap((feature) =>
      feature.scenarios.map((scenario) => ({
        coverage: {
          feature: feature.feature,
          path: feature.path,
          scenario: scenario.name,
          steps: scenario.steps.map((step) => `${step.keyword} ${step.text}`),
          tags: [...new Set([...feature.tags, ...scenario.tags])],
        },
        score: overlapScore(
          pageTokens,
          tokenizeCoverageText(
            [
              feature.feature,
              scenario.name,
              feature.path,
              ...scenario.tags,
              ...scenario.steps.map((step) => step.text),
            ].join(" "),
          ),
        ),
      })),
    )
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, RELATED_COVERAGE_LIMIT)
    .map((item) => item.coverage);
};
