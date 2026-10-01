import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { prisma } from "@flawferret2/db";
import { backfillScenarioIds } from "./scenario-backfill.js";

const repositoryIds: string[] = [];
const tempRoots: string[] = [];

const createRepository = async (localPath: string | null) => {
  const suffix = randomUUID().slice(0, 8);
  const repository = await prisma.repository.create({
    data: {
      cloneUrl: `https://github.com/rgmichaels/backfill-${suffix}.git`,
      defaultBranch: "main",
      localPath,
      name: `backfill-${suffix}`,
      owner: "rgmichaels",
      webUrl: `https://github.com/rgmichaels/backfill-${suffix}`,
    },
  });
  repositoryIds.push(repository.id);

  return repository;
};

describe("scenario ID backfill", () => {
  afterEach(async () => {
    await prisma.localTestRun.deleteMany({
      where: {
        repositoryId: {
          in: repositoryIds,
        },
      },
    });
    await prisma.repository.deleteMany({
      where: {
        id: {
          in: repositoryIds.splice(0),
        },
      },
    });
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("fills SCENARIO runs best-effort, keeps FEATURE runs NULL, skips missing checkouts, and is idempotent", async () => {
    const root = await mkdtemp(join(tmpdir(), "ff2-backfill-"));
    tempRoots.push(root);
    await mkdir(join(root, "features"), {
      recursive: true,
    });
    await writeFile(
      join(root, "features", "checkout.feature"),
      [
        "Feature: Checkout",
        "",
        "  @ff-8f3a2c",
        "  Scenario: Pay by card",
        "    Given I have items",
        "",
        "  Scenario: Pay by gift card",
        "    Given I have a gift card",
      ].join("\n"),
    );
    const repository = await createRepository(root);
    const missingRepository = await createRepository(join(root, "does-not-exist"));
    const noPathRepository = await createRepository(null);

    const create = (data: { featurePath?: string; repositoryId?: string; scenarioLine?: number; scope?: "FEATURE" | "SCENARIO" }) =>
      prisma.localTestRun.create({
        data: {
          featurePath: data.featurePath ?? "features/checkout.feature",
          repositoryId: data.repositoryId ?? repository.id,
          scenarioLine: data.scenarioLine ?? null,
          scope: data.scope ?? "SCENARIO",
        },
      });
    const tagged = await create({ scenarioLine: 4 });
    const taggedAgain = await create({ scenarioLine: 4 });
    const untagged = await create({ scenarioLine: 7 });
    const stale = await create({ scenarioLine: 99 });
    const feature = await create({ scope: "FEATURE" });
    const otherRepositoryRun = await create({ repositoryId: missingRepository.id, scenarioLine: 4 });

    const ids = [repository.id, missingRepository.id, noPathRepository.id];
    const first = await backfillScenarioIds({ repositoryIds: ids });

    const resultFor = (results: typeof first, id: string) => results.find((result) => result.repositoryId === id);
    assert.deepEqual(resultFor(first, repository.id), {
      repositoryId: repository.id,
      resolvedTargets: 2,
      status: "completed",
      unresolvedTargets: 1,
      updatedRuns: 3,
    });
    assert.equal(resultFor(first, missingRepository.id)?.status, "skipped");
    assert.equal(resultFor(first, noPathRepository.id)?.status, "skipped");

    const scenarioIdOf = async (id: string) =>
      (await prisma.localTestRun.findUniqueOrThrow({ where: { id } })).scenarioId;
    assert.equal(await scenarioIdOf(tagged.id), "ff-8f3a2c");
    assert.equal(await scenarioIdOf(taggedAgain.id), "ff-8f3a2c");
    assert.match((await scenarioIdOf(untagged.id)) ?? "", /^[0-9a-f]{40}$/);
    assert.equal(await scenarioIdOf(stale.id), null);
    assert.equal(await scenarioIdOf(feature.id), null);
    assert.equal(await scenarioIdOf(otherRepositoryRun.id), null);

    const before = await prisma.localTestRun.findMany({ orderBy: { id: "asc" }, where: { repositoryId: { in: ids } } });
    const second = await backfillScenarioIds({ repositoryIds: ids });
    const afterSecond = await prisma.localTestRun.findMany({
      orderBy: { id: "asc" },
      where: { repositoryId: { in: ids } },
    });

    assert.equal(resultFor(second, repository.id)?.status, "completed");
    assert.deepEqual(
      second.map((result) => (result.status === "completed" ? result.updatedRuns : 0)),
      [0, 0, 0],
    );
    assert.deepEqual(afterSecond, before);
  });
});
