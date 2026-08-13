import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseApiErrorMessage, toNpmPackageName } from "./page.js";

describe("toNpmPackageName", () => {
  it("lowercases and preserves an already-valid name", () => {
    assert.equal(toNpmPackageName("my-package", "fallback"), "my-package");
  });

  it("lowercases uppercase project-derived names", () => {
    assert.equal(toNpmPackageName("TestFramework2a", "fallback"), "testframework2a");
  });

  it("replaces invalid characters and strips invalid leading characters", () => {
    assert.equal(toNpmPackageName("  My App! Name  ", "fallback"), "my-app--name");
  });

  it("sanitizes a scoped package name, preserving the scope structure", () => {
    assert.equal(toNpmPackageName("@MyOrg/My_Framework", "fallback"), "@myorg/my_framework");
  });

  it("falls back when the sanitized result would be empty", () => {
    assert.equal(toNpmPackageName("!!!", "playwright-cucumber-tests"), "playwright-cucumber-tests");
    assert.equal(toNpmPackageName("", "playwright-cucumber-tests"), "playwright-cucumber-tests");
  });

  it("truncates to 80 characters and trims trailing separators", () => {
    const long = "a".repeat(85);
    const result = toNpmPackageName(long, "fallback");
    assert.equal(result.length, 80);

    const cutOnSeparator = `${"a".repeat(79)}-b`;
    const trimmed = toNpmPackageName(cutOnSeparator, "fallback");
    assert.ok(!trimmed.endsWith("-"));
  });

  const npmPackageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

  it("keeps a valid, non-empty name segment when a long scope would otherwise consume the whole budget", () => {
    const result = toNpmPackageName(`@${"a".repeat(78)}/b`, "fallback");
    assert.ok(result.includes("/"), `expected a "/name" segment, got "${result}"`);
    assert.match(result, npmPackageNamePattern);
    assert.ok(result.length <= 80);
  });

  it("keeps a valid scope segment when a long name would otherwise consume the whole budget", () => {
    const result = toNpmPackageName(`@a/${"b".repeat(90)}`, "fallback");
    assert.ok(result.startsWith("@a/"), `expected scope "@a/" to survive, got "${result}"`);
    assert.match(result, npmPackageNamePattern);
    assert.ok(result.length <= 80);
  });

  it("produces a valid scoped name when both scope and name are long", () => {
    const result = toNpmPackageName(`@${"c".repeat(60)}/${"d".repeat(60)}`, "fallback");
    assert.match(result, npmPackageNamePattern);
    assert.ok(result.length <= 80);
    assert.ok(result.includes("/"));
  });
});

describe("parseApiErrorMessage", () => {
  it("formats a single validation issue with its field path", () => {
    const body = JSON.stringify({
      error: "ValidationError",
      issues: [{ path: ["packageName"], message: "Use a valid npm package name" }],
    });

    assert.equal(parseApiErrorMessage(body, "fallback"), "packageName: Use a valid npm package name");
  });

  it("joins multiple validation issues with newlines", () => {
    const body = JSON.stringify({
      error: "ValidationError",
      issues: [
        { path: ["packageName"], message: "Use a valid npm package name" },
        { path: ["githubOwner"], message: "Required" },
      ],
    });

    assert.equal(
      parseApiErrorMessage(body, "fallback"),
      "packageName: Use a valid npm package name\ngithubOwner: Required",
    );
  });

  it("omits the field prefix when path is empty", () => {
    const body = JSON.stringify({
      error: "ValidationError",
      issues: [{ path: [], message: "Something is wrong" }],
    });

    assert.equal(parseApiErrorMessage(body, "fallback"), "Something is wrong");
  });

  it("returns the message from an internal server error body", () => {
    const body = JSON.stringify({ error: "InternalServerError", message: "An unexpected error occurred." });

    assert.equal(parseApiErrorMessage(body, "fallback"), "An unexpected error occurred.");
  });

  it("falls back to the raw text for unrecognized JSON shapes", () => {
    const body = JSON.stringify({ something: "else" });

    assert.equal(parseApiErrorMessage(body, "fallback"), body);
  });

  it("falls back to the raw text for non-JSON bodies", () => {
    assert.equal(parseApiErrorMessage("plain text failure", "fallback"), "plain text failure");
  });

  it("falls back to the provided fallback when the body is empty", () => {
    assert.equal(parseApiErrorMessage("", "Unable to preview framework."), "Unable to preview framework.");
  });
});
