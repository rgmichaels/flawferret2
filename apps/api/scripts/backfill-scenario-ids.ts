import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({
  path: resolve(process.cwd(), "../../.env"),
});

const { prisma } = await import("@flawferret2/db");
const { backfillScenarioIds } = await import("../src/scenario-backfill.js");

// Fills LocalTestRun.scenarioId for SCENARIO-scope runs recorded before stable
// scenario IDs, per repository, from the current checkout. Safe to re-run.
// Usage: pnpm --filter @flawferret2/api scenarios:backfill [repositoryId ...]
const repositoryIds = process.argv.slice(2).filter((argument) => argument.length > 0 && argument !== "--");

try {
  const results = await backfillScenarioIds({
    repositoryIds: repositoryIds.length > 0 ? repositoryIds : undefined,
  });

  results.forEach((result) => {
    console.log(
      result.status === "skipped"
        ? `${result.repositoryId}: skipped (${result.reason})`
        : `${result.repositoryId}: updated ${result.updatedRuns} runs; ${result.resolvedTargets} scenario targets resolved, ${result.unresolvedTargets} left unresolved`,
    );
  });
} finally {
  await prisma.$disconnect();
}
