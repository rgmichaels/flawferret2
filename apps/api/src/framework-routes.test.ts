import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { prisma } from "@flawferret2/db";
import type {
  CreateFrameworkResponse,
  FrameworkBuildResponse,
  PaginatedFrameworkBuildsResponse,
} from "@flawferret2/job-schemas";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";

let server: FastifyInstance;
const frameworkBuildIds: string[] = [];
const tempRoots: string[] = [];

describe("framework routes", () => {
  before(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await prisma.frameworkBuild.deleteMany({
      where: {
        id: {
          in: frameworkBuildIds.splice(0),
        },
      },
    });
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  after(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  it("persists framework build history when creating local framework files", async () => {
    const root = await mkdtemp(join(tmpdir(), "ff2-framework-route-"));
    const targetDirectory = join(root, "generated-framework");
    tempRoots.push(root);
    await mkdir(targetDirectory, {
      recursive: true,
    });

    const response = await server.inject({
      method: "POST",
      payload: {
        baseUrl: "https://example.test",
        destinationType: "local",
        features: ["sampleFeature"],
        githubBranch: "main",
        initializeGitRepository: false,
        overwriteExisting: false,
        packageName: "generated-framework",
        projectName: "Generated Framework",
        registerLocalRepository: false,
        targetDirectory,
      },
      url: "/frameworks/create",
    });

    assert.equal(response.statusCode, 201);
    const body = response.json<CreateFrameworkResponse>();
    assert.ok(body.buildRecord);
    frameworkBuildIds.push(body.buildRecord.id);
    assert.equal(body.buildRecord.createdFileCount, body.createdFiles.length);
    assert.equal(body.buildRecord.destinationType, "local");
    assert.equal(body.buildRecord.targetDirectory, targetDirectory);

    const build = await prisma.frameworkBuild.findUniqueOrThrow({
      where: {
        id: body.buildRecord.id,
      },
    });

    assert.equal(build.projectName, "Generated Framework");
    assert.equal(build.createdFileCount, body.createdFiles.length);
    assert.equal(build.totalFileCount, body.totalFiles);

    const listResponse = await server.inject({
      method: "GET",
      url: "/frameworks/builds",
    });

    assert.equal(listResponse.statusCode, 200);
    const builds = listResponse.json<FrameworkBuildResponse[]>();
    assert.ok(builds.some((savedBuild) => savedBuild.id === body.buildRecord?.id));

    const paginatedResponse = await server.inject({
      method: "GET",
      url: "/frameworks/builds?paginated=true&page=1&pageSize=25",
    });

    assert.equal(paginatedResponse.statusCode, 200);
    const paginatedBuilds = paginatedResponse.json<PaginatedFrameworkBuildsResponse>();
    assert.ok(paginatedBuilds.builds.some((savedBuild) => savedBuild.id === body.buildRecord?.id));
    assert.equal(paginatedBuilds.page, 1);
    assert.equal(paginatedBuilds.pageSize, 25);
    assert.ok(paginatedBuilds.total >= 1);

    const detailResponse = await server.inject({
      method: "GET",
      url: `/frameworks/builds/${body.buildRecord.id}`,
    });

    assert.equal(detailResponse.statusCode, 200);
    const savedBuild = detailResponse.json<FrameworkBuildResponse>();
    assert.equal(savedBuild.id, body.buildRecord.id);
    assert.equal(savedBuild.projectName, "Generated Framework");
    assert.equal(savedBuild.targetDirectory, targetDirectory);

    await rm(join(targetDirectory, "package.json"), {
      force: true,
    });

    const installResponse = await server.inject({
      method: "POST",
      payload: {
        frameworkBuildId: body.buildRecord.id,
        targetDirectory,
      },
      url: "/frameworks/install-dependencies",
    });

    assert.equal(installResponse.statusCode, 200);
    assert.equal(installResponse.json<{ status: string }>().status, "skipped");

    const updatedBuild = await prisma.frameworkBuild.findUniqueOrThrow({
      where: {
        id: body.buildRecord.id,
      },
    });

    assert.equal(updatedBuild.installStatus, "skipped");
    assert.deepEqual((updatedBuild.installResult as { status: string }).status, "skipped");
  });

  it("returns 404 for a missing framework build", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/frameworks/builds/00000000-0000-4000-8000-000000000000",
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json<{ error: string }>().error, "FrameworkBuildNotFound");
  });

  it("clears framework build registration when the repository is removed", async () => {
    const root = await mkdtemp(join(tmpdir(), "ff2-framework-repository-remove-"));
    tempRoots.push(root);

    const repository = await prisma.repository.create({
      data: {
        cloneUrl: "file:///tmp/generated-framework",
        defaultBranch: "main",
        localPath: root,
        name: "generated-framework",
        owner: "local",
        provider: "GITHUB",
        validationCommand: "pnpm test",
        webUrl: "file:///tmp/generated-framework",
      },
    });
    const build = await prisma.frameworkBuild.create({
      data: {
        baseUrl: "https://example.test",
        createdFileCount: 1,
        destinationType: "local",
        overwrittenFileCount: 0,
        packageName: "generated-framework",
        projectName: "Generated Framework",
        registeredRepositoryId: repository.id,
        request: {},
        result: {},
        skippedFileCount: 0,
        targetBranch: "main",
        targetDirectory: root,
        totalFileCount: 1,
      },
    });
    frameworkBuildIds.push(build.id);

    const response = await server.inject({
      method: "DELETE",
      url: `/repositories/${repository.id}`,
    });

    assert.equal(response.statusCode, 204);

    const updatedBuild = await prisma.frameworkBuild.findUniqueOrThrow({
      where: {
        id: build.id,
      },
    });

    assert.equal(updatedBuild.registeredRepositoryId, null);
  });
});
