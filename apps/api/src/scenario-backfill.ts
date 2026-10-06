import {
  assignLocalTestRunScenarioId,
  listLocalTestRunTargetsWithoutScenarioId,
  prisma,
} from "@flawferret2/db";
import { stat } from "node:fs/promises";
import { parseRepositoryFeatures } from "./cucumber-features.js";
import { resolveScenarioIdAtLine } from "./scenario-identity.js";

export type ScenarioIdBackfillResult =
  | {
      reason: string;
      repositoryId: string;
      status: "skipped";
    }
  | {
      repositoryId: string;
      resolvedTargets: number;
      status: "completed";
      unresolvedTargets: number;
      updatedRuns: number;
    };

const isReadableDirectory = async (path: string) => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Fills `LocalTestRun.scenarioId` for SCENARIO-scope runs recorded before scenario IDs,
 * resolving (featurePath, scenarioLine) against the current checkout. FEATURE-scope runs
 * and runs with no scenario on that line now stay NULL. Only NULL rows are written, so
 * re-running against the same checkout changes nothing.
 */
export const backfillRepositoryScenarioIds = async (repository: {
  id: string;
  localPath: string | null;
  scenarioIdPattern: string | null;
}): Promise<ScenarioIdBackfillResult> => {
  if (!repository.localPath || !(await isReadableDirectory(repository.localPath))) {
    return {
      reason: repository.localPath ? `Local path is missing or unreadable: ${repository.localPath}` : "No local path.",
      repositoryId: repository.id,
      status: "skipped",
    };
  }

  const targets = await listLocalTestRunTargetsWithoutScenarioId({
    repositoryId: repository.id,
  });

  if (targets.length === 0) {
    return {
      repositoryId: repository.id,
      resolvedTargets: 0,
      status: "completed",
      unresolvedTargets: 0,
      updatedRuns: 0,
    };
  }

  let features;
  try {
    ({ features } = await parseRepositoryFeatures({
      localPath: repository.localPath,
      scenarioIdPattern: repository.scenarioIdPattern,
    }));
  } catch (error) {
    return {
      reason: error instanceof Error ? error.message : "Unable to read feature files.",
      repositoryId: repository.id,
      status: "skipped",
    };
  }

  let resolvedTargets = 0;
  let updatedRuns = 0;

  for (const target of targets) {
    const scenarioId = resolveScenarioIdAtLine(features, target.featurePath, target.scenarioLine);

    if (!scenarioId) {
      continue;
    }

    resolvedTargets += 1;
    updatedRuns += await assignLocalTestRunScenarioId({
      featurePath: target.featurePath,
      repositoryId: repository.id,
      scenarioId,
      scenarioLine: target.scenarioLine,
    });
  }

  return {
    repositoryId: repository.id,
    resolvedTargets,
    status: "completed",
    unresolvedTargets: targets.length - resolvedTargets,
    updatedRuns,
  };
};

export const backfillScenarioIds = async ({ repositoryIds }: { repositoryIds?: string[] } = {}) => {
  const repositories = await prisma.repository.findMany({
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      localPath: true,
      scenarioIdPattern: true,
    },
    where: repositoryIds
      ? {
          id: {
            in: repositoryIds,
          },
        }
      : undefined,
  });
  const results: ScenarioIdBackfillResult[] = [];

  for (const repository of repositories) {
    results.push(await backfillRepositoryScenarioIds(repository));
  }

  return results;
};
