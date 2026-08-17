import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FrameworkTemplateRequest } from "@flawferret2/job-schemas";
import { fetchFrameworkPreview } from "./fetch-framework-preview.js";
import { createRequestSequencer } from "./preview-request-sequencer.js";

const sampleRequest: FrameworkTemplateRequest = {
  baseUrl: "https://example.com",
  destinationType: "local",
  features: [],
  githubBranch: "main",
  githubOwner: "",
  githubRepositoryId: "",
  githubRepository: "",
  packageName: "playwright-cucumber-tests",
  projectName: "Playwright Cucumber Tests",
  targetDirectory: "qa/e2e",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// A resolved Response whose body-parsing methods (`json`/`text`) don't resolve until `release()` is
// called, so tests can control exactly when the body-parsing await completes relative to other
// requests — mirroring the real-world race where a slower request's headers/body can still finish
// downloading after a faster, newer request has already been applied.
function deferredResponse(init: { ok: boolean; body: unknown }) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const response = {
    ok: init.ok,
    async json() {
      await gate;
      return init.body;
    },
    async text() {
      await gate;
      return typeof init.body === "string" ? init.body : JSON.stringify(init.body);
    },
  } as Response;

  return { response, release };
}

describe("fetchFrameworkPreview", () => {
  it("returns success with the parsed body when the response is ok and still current", async () => {
    globalThis.fetch = (async () => {
      const { response, release } = deferredResponse({ ok: true, body: { totalFiles: 3 } });
      release();
      return response;
    }) as typeof fetch;

    const controller = new AbortController();
    const result = await fetchFrameworkPreview({
      apiUrl: "https://api.example.com",
      isStale: () => false,
      request: sampleRequest,
      signal: controller.signal,
    });

    assert.deepEqual(result, { kind: "success", preview: { totalFiles: 3 } });
  });

  it("returns error with the response text when the response is not ok", async () => {
    globalThis.fetch = (async () => {
      const { response, release } = deferredResponse({ ok: false, body: "boom" });
      release();
      return response;
    }) as typeof fetch;

    const controller = new AbortController();
    const result = await fetchFrameworkPreview({
      apiUrl: "https://api.example.com",
      isStale: () => false,
      request: sampleRequest,
      signal: controller.signal,
    });

    assert.deepEqual(result, { kind: "error", message: "boom" });
  });

  // Regression test for the race the code review flagged: `isStale()` returning false right after
  // `fetch()` resolves is not enough — the request can still go stale during the body-parsing
  // await (`.json()`/`.text()`), and that must be re-checked immediately before the result is
  // reported as a success/error, not only once up front.
  it("drops a success result that goes stale during body parsing, even though it wasn't stale when fetch() resolved", async () => {
    const { response, release } = deferredResponse({ ok: true, body: { totalFiles: 99 } });
    globalThis.fetch = (async () => response) as typeof fetch;

    let stale = false;
    const controller = new AbortController();
    const pending = fetchFrameworkPreview({
      apiUrl: "https://api.example.com",
      isStale: () => stale,
      request: sampleRequest,
      signal: controller.signal,
    });

    // Simulate a newer request superseding this one while the body is still being parsed —
    // fetch() has already resolved (isStale was false at that check), but .json() hasn't yet.
    stale = true;
    release();

    const result = await pending;
    assert.deepEqual(result, { kind: "stale" });
  });

  it("drops an error result that goes stale during body parsing", async () => {
    const { response, release } = deferredResponse({ ok: false, body: "stale failure" });
    globalThis.fetch = (async () => response) as typeof fetch;

    let stale = false;
    const controller = new AbortController();
    const pending = fetchFrameworkPreview({
      apiUrl: "https://api.example.com",
      isStale: () => stale,
      request: sampleRequest,
      signal: controller.signal,
    });

    stale = true;
    release();

    const result = await pending;
    assert.deepEqual(result, { kind: "stale" });
  });

  it("reflects the full two-request race: an older request's success is dropped once a newer request has begun and resolved", async () => {
    const sequencer = createRequestSequencer();

    const older = deferredResponse({ ok: true, body: { totalFiles: 1 } });
    const newer = deferredResponse({ ok: true, body: { totalFiles: 2 } });

    let nextResponse = older.response;
    globalThis.fetch = (async () => nextResponse) as typeof fetch;

    const tokenA = sequencer.begin();
    const pendingA = fetchFrameworkPreview({
      apiUrl: "https://api.example.com",
      isStale: () => sequencer.isStale(tokenA),
      request: sampleRequest,
      signal: new AbortController().signal,
    });

    nextResponse = newer.response;
    const tokenB = sequencer.begin();
    const pendingB = fetchFrameworkPreview({
      apiUrl: "https://api.example.com",
      isStale: () => sequencer.isStale(tokenB),
      request: sampleRequest,
      signal: new AbortController().signal,
    });

    // B (the newer request) finishes downloading its body and resolves first.
    newer.release();
    const resultB = await pendingB;
    assert.deepEqual(resultB, { kind: "success", preview: { totalFiles: 2 } });

    // A's body finishes downloading afterward — without the second staleness check, this would
    // still resolve as a success and could overwrite B's state.
    older.release();
    const resultA = await pendingA;
    assert.deepEqual(resultA, { kind: "stale" });
  });

  it("returns aborted when the fetch itself throws due to an aborted signal", async () => {
    const controller = new AbortController();
    globalThis.fetch = (async () => {
      controller.abort();
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }) as typeof fetch;

    const result = await fetchFrameworkPreview({
      apiUrl: "https://api.example.com",
      isStale: () => false,
      request: sampleRequest,
      signal: controller.signal,
    });

    assert.deepEqual(result, { kind: "aborted" });
  });

  it("returns error with the thrown message when fetch fails for a non-abort reason", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const controller = new AbortController();
    const result = await fetchFrameworkPreview({
      apiUrl: "https://api.example.com",
      isStale: () => false,
      request: sampleRequest,
      signal: controller.signal,
    });

    assert.deepEqual(result, { kind: "error", message: "network down" });
  });
});
