import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClaimedCodexJob } from "@flawferret2/db";
import { buildCodexPrompt } from "./codex-invocation.js";

const buildJob = (payloadOverrides: Record<string, unknown> = {}): ClaimedCodexJob => {
  return {
    repository: { owner: "rgmichaels", name: "example" },
    runs: [{ metadata: { workBranch: "flawferret2/job-123" } }],
    payload: {
      targetBranch: "main",
      featureArea: "Checkout",
      goal: "Add coverage for the checkout button",
      acceptanceCriteria: "Given a cart with items, when I click checkout, then the order confirms.",
      runAffectedTests: true,
      ...payloadOverrides,
    },
  } as unknown as ClaimedCodexJob;
};

describe("buildCodexPrompt", () => {
  it("is byte-for-byte unchanged when captureContext is absent", () => {
    const withoutCaptureContext = buildCodexPrompt(buildJob());
    const withEmptyCaptureContext = buildCodexPrompt(
      buildJob({ captureContext: { consoleErrors: [], networkEvents: [] } })
    );

    assert.equal(withoutCaptureContext, withEmptyCaptureContext);
    assert.doesNotMatch(withoutCaptureContext, /Console errors:/);
    assert.doesNotMatch(withoutCaptureContext, /Network events:/);
    assert.doesNotMatch(withoutCaptureContext, /Captured console\/network signal/);
  });

  it("adds a labeled console errors section after Acceptance criteria when present", () => {
    const prompt = buildCodexPrompt(
      buildJob({
        captureContext: {
          consoleErrors: ["console.error: Cannot read properties of null"],
          networkEvents: [],
        },
      })
    );

    assert.match(prompt, /Captured console\/network signal from the reporter's browser session:/);
    assert.match(prompt, /Console errors:\n- console\.error: Cannot read properties of null/);
    assert.doesNotMatch(prompt, /Network events:/);

    const acceptanceIndex = prompt.indexOf("Acceptance criteria:");
    const captureIndex = prompt.indexOf("Captured console/network signal");
    assert.ok(acceptanceIndex >= 0 && captureIndex > acceptanceIndex);
  });

  it("adds a labeled network events section after Acceptance criteria when present", () => {
    const prompt = buildCodexPrompt(
      buildJob({
        captureContext: {
          consoleErrors: [],
          networkEvents: ["GET https://api.example.com/orders -> 500 Internal Server Error"],
        },
      })
    );

    assert.match(prompt, /Network events:\n- GET https:\/\/api\.example\.com\/orders -> 500 Internal Server Error/);
    assert.doesNotMatch(prompt, /Console errors:/);
  });

  it("includes both sections when both console errors and network events are present", () => {
    const prompt = buildCodexPrompt(
      buildJob({
        captureContext: {
          consoleErrors: ["console.error: boom"],
          networkEvents: ["POST /api/checkout -> rejected: Failed to fetch"],
        },
      })
    );

    assert.match(prompt, /Console errors:\n- console\.error: boom/);
    assert.match(prompt, /Network events:\n- POST \/api\/checkout -> rejected: Failed to fetch/);
  });
});
