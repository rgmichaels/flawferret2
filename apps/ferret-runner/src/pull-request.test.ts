import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAutoRetryRunMetadata,
  decideAutoRetryOutcome,
  fetchFailingCheckLogs,
  type FetchFailingCheckLogsResult,
} from "./pull-request.js";

const localPath = "/tmp/flawferret-checkout";
const prUrl = "https://github.com/rgmichaels/example/pull/42";

type GhCall = {
  args: string[];
  localPath: string;
};

const createGhSpy = (responses: Array<string | Error>) => {
  const calls: GhCall[] = [];
  const run = async (command: string, args: string[], cwd: string) => {
    calls.push({ args: [command, ...args], localPath: cwd });
    const next = responses.shift();

    if (next === undefined) {
      throw new Error("No more scripted gh responses.");
    }

    if (next instanceof Error) {
      throw next;
    }

    return next;
  };

  return { calls, run };
};

describe("fetchFailingCheckLogs", () => {
  it("falls back to BLOCKED behavior when enumerating checks fails", async () => {
    const { calls, run } = createGhSpy([new Error("gh: rate limit exceeded")]);

    const result = await fetchFailingCheckLogs({ localPath, prUrl, run });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /enumerate/i);
      assert.equal(result.metadata.error, "gh: rate limit exceeded");
    }
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, [
      "gh",
      "pr",
      "checks",
      prUrl,
      "--json",
      "name,state,link,bucket",
    ]);
  });

  it("fails when gh pr checks returns unparseable output", async () => {
    const { run } = createGhSpy(["not json"]);

    const result = await fetchFailingCheckLogs({ localPath, prUrl, run });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /parse/i);
    }
  });

  it("fails when there are no failing checks to report", async () => {
    const { run } = createGhSpy([
      JSON.stringify([{ bucket: "pass", name: "unit tests", state: "SUCCESS" }]),
    ]);

    const result = await fetchFailingCheckLogs({ localPath, prUrl, run });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /no failing checks/i);
    }
  });

  it("fetches Actions logs for failing checks with an extractable run id", async () => {
    const checksJson = JSON.stringify([
      {
        bucket: "fail",
        link: "https://github.com/rgmichaels/example/actions/runs/123456/job/999",
        name: "unit tests",
        state: "FAILURE",
      },
    ]);
    const { calls, run } = createGhSpy([checksJson, "Error: expected true to equal false"]);

    const result = await fetchFailingCheckLogs({ localPath, prUrl, run });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.metadata.checkNames, ["unit tests"]);
      assert.match(result.metadata.feedback, /unit tests/);
      assert.match(result.metadata.feedback, /expected true to equal false/);
      assert.equal(result.metadata.checks[0].source, "actions-log");
    }
    assert.deepEqual(calls[1].args, ["gh", "run", "view", "123456", "--log-failed"]);
  });

  it("falls back to the details URL for checks with no extractable run id", async () => {
    const checksJson = JSON.stringify([
      {
        bucket: "fail",
        link: "https://thirdparty.example.com/checks/abc",
        name: "third-party lint",
        state: "FAILURE",
      },
    ]);
    const { run } = createGhSpy([checksJson]);

    const result = await fetchFailingCheckLogs({ localPath, prUrl, run });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.metadata.checks[0].source, "details-url-fallback");
      assert.match(result.metadata.feedback, /thirdparty\.example\.com/);
    }
  });

  it("fairly bounds each check's contribution to feedback so no single check dominates with 3+ failing checks", async () => {
    const checksJson = JSON.stringify([
      {
        bucket: "fail",
        link: "https://github.com/rgmichaels/example/actions/runs/1/job/1",
        name: "check-one",
        state: "FAILURE",
      },
      {
        bucket: "fail",
        link: "https://github.com/rgmichaels/example/actions/runs/2/job/2",
        name: "check-two",
        state: "FAILURE",
      },
      {
        bucket: "fail",
        link: "https://github.com/rgmichaels/example/actions/runs/3/job/3",
        name: "check-three",
        state: "FAILURE",
      },
    ]);
    // The first check's log is huge on its own (well over the whole feedback budget);
    // the other two are short. A front-truncated concatenation would let this log
    // alone consume the entire budget and silently drop check-two/check-three.
    const hugeLog = "x".repeat(20000);
    const { run } = createGhSpy([
      checksJson,
      hugeLog,
      "check-two failure output",
      "check-three failure output",
    ]);

    const result = await fetchFailingCheckLogs({ localPath, prUrl, run });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.deepEqual(result.metadata.checkNames, ["check-one", "check-two", "check-three"]);
    assert.match(result.metadata.feedback, /check-one/);
    assert.match(result.metadata.feedback, /check-two/);
    assert.match(result.metadata.feedback, /check-two failure output/);
    assert.match(result.metadata.feedback, /check-three/);
    assert.match(result.metadata.feedback, /check-three failure output/);
    // The full (untruncated) per-check detail is still preserved in `checks`.
    assert.equal(result.metadata.checks[0].detail, hugeLog);
    // The concatenated feedback stays within a bounded size instead of growing
    // unbounded with the first check's log.
    assert.equal(result.metadata.feedback.length < 5000, true);
  });

  it("redistributes unused budget from short checks to a check that needs more room", async () => {
    const checksJson = JSON.stringify([
      {
        bucket: "fail",
        link: "https://thirdparty.example.com/checks/short-one",
        name: "short-fallback-one",
        state: "FAILURE",
      },
      {
        bucket: "fail",
        link: "https://thirdparty.example.com/checks/short-two",
        name: "short-fallback-two",
        state: "FAILURE",
      },
      {
        bucket: "fail",
        link: "https://github.com/rgmichaels/example/actions/runs/9/job/9",
        name: "big-actions-log",
        state: "FAILURE",
      },
    ]);
    // The two fallback checks each produce a short, fixed-length message (no gh call
    // needed to fetch it), well under an even three-way split of the budget. The
    // Actions-log check's log is much larger than an even split would allow.
    const hugeLog = "y".repeat(3000);
    const { run } = createGhSpy([checksJson, hugeLog]);

    const result = await fetchFailingCheckLogs({ localPath, prUrl, run });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    const naiveEvenShare = Math.floor(4000 / 3);
    const bigCheckDetail = result.metadata.checks.find((check) => check.name === "big-actions-log");
    assert.ok(bigCheckDetail);

    const bigCheckSection = result.metadata.feedback.split("## big-actions-log")[1];
    assert.ok(bigCheckSection);
    // The redistributed allocation lets the big check keep (most of) its full log,
    // well beyond what a naive even three-way split (~1333 chars) would allow.
    assert.ok(bigCheckSection.length > naiveEvenShare * 2);
    // Both short checks are still fully present (no starvation from the redistribution).
    assert.match(result.metadata.feedback, /short-fallback-one/);
    assert.match(result.metadata.feedback, /short-fallback-two/);
    assert.match(
      result.metadata.feedback,
      /No GitHub Actions log is available for this check\. Details: https:\/\/thirdparty\.example\.com\/checks\/short-one/,
    );
    assert.match(
      result.metadata.feedback,
      /No GitHub Actions log is available for this check\. Details: https:\/\/thirdparty\.example\.com\/checks\/short-two/,
    );
  });

  it("fails the whole fetch when a per-check log fetch fails", async () => {
    const checksJson = JSON.stringify([
      {
        bucket: "fail",
        link: "https://github.com/rgmichaels/example/actions/runs/123456/job/999",
        name: "unit tests",
        state: "FAILURE",
      },
    ]);
    const { run } = createGhSpy([checksJson, new Error("run not found")]);

    const result = await fetchFailingCheckLogs({ localPath, prUrl, run });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /unit tests/);
      assert.equal(result.metadata.error, "run not found");
    }
  });
});

