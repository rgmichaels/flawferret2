import assert from "node:assert/strict";
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
