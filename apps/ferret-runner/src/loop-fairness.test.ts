import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextLoopIteration, shouldPrioritizeQueuedClaim } from "./loop-fairness.js";

const runIterations = (count: number, fairnessN: number) => {
  const decisions: boolean[] = [];
  let iteration = 0;

  for (let index = 0; index < count; index += 1) {
    iteration = nextLoopIteration(iteration, fairnessN);
    decisions.push(shouldPrioritizeQueuedClaim(iteration, fairnessN));
  }

  return decisions;
};

describe("shouldPrioritizeQueuedClaim", () => {
  it("prioritizes the queued claim on every Nth iteration", () => {
    assert.deepEqual(runIterations(6, 3), [false, false, true, false, false, true]);
  });

  it("always prioritizes the queued claim when N is 1", () => {
    assert.deepEqual(runIterations(4, 1), [true, true, true, true]);
  });

  it("prioritizes the queued claim exactly once per cycle for a large N", () => {
    const decisions = runIterations(250, 100);

    assert.equal(
      decisions.filter(Boolean).length,
      2,
      "expected two queued-claim iterations across 250 loops with N=100",
    );
    assert.equal(decisions[99], true);
    assert.equal(decisions[199], true);
  });

  it("guarantees a queued claim attempt at least every N iterations", () => {
    for (const fairnessN of [1, 2, 3, 5, 7]) {
      const decisions = runIterations(fairnessN * 4, fairnessN);
      let sinceLastQueuedClaim = 0;

      for (const prioritized of decisions) {
        sinceLastQueuedClaim = prioritized ? 0 : sinceLastQueuedClaim + 1;
        assert.ok(
          sinceLastQueuedClaim < fairnessN,
          `queued claim starved for ${sinceLastQueuedClaim} iterations with N=${fairnessN}`,
        );
      }
    }
  });

  it("falls back to prioritizing queued jobs for nonsensical fairness values", () => {
    assert.equal(shouldPrioritizeQueuedClaim(1, 0), true);
    assert.equal(shouldPrioritizeQueuedClaim(1, -5), true);
    assert.equal(shouldPrioritizeQueuedClaim(1, Number.NaN), true);
  });
});

describe("nextLoopIteration", () => {
  it("cycles through 1..N instead of growing without bound", () => {
    let iteration = 0;
    const seen: number[] = [];

    for (let index = 0; index < 7; index += 1) {
      iteration = nextLoopIteration(iteration, 3);
      seen.push(iteration);
    }

    assert.deepEqual(seen, [1, 2, 3, 1, 2, 3, 1]);
  });

  it("stays within the cycle when handed an overflow-adjacent counter", () => {
    const iteration = nextLoopIteration(Number.MAX_SAFE_INTEGER, 3);

    assert.ok(Number.isSafeInteger(iteration));
    assert.ok(iteration >= 1 && iteration <= 3);
  });

  it("never leaves the cycle for non-finite or negative counters", () => {
    assert.equal(nextLoopIteration(Number.NaN, 3), 1);
    assert.equal(nextLoopIteration(-10, 3), 1);
    assert.equal(nextLoopIteration(2, 1), 1);
  });
});
