import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  DEFAULT_PNPM_INSTALL_COMMAND,
  resolveInstallCommand,
  runDependencyInstall,
} from "./dependency-install.js";

describe("resolveInstallCommand", () => {
  let worktreePath: string;
  let lockfileWorktreePath: string;

  before(async () => {
    worktreePath = await mkdtemp(join(tmpdir(), "flawferret-install-"));
    lockfileWorktreePath = await mkdtemp(join(tmpdir(), "flawferret-install-lock-"));
    await writeFile(join(lockfileWorktreePath, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  });

  after(async () => {
    await rm(worktreePath, { force: true, recursive: true });
    await rm(lockfileWorktreePath, { force: true, recursive: true });
  });

  it("prefers the repository install command", async () => {
    assert.deepEqual(
      await resolveInstallCommand({
        environmentCommand: "npm ci",
        repositoryCommand: " yarn install ",
        worktreePath: lockfileWorktreePath,
      }),
      { command: "yarn install", source: "repository" },
    );
  });

  it("falls back to the environment install command", async () => {
    assert.deepEqual(
      await resolveInstallCommand({
        environmentCommand: "npm ci",
        repositoryCommand: "  ",
        worktreePath: lockfileWorktreePath,
      }),
      { command: "npm ci", source: "environment" },
    );
  });

  it("falls back to a frozen pnpm install when the worktree has a pnpm lockfile", async () => {
    assert.deepEqual(
      await resolveInstallCommand({
        repositoryCommand: null,
        worktreePath: lockfileWorktreePath,
      }),
      { command: DEFAULT_PNPM_INSTALL_COMMAND, source: "lockfile" },
    );
  });

  it("skips with a recorded reason when nothing applies", async () => {
    const resolution = await resolveInstallCommand({
      repositoryCommand: null,
      worktreePath,
    });

    assert.equal(resolution.command, null);
    assert.equal(resolution.source, "none");
    assert.ok(resolution.command === null && resolution.reason.length > 0);
  });
});

describe("runDependencyInstall", () => {
  let tempDir: string;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "flawferret-install-run-"));
  });

  after(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it("runs in the worktree and writes per-run logs", async () => {
    const result = await runDependencyInstall({
      command: "pwd && echo installed",
      jobId: "job/1",
      logDir: join(tempDir, "logs"),
      runId: "run-1",
      timeoutMs: 10_000,
      worktreePath: tempDir,
    });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.logPath, /job-1[/\\]run-1[/\\]install\.stdout\.log$/);
    assert.match(await readFile(result.logPath, "utf8"), /installed/);
  });

  it("reports a failing install", async () => {
    const result = await runDependencyInstall({
      command: "exit 3",
      jobId: "job-2",
      logDir: join(tempDir, "logs"),
      runId: "run-2",
      timeoutMs: 10_000,
      worktreePath: tempDir,
    });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 3);
  });

  it("times out a hung install", async () => {
    const result = await runDependencyInstall({
      command: "sleep 5",
      jobId: "job-3",
      logDir: join(tempDir, "logs"),
      runId: "run-3",
      timeoutMs: 100,
      worktreePath: tempDir,
    });

    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
  });
});
