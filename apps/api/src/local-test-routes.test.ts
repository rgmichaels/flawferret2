import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { prisma } from "@flawferret2/db";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";

let server: FastifyInstance;
const repositoryIds: string[] = [];
const tempRoots: string[] = [];

const createRepositoryWithFeature = async () => {
  const suffix = randomUUID().slice(0, 8);
  const root = await mkdtemp(join(tmpdir(), "ff2-local-test-routes-"));
  tempRoots.push(root);
  await mkdir(join(root, "features"), {
    recursive: true,
  });
  await writeFile(
    join(root, "features", "checkout.feature"),
    [
      "Feature: Checkout",
      "",
      "  Scenario: Pay by card",
      "    Given I have items",
      "",
      "  Scenario: Pay by gift card",
      "    Given I have a gift card",
    ].join("\n"),
  );

  const repository = await prisma.repository.create({
    data: {
      cloneUrl: `https://github.com/rgmichaels/local-test-${suffix}.git`,
      defaultBranch: "main",
      localPath: root,
      name: `local-test-${suffix}`,
      owner: "rgmichaels",
      validationCommand: "pnpm test",
      webUrl: `https://github.com/rgmichaels/local-test-${suffix}`,
    },
  });

  repositoryIds.push(repository.id);

  return repository;
};

const createRepositoryWithFiles = async (files: Record<string, string>) => {
  const suffix = randomUUID().slice(0, 8);
  const root = await mkdtemp(join(tmpdir(), "ff2-scenario-id-routes-"));
  tempRoots.push(root);

  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), {
      recursive: true,
    });
    await writeFile(join(root, path), content);
  }

  const repository = await prisma.repository.create({
    data: {
      cloneUrl: `https://github.com/rgmichaels/scenario-id-${suffix}.git`,
      defaultBranch: "main",
      localPath: root,
      name: `scenario-id-${suffix}`,
      owner: "rgmichaels",
      webUrl: `https://github.com/rgmichaels/scenario-id-${suffix}`,
    },
  });

  repositoryIds.push(repository.id);

  return {
    repository,
    root,
  };
};

const taggedCheckoutFeature = [
  "Feature: Checkout",
  "",
  "  @smoke @ff-8f3a2c",
  "  Scenario: Pay by card",
  "    Given I have items",
  "",
  "  Scenario: Pay by gift card",
  "    Given I have a gift card",
].join("\n");

