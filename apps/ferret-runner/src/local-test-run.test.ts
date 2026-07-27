import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ClaimedLocalTestRun } from "@flawferret2/db";
import { buildLocalTestCommand, prepareLocalTestCommand, runLocalTest } from "./local-test-run.js";

const createRun = (overrides: Partial<ClaimedLocalTestRun>): ClaimedLocalTestRun =>
  ({
    featurePath: "features/login.feature",
    scenarioLine: null,
    ...overrides,
  }) as ClaimedLocalTestRun;

describe("buildLocalTestCommand", () => {
  it("targets an entire feature file", () => {
    const command = buildLocalTestCommand(createRun({}));

    assert.match(command, /^npx cucumber-js --config '\/dev\/null'/);
    assert.match(command, /--require 'src\/steps\/\*\*\/\*\.ts'/);
    assert.match(command, /'features\/login\.feature'$/);
  });

  it("targets a single scenario line", () => {
    const command = buildLocalTestCommand(
      createRun({
        scenarioLine: 12,
      }),
    );

    assert.match(command, /'features\/login\.feature:12'$/);
  });

  it("quotes feature paths for shell execution", () => {
    const command = buildLocalTestCommand(
      createRun({
        featurePath: "features/customer's checkout.feature",
      }),
    );

    assert.match(command, /'features\/customer'\\''s checkout\.feature'$/);
  });

  it("prepares an isolated config path for targeted runs", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "ff2-local-test-repo-"));
    const logRoot = await mkdtemp(join(tmpdir(), "ff2-local-test-logs-"));

    try {
      const command = await prepareLocalTestCommand({
        localPath: repoRoot,
        logDir: logRoot,
        run: createRun({
          id: "prepared-run",
          scenarioLine: 12,
        }),
      });

      assert.match(command, /--config '\.\.\/ff2-local-test-logs-/);
      assert.match(command, /cucumber\.local\.cjs'/);
      assert.match(command, /'features\/login\.feature:12'$/);
      assert.equal(
        await readFile(join(logRoot, "local-test-runs", "prepared-run", "cucumber.local.cjs"), "utf8"),
        "module.exports = { default: {} };\n",
      );
    } finally {
      await Promise.all([
        rm(repoRoot, {
          force: true,
          recursive: true,
        }),
        rm(logRoot, {
          force: true,
          recursive: true,
        }),
      ]);
    }
  });
});

describe("runLocalTest", () => {
  it("fails and kills tests that exceed the timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "ff2-local-test-timeout-"));

    try {
      const result = await runLocalTest({
        command: "node -e \"setTimeout(() => {}, 5000)\"",
        localPath: root,
        logDir: root,
        runId: "timeout-run",
        timeoutMs: 25,
      });

      assert.equal(result.ok, false);
      assert.equal(result.timedOut, true);
      assert.equal(result.error, "Local test run timed out after 25ms.");
    } finally {
      await rm(root, {
        force: true,
        recursive: true,
      });
    }
  });
});
