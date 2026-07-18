import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getJobGoal, getJobTitle, sendSlackNotification, shortJobId } from "./index.js";

describe("shared helpers", () => {
  it("formats short job ids", () => {
    assert.equal(shortJobId("12345678-90ab-cdef"), "#12345678");
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