describe("decideAutoRetryOutcome", () => {
  const successfulFetch: FetchFailingCheckLogsResult = {
    ok: true,
    metadata: {
      checkNames: ["unit tests"],
      checks: [],
      feedback: "unit tests failed",
    },
  };
  const failedFetch: FetchFailingCheckLogsResult = {
    ok: false,
    message: "Failed to enumerate pull request checks via gh.",
    metadata: {
      error: "gh: rate limit exceeded",
      prUrl: "https://github.com/rgmichaels/example/pull/42",
    },
  };

  it("retries when under budget and the fetch succeeded", () => {
    const decision = decideAutoRetryOutcome({
      autoRetryCount: 0,
      fetchResult: successfulFetch,
      maxAutoRetries: 2,
    });

    assert.deepEqual(decision, { outcome: "retry" });
  });

  it("reports budget-exhausted once the counter reaches the max, even if the fetch would have succeeded", () => {
    const decision = decideAutoRetryOutcome({
      autoRetryCount: 2,
      fetchResult: successfulFetch,
      maxAutoRetries: 2,
    });

    assert.deepEqual(decision, { outcome: "budget-exhausted" });
  });

  it("reports budget-exhausted when the counter exceeds the max", () => {
    const decision = decideAutoRetryOutcome({
      autoRetryCount: 3,
      fetchResult: null,
      maxAutoRetries: 2,
    });

    assert.deepEqual(decision, { outcome: "budget-exhausted" });
  });

  it("reports fetch-failed when under budget but gh failed to fetch check logs", () => {
    const decision = decideAutoRetryOutcome({
      autoRetryCount: 0,
      fetchResult: failedFetch,
      maxAutoRetries: 2,
    });

    assert.deepEqual(decision, {
      outcome: "fetch-failed",
      reason: "Failed to enumerate pull request checks via gh.",
    });
  });

  it("reports fetch-failed when under budget but no fetch was attempted", () => {
    const decision = decideAutoRetryOutcome({
      autoRetryCount: 0,
      fetchResult: null,
      maxAutoRetries: 2,
    });

    assert.equal(decision.outcome, "fetch-failed");
  });

  it("checks the budget before consulting the fetch result (0 max retries disables auto-heal)", () => {
    const decision = decideAutoRetryOutcome({
      autoRetryCount: 0,
      fetchResult: successfulFetch,
      maxAutoRetries: 0,
    });

    assert.deepEqual(decision, { outcome: "budget-exhausted" });
  });
});

describe("buildAutoRetryRunMetadata", () => {
  it("clears validation/pullRequest metadata and writes retryFeedback in the manual-retry shape", () => {
    const runMetadata = {
      codex: { finalResponse: "done" },
      pullRequest: { prUrl: "https://github.com/rgmichaels/example/pull/42" },
      validation: { exitCode: 1 },
    };

    const result = buildAutoRetryRunMetadata({
      feedback: "Test failed: expected true to equal false",
      previousRunStatus: "FAILED",
      previousStatus: "PR_CREATED",
      runMetadata,
    }) as Record<string, unknown>;

    assert.equal("pullRequest" in result, false);
    assert.equal("validation" in result, false);
    assert.deepEqual(result.codex, { finalResponse: "done" });
    assert.deepEqual(result.retryFeedback, {
      createdAt: (result.retryFeedback as { createdAt: string }).createdAt,
      feedback: "Test failed: expected true to equal false",
      previousRunStatus: "FAILED",
      previousStatus: "PR_CREATED",
    });
  });
});
