import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { pickFolder } from "./pick-folder.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const jsonResponse = (init: { ok: boolean; body: unknown }) =>
  ({
    ok: init.ok,
    async json() {
      return init.body;
    },
  }) as Response;

describe("pickFolder", () => {
  it("returns success with the chosen path when the response is ok", async () => {
    globalThis.fetch = (async () => jsonResponse({ ok: true, body: { path: "/Users/rob/e2e" } })) as typeof fetch;

    const result = await pickFolder({ apiUrl: "https://api.example.com" });

    assert.deepEqual(result, { kind: "success", path: "/Users/rob/e2e" });
  });

  it("returns the server-provided error message when the response is not ok", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ ok: false, body: { message: "Folder selection was cancelled." } })) as typeof fetch;

    const result = await pickFolder({ apiUrl: "https://api.example.com" });

    assert.deepEqual(result, { kind: "error", message: "Folder selection was cancelled." });
  });

  it("falls back to a generic message when the response is ok but has no path", async () => {
    globalThis.fetch = (async () => jsonResponse({ ok: true, body: {} })) as typeof fetch;

    const result = await pickFolder({ apiUrl: "https://api.example.com" });

    assert.deepEqual(result, { kind: "error", message: "No folder was selected." });
  });

  it("falls back to a generic message when fetch throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const result = await pickFolder({ apiUrl: "https://api.example.com" });

    assert.deepEqual(result, { kind: "error", message: "network down" });
  });
});
