import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_QUEUE_CONTROL_ID } from "./index.js";

describe("db exports", () => {
  it("uses a stable default queue control id", () => {
    assert.equal(DEFAULT_QUEUE_CONTROL_ID, "default");
  });
});
