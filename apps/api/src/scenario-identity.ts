import { syncRepositoryScenarios, type ScenarioSnapshot } from "@flawferret2/db";
import type { CucumberFeatureSummary, CucumberScenario } from "@flawferret2/job-schemas";
import type { FastifyBaseLogger } from "fastify";
import { createHash } from "node:crypto";

const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ");

// The persisted identity of a scenario: its tag ID, or its fingerprint when untagged.
export const scenarioIdentityOf = (scenario: CucumberScenario) =>
  scenario.idSource === "tag" && scenario.id ? scenario.id : scenario.fingerprint;

// Hash of the normalized name plus step texts, so content changes under a stable ID are visible.
export const scenarioContentHash = (scenario: CucumberScenario) =>
  createHash("sha1")
    .update([normalizeText(scenario.name).toLowerCase(), ...scenario.steps.map((step) => normalizeText(step.text))].join("\n"))
    .digest("hex");

// Ambiguous scenarios (duplicated or multiple ID tags) are not upserted, but their
// identities still count as present so existing rows are not marked missing.
export const toScenarioSnapshots = (features: CucumberFeatureSummary[]) => {
  const scenarios: ScenarioSnapshot[] = [];
  const presentScenarioIds = new Set<string>();

  features.forEach((feature) => {
    feature.scenarios.forEach((scenario) => {
      const scenarioId = scenarioIdentityOf(scenario);
      presentScenarioIds.add(scenarioId);

      if (scenario.idConflict) {
        return;
      }

      scenarios.push({
        contentHash: scenarioContentHash(scenario),
        idSource: scenario.idSource,
        lastSeenLine: scenario.line,
        lastSeenName: scenario.name,
        lastSeenPath: feature.path,
        scenarioId,
      });
    });
  });

  return {
    presentScenarioIds: [...presentScenarioIds],
    scenarios,
  };
};

/**
 * Best-effort `Scenario` upsert after a catalog/detail read (spec Decision 5).
 * A failure is logged and swallowed so the GET still succeeds. Only full-catalog
 * reads may mark unseen scenarios missing; a single-file read cannot tell.
 */
export const recordScenarioSnapshots = async ({
  features,
  logger,
  markMissing,
  repositoryId,
  sync = syncRepositoryScenarios,
}: {
  features: CucumberFeatureSummary[];
  logger: Pick<FastifyBaseLogger, "warn">;
  markMissing: boolean;
  repositoryId: string;
  sync?: typeof syncRepositoryScenarios;
}) => {
  try {
    const { presentScenarioIds, scenarios } = toScenarioSnapshots(features);

    return await sync({
      markMissing,
      presentScenarioIds,
      repositoryId,
      scenarios,
    });
  } catch (error) {
    logger.warn(
      {
        err: error,
        repositoryId,
      },
      "Unable to record scenario identities; continuing without them.",
    );

    return null;
  }
};

export type ScenarioMatch = {
  featurePath: string;
  scenario: CucumberScenario;
};

// Tag IDs match `id`; fingerprints only match untagged scenarios.
export const findScenariosByIdentity = (features: CucumberFeatureSummary[], scenarioId: string): ScenarioMatch[] =>
  features.flatMap((feature) =>
    feature.scenarios
      .filter((scenario) =>
        scenario.idSource === "tag" ? scenario.id === scenarioId : scenario.fingerprint === scenarioId,
      )
      .map((scenario) => ({
        featurePath: feature.path,
        scenario,
      })),
  );

export type ScenarioIdResolution =
  | { match: ScenarioMatch; status: "found" }
  | { matches: ScenarioMatch[]; status: "ambiguous" }
  | { status: "not_found" };

// Resolves a requested scenarioId within one feature file; any duplicate or ID conflict
// (detected repo-wide by the caller's parse) makes the request ambiguous.
export const resolveScenarioIdInFeature = (
  feature: CucumberFeatureSummary,
  scenarioId: string,
): ScenarioIdResolution => {
  const matches = findScenariosByIdentity([feature], scenarioId);

  if (matches.length === 0) {
    return { status: "not_found" };
  }

  if (matches.length > 1 || matches[0].scenario.idConflict) {
    return { matches, status: "ambiguous" };
  }

  return { match: matches[0], status: "found" };
};

// Backfill: the current identity of the scenario starting at (featurePath, scenarioLine),
// or null when nothing sits on that line now or its ID is ambiguous.
export const resolveScenarioIdAtLine = (
  features: CucumberFeatureSummary[],
  featurePath: string,
  scenarioLine: number,
) => {
  const scenario = features
    .find((feature) => feature.path === featurePath)
    ?.scenarios.find((candidate) => candidate.line === scenarioLine);

  return scenario && !scenario.idConflict ? scenarioIdentityOf(scenario) : null;
};
