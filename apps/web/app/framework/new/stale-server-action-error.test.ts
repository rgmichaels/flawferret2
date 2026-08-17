import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isStaleServerActionError } from "./stale-server-action-error.js";

describe("isStaleServerActionError", () => {
  it("matches the error Next.js throws for an unknown Server Action id", () => {
    const error = new Error(
      'Server Action "40ce24f265f6d946d4a40394cc5583744d80f75559" was not found on the server.',
    );

    assert.equal(isStaleServerActionError(error), true);
  });

  it("matches by error name when the message is minified away", () => {
    const error = new Error("");
    error.name = "UnrecognizedActionError";

    assert.equal(isStaleServerActionError(error), true);
  });

  it("matches when only the docs link survives", () => {
    assert.equal(
      isStaleServerActionError(new Error("Read more: https://nextjs.org/docs/messages/failed-to-find-server-action")),
      true,
    );
  });

  it("does not match unrelated errors", () => {
    assert.equal(isStaleServerActionError(new Error("Failed to fetch framework preview")), false);
    assert.equal(isStaleServerActionError(new TypeError("fetch failed")), false);
  });

  it("does not match non-error values", () => {
    assert.equal(isStaleServerActionError(null), false);
    assert.equal(isStaleServerActionError(undefined), false);
    assert.equal(isStaleServerActionError("Server Action was not found"), false);
  });
});
