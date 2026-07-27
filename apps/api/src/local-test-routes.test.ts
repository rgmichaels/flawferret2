import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
