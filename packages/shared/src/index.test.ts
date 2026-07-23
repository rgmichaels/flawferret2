import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  getConfiguredModelPromptPreface,
  getJobGoal,
  getJobTitle,
  MODEL_PROMPT_PREFACE_CONFIG_PATH,
  sendSlackNotification,
  shortJobId,
  TEST_ARCHITECT_PROMPT_PREFACE,
} from "./index.js";

describe("shared helpers", () => {
  it("formats short job ids", () => {
    assert.equal(shortJobId("12345678-90ab-cdef"), "#12345678");
  });

  it("exposes the model prompt preface without UI-specific wording", () => {
    assert.match(TEST_ARCHITECT_PROMPT_PREFACE, /principal Software Development Engineer in Test/);
    assert.match(TEST_ARCHITECT_PROMPT_PREFACE, /long-term test reliability/);
  });

  it("loads model prompt preface from the default config file", () => {
    const configuredPreface = getConfiguredModelPromptPreface();

    assert.match(configuredPreface, /principal Software Development Engineer in Test/);
    assert.match(configuredPreface, /Engineering Principles/);
    assert.match(configuredPreface, /Never introduce brittle waits or arbitrary sleeps/);
  });

  it("loads model prompt preface from environment overrides", () => {
    assert.equal(
      getConfiguredModelPromptPreface({
        env: {
          FF2_MODEL_PROMPT_PREFACE: "Custom direct preface.",
        },
      }),
      "Custom direct preface.",
    );
  });

  it("loads model prompt preface from configured files and falls back safely", () => {
    const root = mkdtempSync(join(tmpdir(), "ff2-prompt-preface-"));
    const nested = join(root, "apps", "api");
    const defaultPath = join(root, MODEL_PROMPT_PREFACE_CONFIG_PATH);
    const customPath = join(root, "custom-preface.txt");

    try {
      mkdirSync(join(root, "config"), {
        recursive: true,
      });
      writeFileSync(defaultPath, "Default file preface.\n");
      writeFileSync(customPath, "Custom file preface.\n");

      assert.equal(
        getConfiguredModelPromptPreface({
          cwd: nested,
          env: {},
        }),
        "Default file preface.",
      );
      assert.equal(
        getConfiguredModelPromptPreface({
          cwd: root,
          env: {
            FF2_MODEL_PROMPT_PREFACE_PATH: customPath,
          },
        }),
        "Custom file preface.",
      );
      assert.equal(
        getConfiguredModelPromptPreface({
          cwd: root,
          env: {
            FF2_MODEL_PROMPT_PREFACE_PATH: "missing.txt",
          },
        }),
        TEST_ARCHITECT_PROMPT_PREFACE,
      );
    } finally {
      rmSync(root, {
        force: true,
        recursive: true,
      });
    }
  });

  it("derives job titles and goals from payloads", () => {
    assert.equal(getJobTitle({ featureArea: " Login ", goal: "Goal" }), "Login");
    assert.equal(getJobTitle({ goal: " Add coverage " }), "Add coverage");
    assert.equal(getJobTitle(null), "Untitled job");
    assert.equal(getJobGoal({ goal: " Add coverage " }), "Add coverage");
    assert.equal(getJobGoal({}), null);
  });

  it("reports unconfigured Slack without sending", async () => {
    assert.deepEqual(await sendSlackNotification({ text: "hello" }), {
      reason: "not_configured",
      sent: false,
    });
  });
});
