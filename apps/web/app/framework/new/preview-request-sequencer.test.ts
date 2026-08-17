import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequestSequencer } from "./preview-request-sequencer.js";

describe("createRequestSequencer", () => {
  it("treats the only in-flight request as current", () => {
    const sequencer = createRequestSequencer();
    const token = sequencer.begin();

    assert.equal(sequencer.isStale(token), false);
  });

  it("marks an earlier token stale once a newer request has begun", () => {
    const sequencer = createRequestSequencer();
    const first = sequencer.begin();
    const second = sequencer.begin();

    assert.equal(sequencer.isStale(first), true);
    assert.equal(sequencer.isStale(second), false);
  });

  it("reflects the race scenario: an older request resolving after a newer one is dropped", () => {
    const sequencer = createRequestSequencer();

    // Simulates: destinationType effect fires an immediate fetch (token A), then the debounced
    // form "change" handler fires a second fetch (token B) ~400ms later, and the slower A response
    // arrives after the faster B response.
    const tokenA = sequencer.begin();
    const tokenB = sequencer.begin();

    // B resolves first — it's current, so its result should be applied.
    assert.equal(sequencer.isStale(tokenB), false);

    // A resolves after — it's stale, so its result must be dropped even though it arrived later.
    assert.equal(sequencer.isStale(tokenA), true);
  });
});