describe("local test run routes", () => {
  before(async () => {
    server = await buildServer();
  });

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
    await server.close();
    await prisma.$disconnect();
  });

  it("queues a feature local test run", async () => {
    const repository = await createRepositoryWithFeature();

    const response = await server.inject({
      method: "POST",
      payload: {
        featurePath: "features/checkout.feature",
      },
      url: `/repositories/${repository.id}/features/local-test-runs`,
    });

    assert.equal(response.statusCode, 201);

    const body = response.json();
    assert.equal(body.repositoryId, repository.id);
    assert.equal(body.featurePath, "features/checkout.feature");
    assert.equal(body.scenarioLine, null);
    assert.equal(body.scope, "FEATURE");
    assert.equal(body.status, "QUEUED");
  });

  it("queues a scenario local test run", async () => {
    const repository = await createRepositoryWithFeature();

    const response = await server.inject({
      method: "POST",
      payload: {
        featurePath: "features/checkout.feature",
        scenarioLine: 6,
      },
      url: `/repositories/${repository.id}/features/local-test-runs`,
    });

    assert.equal(response.statusCode, 201);

    const body = response.json();
    assert.equal(body.scenarioLine, 6);
    assert.equal(body.scope, "SCENARIO");
    assert.equal(body.status, "QUEUED");
  });

  it("rejects a scenario line that does not exist", async () => {
    const repository = await createRepositoryWithFeature();

    const response = await server.inject({
      method: "POST",
      payload: {
        featurePath: "features/checkout.feature",
        scenarioLine: 99,
      },
      url: `/repositories/${repository.id}/features/local-test-runs`,
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().message, "Scenario not found.");
  });

  it("lists recent local test runs for a feature", async () => {
    const repository = await createRepositoryWithFeature();

    await prisma.localTestRun.createMany({
      data: [
        {
          createdAt: new Date("2026-07-27T13:00:00.000Z"),
          featurePath: "features/checkout.feature",
          repositoryId: repository.id,
        },
        {
          createdAt: new Date("2026-07-27T13:00:01.000Z"),
          featurePath: "features/checkout.feature",
          repositoryId: repository.id,
        },
        {
          createdAt: new Date("2026-07-27T13:00:02.000Z"),
          featurePath: "features/other.feature",
          repositoryId: repository.id,
        },
      ],
    });

    const response = await server.inject({
      method: "GET",
      url: `/repositories/${repository.id}/features/local-test-runs?featurePath=${encodeURIComponent(
        "features/checkout.feature",
      )}`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(response.headers["x-total-count"], "2");
    assert.equal(body.length, 2);
    assert.equal(body[0].featurePath, "features/checkout.feature");
  });

  it("paginates local test runs for a feature", async () => {
    const repository = await createRepositoryWithFeature();

    await prisma.localTestRun.createMany({
      data: [
        {
          createdAt: new Date("2026-07-27T13:00:00.000Z"),
          featurePath: "features/checkout.feature",
          repositoryId: repository.id,
        },
        {
          createdAt: new Date("2026-07-27T13:00:01.000Z"),
          featurePath: "features/checkout.feature",
          repositoryId: repository.id,
        },
      ],
    });

    const response = await server.inject({
      method: "GET",
      url: `/repositories/${repository.id}/features/local-test-runs?featurePath=${encodeURIComponent(
        "features/checkout.feature",
      )}&limit=1&page=2`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(response.headers["x-total-count"], "2");
    assert.equal(body.length, 1);
    assert.equal(body[0].createdAt, "2026-07-27T13:00:00.000Z");
  });

  it("returns local test run stats for a feature", async () => {
    const repository = await createRepositoryWithFeature();

    await prisma.localTestRun.createMany({
      data: [
        {
          completedAt: new Date("2026-07-27T13:00:01.000Z"),
          featurePath: "features/checkout.feature",
          repositoryId: repository.id,
          startedAt: new Date("2026-07-27T13:00:00.000Z"),
          status: "PASSED",
        },
        {
          completedAt: new Date("2026-07-27T13:00:03.000Z"),
          featurePath: "features/checkout.feature",
          repositoryId: repository.id,
          scenarioLine: 6,
          startedAt: new Date("2026-07-27T13:00:01.000Z"),
          status: "FAILED",
        },
        {
          featurePath: "features/checkout.feature",
          repositoryId: repository.id,
          status: "QUEUED",
        },
        {
          completedAt: new Date("2026-07-27T13:00:05.000Z"),
          featurePath: "features/other.feature",
          repositoryId: repository.id,
          startedAt: new Date("2026-07-27T13:00:00.000Z"),
          status: "PASSED",
        },
      ],
    });

    const response = await server.inject({
      method: "GET",
      url: `/repositories/${repository.id}/features/local-test-runs/stats?featurePath=${encodeURIComponent(
        "features/checkout.feature",
      )}`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.totalRuns, 3);
    assert.equal(body.queuedRuns, 1);
    assert.equal(body.passedRuns, 1);
    assert.equal(body.failedRuns, 1);
    assert.equal(body.completedRuns, 2);
    assert.equal(body.averageDurationMs, 1500);
    assert.equal(body.passRate, 0.5);
    assert.equal(body.failureRate, 0.5);
  });

  it("queues a scenario run by tag ID and stores the tag for the runner", async () => {
    const { repository } = await createRepositoryWithFiles({
      "features/checkout.feature": taggedCheckoutFeature,
    });

    const response = await server.inject({
      method: "POST",
      payload: {
        featurePath: "features/checkout.feature",
        scenarioId: "ff-8f3a2c",
      },
      url: `/repositories/${repository.id}/features/local-test-runs`,
    });

    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.scenarioId, "ff-8f3a2c");
    assert.equal(body.scenarioLine, 4);
    assert.equal(body.scope, "SCENARIO");

    const run = await prisma.localTestRun.findUniqueOrThrow({
      where: {
        id: body.id,
      },
    });
    assert.equal(run.scenarioTag, "@ff-8f3a2c");
  });

  it("queues a scenario run by fingerprint without a tag", async () => {
    const { repository } = await createRepositoryWithFiles({
      "features/checkout.feature": taggedCheckoutFeature,
    });
    const detail = await server.inject({
      method: "GET",
      url: `/repositories/${repository.id}/features/detail?path=${encodeURIComponent("features/checkout.feature")}`,
    });
    const untagged = detail.json().feature.scenarios[1];

    const response = await server.inject({
      method: "POST",
      payload: {
        featurePath: "features/checkout.feature",
        scenarioId: untagged.fingerprint,
      },
      url: `/repositories/${repository.id}/features/local-test-runs`,
    });

    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.scenarioId, untagged.fingerprint);
    assert.equal(body.scenarioLine, 7);

    const run = await prisma.localTestRun.findUniqueOrThrow({
      where: {
        id: body.id,
      },
    });
    assert.equal(run.scenarioTag, null);
  });

  it("keeps scenarioLine-only runs targeting the line, recording the current identity", async () => {
    const { repository } = await createRepositoryWithFiles({
      "features/checkout.feature": taggedCheckoutFeature,
    });

    const response = await server.inject({
      method: "POST",
      payload: {
        featurePath: "features/checkout.feature",
        scenarioLine: 4,
      },
      url: `/repositories/${repository.id}/features/local-test-runs`,
    });

    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.scenarioLine, 4);
    assert.equal(body.scenarioId, "ff-8f3a2c");

    const run = await prisma.localTestRun.findUniqueOrThrow({
      where: {
        id: body.id,
      },
    });
    assert.equal(run.scenarioTag, null);
  });

  it("refuses a scenario ID duplicated in another file and creates no run", async () => {
    const { repository } = await createRepositoryWithFiles({
      "features/checkout.feature": taggedCheckoutFeature,
      "features/refunds.feature": ["Feature: Refunds", "", "  @ff-8f3a2c", "  Scenario: Copy-pasted", "    Given x"].join(
        "\n",
      ),
    });

    const response = await server.inject({
      method: "POST",
      payload: {
        featurePath: "features/checkout.feature",
        scenarioId: "ff-8f3a2c",
      },
      url: `/repositories/${repository.id}/features/local-test-runs`,
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "AmbiguousScenarioId");
    assert.match(response.json().message, /ambiguous/);
    assert.match(response.json().message, /features\/refunds\.feature:4/);
    assert.equal(
      await prisma.localTestRun.count({
        where: {
          repositoryId: repository.id,
        },
      }),
      0,
    );
  });

  it("refuses a scenario ID that is also a Feature-line tag in the same file and creates no run", async () => {
    const { repository } = await createRepositoryWithFiles({
      "features/checkout.feature": [
        "@ff-8f3a2c",
        "Feature: Checkout",
        "",
        "  @ff-8f3a2c",
        "  Scenario: Pay by card",
        "    Given I have items",
        "",
        "  Scenario: Pay by gift card",
        "    Given I have a gift card",
      ].join("\n"),
    });

    const response = await server.inject({
      method: "POST",
      payload: {
        featurePath: "features/checkout.feature",
        scenarioId: "ff-8f3a2c",
      },
      url: `/repositories/${repository.id}/features/local-test-runs`,
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "AmbiguousScenarioId");
    assert.match(response.json().message, /ambiguous/);
    assert.equal(
      await prisma.localTestRun.count({
        where: {
          repositoryId: repository.id,
        },
      }),
      0,
    );
  });

  it("rejects unknown scenario IDs and scenarioId combined with scenarioLine", async () => {
    const { repository } = await createRepositoryWithFiles({
      "features/checkout.feature": taggedCheckoutFeature,
    });

    const unknown = await server.inject({
      method: "POST",
      payload: {
        featurePath: "features/checkout.feature",
        scenarioId: "ff-000000",
      },
      url: `/repositories/${repository.id}/features/local-test-runs`,
    });
    const both = await server.inject({
      method: "POST",
      payload: {
        featurePath: "features/checkout.feature",
        scenarioId: "ff-8f3a2c",
        scenarioLine: 4,
      },
      url: `/repositories/${repository.id}/features/local-test-runs`,
    });

    assert.equal(unknown.statusCode, 400);
    assert.equal(unknown.json().error, "ScenarioNotFound");
    assert.equal(both.statusCode, 400);
    assert.equal(
      await prisma.localTestRun.count({
        where: {
          repositoryId: repository.id,
        },
      }),
      0,
    );
  });

  it("reports per-scenario stats and lists runs by scenario ID", async () => {
    const repository = await createRepositoryWithFeature();

    await prisma.localTestRun.createMany({
      data: [
        {
          completedAt: new Date("2026-07-27T13:00:01.000Z"),
          createdAt: new Date("2026-07-27T13:00:00.000Z"),
          featurePath: "features/old-name.feature",
          repositoryId: repository.id,
          scenarioId: "ff-8f3a2c",
          scenarioLine: 3,
          scope: "SCENARIO",
          startedAt: new Date("2026-07-27T13:00:00.000Z"),
          status: "PASSED",
        },
        {
          completedAt: new Date("2026-07-27T14:00:03.000Z"),
          createdAt: new Date("2026-07-27T14:00:00.000Z"),
          featurePath: "features/checkout.feature",
          repositoryId: repository.id,
          scenarioId: "ff-8f3a2c",
          scenarioLine: 9,
          scope: "SCENARIO",
          startedAt: new Date("2026-07-27T14:00:00.000Z"),
          status: "FAILED",
        },
        {
          featurePath: "features/checkout.feature",
          repositoryId: repository.id,
          scenarioId: "ff-111111",
          scenarioLine: 6,
          scope: "SCENARIO",
        },
      ],
    });

    const stats = await server.inject({
      method: "GET",
      url: `/repositories/${repository.id}/features/local-test-runs/stats?scenarioId=ff-8f3a2c`,
    });
    const neverRun = await server.inject({
      method: "GET",
      url: `/repositories/${repository.id}/features/local-test-runs/stats?scenarioId=ff-999999`,
    });
    const list = await server.inject({
      method: "GET",
      url: `/repositories/${repository.id}/features/local-test-runs?scenarioId=ff-8f3a2c`,
    });

    assert.equal(stats.statusCode, 200);
    assert.equal(stats.json().totalRuns, 2);
    assert.equal(stats.json().passedRuns, 1);
    assert.equal(stats.json().failedRuns, 1);
    assert.equal(stats.json().passRate, 0.5);
    assert.equal(stats.json().averageDurationMs, 2000);
    assert.equal(stats.json().lastStatus, "FAILED");
    assert.equal(stats.json().lastRunAt, "2026-07-27T14:00:00.000Z");

    assert.equal(neverRun.statusCode, 200);
    assert.equal(neverRun.json().totalRuns, 0);
    assert.equal(neverRun.json().lastStatus, null);
    assert.equal(neverRun.json().lastRunAt, null);
    assert.equal(neverRun.json().passRate, null);

    assert.equal(list.statusCode, 200);
    assert.equal(list.headers["x-total-count"], "2");
    assert.deepEqual(
      list.json().map((run: { scenarioId: string }) => run.scenarioId),
      ["ff-8f3a2c", "ff-8f3a2c"],
    );
  });

  it("upserts scenario identities on catalog reads and tracks missing scenarios", async () => {
    const { repository, root } = await createRepositoryWithFiles({
      "features/checkout.feature": taggedCheckoutFeature,
      "features/refunds.feature": [
        "Feature: Refunds",
        "",
        "  @ff-aaaaaa",
        "  Scenario: Refund A",
        "    Given x",
        "",
        "  @ff-aaaaaa",
        "  Scenario: Refund B",
        "    Given y",
      ].join("\n"),
    });
    const readCatalog = () =>
      server.inject({
        method: "GET",
        url: `/repositories/${repository.id}/features`,
      });
    const scenarioRows = () =>
      prisma.scenario.findMany({
        orderBy: {
          lastSeenLine: "asc",
        },
        where: {
          repositoryId: repository.id,
        },
      });

    assert.equal((await readCatalog()).statusCode, 200);
    let rows = await scenarioRows();
    // The duplicated ff-aaaaaa is ambiguous and is not upserted.
    assert.equal(rows.length, 2);
    const tagged = rows.find((row) => row.scenarioId === "ff-8f3a2c");
    assert.equal(tagged?.idSource, "tag");
    assert.equal(tagged?.lastSeenPath, "features/checkout.feature");
    assert.equal(tagged?.lastSeenLine, 4);
    assert.equal(tagged?.lastSeenName, "Pay by card");
    assert.equal(tagged?.missingSince, null);
    assert.equal(rows.find((row) => row.scenarioId !== "ff-8f3a2c")?.idSource, "fingerprint");

    // Move + rename the tagged scenario into another file; remove the untagged one.
    await writeFile(join(root, "features", "checkout.feature"), "Feature: Checkout\n");
    await writeFile(
      join(root, "features", "payments.feature"),
      ["Feature: Payments", "", "", "  @ff-8f3a2c", "  Scenario: Pay with a card", "    Given I have items"].join("\n"),
    );
    assert.equal((await readCatalog()).statusCode, 200);
    rows = await scenarioRows();
    assert.equal(rows.length, 2);
    const moved = rows.find((row) => row.scenarioId === "ff-8f3a2c");
    assert.equal(moved?.id, tagged?.id);
    assert.equal(moved?.lastSeenPath, "features/payments.feature");
    assert.equal(moved?.lastSeenLine, 5);
    assert.equal(moved?.lastSeenName, "Pay with a card");
    assert.equal(moved?.missingSince, null);
    assert.notEqual(rows.find((row) => row.scenarioId !== "ff-8f3a2c")?.missingSince, null);

    // A detail read never marks other scenarios missing.
    await writeFile(join(root, "features", "payments.feature"), "Feature: Payments\n");
    await server.inject({
      method: "GET",
      url: `/repositories/${repository.id}/features/detail?path=${encodeURIComponent("features/refunds.feature")}`,
    });
    assert.equal((await scenarioRows()).find((row) => row.scenarioId === "ff-8f3a2c")?.missingSince, null);

    // A catalog read marks it missing; reappearing clears it.
    await readCatalog();
    assert.notEqual((await scenarioRows()).find((row) => row.scenarioId === "ff-8f3a2c")?.missingSince, null);
    await writeFile(join(root, "features", "checkout.feature"), taggedCheckoutFeature);
    await readCatalog();
    assert.equal((await scenarioRows()).find((row) => row.scenarioId === "ff-8f3a2c")?.missingSince, null);
  });

  it("reports duplicate IDs from other files in feature detail", async () => {
    const { repository } = await createRepositoryWithFiles({
      "features/checkout.feature": taggedCheckoutFeature,
      "features/refunds.feature": ["Feature: Refunds", "", "  @ff-8f3a2c", "  Scenario: Copy-pasted", "    Given x"].join(
        "\n",
      ),
    });

    const response = await server.inject({
      method: "GET",
      url: `/repositories/${repository.id}/features/detail?path=${encodeURIComponent("features/checkout.feature")}`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.feature.scenarios[0].idConflict, true);
    assert.deepEqual(body.duplicateScenarioIds, [
      {
        id: "ff-8f3a2c",
        locations: [
          { line: 4, path: "features/checkout.feature" },
          { line: 4, path: "features/refunds.feature" },
        ],
      },
    ]);
  });

  it("uses the repository's scenario ID pattern", async () => {
    const { repository } = await createRepositoryWithFiles({
      "features/checkout.feature": ["Feature: Checkout", "", "  @TC-42", "  Scenario: Pay", "    Given x"].join("\n"),
    });
    await prisma.repository.update({
      data: {
        scenarioIdPattern: "@TC-\\d+",
      },
      where: {
        id: repository.id,
      },
    });

    const catalog = await server.inject({
      method: "GET",
      url: `/repositories/${repository.id}/features`,
    });

    assert.equal(catalog.statusCode, 200);
    assert.equal(catalog.json().features[0].scenarios[0].id, "TC-42");
    assert.equal(catalog.json().repository.scenarioIdPattern, undefined);

    const run = await server.inject({
      method: "POST",
      payload: {
        featurePath: "features/checkout.feature",
        scenarioId: "TC-42",
      },
      url: `/repositories/${repository.id}/features/local-test-runs`,
    });

    assert.equal(run.statusCode, 201);
    assert.equal(
      (await prisma.localTestRun.findUniqueOrThrow({ where: { id: run.json().id } })).scenarioTag,
      "@TC-42",
    );
  });

  it("returns local test run output", async () => {
    const repository = await createRepositoryWithFeature();
    const root = tempRoots.at(-1);

    assert.ok(root);

    const stdoutPath = join(root, "stdout.log");
    const stderrPath = join(root, "stderr.log");
    await writeFile(stdoutPath, "1 scenario passed\n");
    await writeFile(stderrPath, "browser warning\n");

    const run = await prisma.localTestRun.create({
      data: {
        completedAt: new Date("2026-07-27T13:00:02.000Z"),
        featurePath: "features/checkout.feature",
        repositoryId: repository.id,
        startedAt: new Date("2026-07-27T13:00:00.000Z"),
        status: "PASSED",
        stderrPath,
        stdoutPath,
      },
    });

    const response = await server.inject({
      method: "GET",
      url: `/local-test-runs/${run.id}/output`,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.stdout, "1 scenario passed\n");
    assert.equal(body.stderr, "browser warning\n");
    assert.equal(body.truncated, false);
  });
});
