import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// `config.ts` parses `process.env` as a module-level side effect, so each scenario here
// mutates `process.env` and re-imports the module with a cache-busting query string to
// force a fresh `envSchema.parse(process.env)` call.
let scenario = 0;
const importConfig = () => import(`./config.js?scenario=${scenario++}`);

describe("FERRET_RUNNER_MAX_AUTO_RETRIES", () => {
  it("defaults to 2 when unset", async () => {
    delete process.env.FERRET_RUNNER_MAX_AUTO_RETRIES;

    const { config } = await importConfig();

    assert.equal(config.FERRET_RUNNER_MAX_AUTO_RETRIES, 2);
  });

  it("coerces a configured numeric string", async () => {
    process.env.FERRET_RUNNER_MAX_AUTO_RETRIES = "5";

    const { config } = await importConfig();

    assert.equal(config.FERRET_RUNNER_MAX_AUTO_RETRIES, 5);

    delete process.env.FERRET_RUNNER_MAX_AUTO_RETRIES;
  });

  it("allows a configured value of 0 (auto-heal disabled)", async () => {
    process.env.FERRET_RUNNER_MAX_AUTO_RETRIES = "0";

    const { config } = await importConfig();

    assert.equal(config.FERRET_RUNNER_MAX_AUTO_RETRIES, 0);

    delete process.env.FERRET_RUNNER_MAX_AUTO_RETRIES;
  });

  it("rejects a negative configured value", async () => {
    process.env.FERRET_RUNNER_MAX_AUTO_RETRIES = "-1";

    await assert.rejects(() => importConfig());

    delete process.env.FERRET_RUNNER_MAX_AUTO_RETRIES;
  });
});

describe("worktree and install settings", () => {
  it("defaults the worktree directory to ~/.flawferret/worktrees", async () => {
    delete process.env.FERRET_RUNNER_WORKTREE_DIR;

    const { config } = await importConfig();

    assert.equal(config.FERRET_RUNNER_WORKTREE_DIR, join(homedir(), ".flawferret", "worktrees"));
  });

  it("treats an empty worktree directory as unset", async () => {
    process.env.FERRET_RUNNER_WORKTREE_DIR = "  ";

    const { config } = await importConfig();

    assert.equal(config.FERRET_RUNNER_WORKTREE_DIR, join(homedir(), ".flawferret", "worktrees"));

    delete process.env.FERRET_RUNNER_WORKTREE_DIR;
  });

  it("expands a leading ~ in a configured worktree directory", async () => {
    process.env.FERRET_RUNNER_WORKTREE_DIR = "~/ff-worktrees";

    const { config } = await importConfig();

    assert.equal(config.FERRET_RUNNER_WORKTREE_DIR, join(homedir(), "ff-worktrees"));

    delete process.env.FERRET_RUNNER_WORKTREE_DIR;
  });

  it("defaults retention to 24 hours, the sweep to 1 hour, and install timeout to 5 minutes", async () => {
    delete process.env.FERRET_RUNNER_WORKTREE_RETENTION_HOURS;
    delete process.env.FERRET_RUNNER_WORKTREE_SWEEP_INTERVAL_MS;
    delete process.env.FERRET_RUNNER_INSTALL_TIMEOUT_MS;
    delete process.env.FERRET_RUNNER_INSTALL_COMMAND;

    const { config } = await importConfig();

    assert.equal(config.FERRET_RUNNER_WORKTREE_RETENTION_HOURS, 24);
    assert.equal(config.FERRET_RUNNER_WORKTREE_SWEEP_INTERVAL_MS, 60 * 60 * 1000);
    assert.equal(config.FERRET_RUNNER_INSTALL_TIMEOUT_MS, 5 * 60 * 1000);
    assert.equal(config.FERRET_RUNNER_INSTALL_COMMAND, undefined);
  });

  it("rejects a non-positive retention window", async () => {
    process.env.FERRET_RUNNER_WORKTREE_RETENTION_HOURS = "0";

    await assert.rejects(() => importConfig());

    delete process.env.FERRET_RUNNER_WORKTREE_RETENTION_HOURS;
  });
});
