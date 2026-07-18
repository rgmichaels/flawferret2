import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanupMergedPullRequestCheckout } from "./local-checkout-cleanup.js";

const localPath = "/tmp/flawferret-checkout";

type GitCall = {
  args: string[];
  localPath: string;
};

const createGitSpy = (responses: string[] = []) => {
  const calls: GitCall[] = [];
  const git = async (path: string, args: string[]) => {
    calls.push({ args, localPath: path });
    return responses.shift() ?? "";
  };

  return { calls, git };
};

describe("cleanupMergedPullRequestCheckout", () => {
  it("returns an error without running git when branch metadata is missing", async () => {
    const { calls, git } = createGitSpy();

    const result = await cleanupMergedPullRequestCheckout({
      baseBranch: null,
      git,
      headBranch: "flawferret/job-abc123",
      localPath,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, "Missing base or head branch for local checkout cleanup.");
    assert.deepEqual(calls, []);
  });

  it("refuses to delete non-FlawFerret branches without running git", async () => {
    const { calls, git } = createGitSpy();

    const result = await cleanupMergedPullRequestCheckout({
      baseBranch: "main",
      git,
      headBranch: "feature/customer-login",
      localPath,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, "Refusing to delete a non-FlawFerret work branch.");
    assert.deepEqual(calls, []);
  });

  it("treats an already absent generated branch as cleaned up", async () => {
    const { calls, git } = createGitSpy(["", "", "", ""]);

    const result = await cleanupMergedPullRequestCheckout({
      baseBranch: "main",
      git,
      headBranch: "flawferret/job-abc123",
      localPath,
    });

    assert.deepEqual(result, {
      baseBranch: "main",
      deletedBranch: true,
      headBranch: "flawferret/job-abc123",
      localPath,
      ok: true,
      pruned: true,
      switchedToBase: true,
      updatedBase: true,
    });
    assert.deepEqual(
      calls.map((call) => call.args),
      [
        ["switch", "main"],
        ["pull", "--ff-only"],
        ["fetch", "--prune"],
        ["branch", "--list", "flawferret/job-abc123"],
      ],
    );
  });

  it("deletes a matching local generated branch after updating and pruning", async () => {
    const { calls, git } = createGitSpy(["", "", "", "flawferret/job-abc123", ""]);

    const result = await cleanupMergedPullRequestCheckout({
      baseBranch: "main",
      git,
      headBranch: "flawferret/job-abc123",
      localPath,
    });

    assert.equal(result.ok, true);
    assert.equal(result.deletedBranch, true);
    assert.deepEqual(
      calls.map((call) => call.args),
      [
        ["switch", "main"],
        ["pull", "--ff-only"],
        ["fetch", "--prune"],
        ["branch", "--list", "flawferret/job-abc123"],
        ["branch", "-d", "flawferret/job-abc123"],
      ],
    );
  });

  it("returns partial progress when a git command fails", async () => {
    const calls: GitCall[] = [];
    const git = async (path: string, args: string[]) => {
      calls.push({ args, localPath: path });

      if (args[0] === "fetch") {
        throw new Error("fetch failed");
      }

      return "";
    };

    const result = await cleanupMergedPullRequestCheckout({
      baseBranch: "main",
      git,
      headBranch: "flawferret/job-abc123",
      localPath,
    });

    assert.equal(result.ok, false);
    assert.equal(result.switchedToBase, true);
    assert.equal(result.updatedBase, true);
    assert.equal(result.pruned, false);
    assert.equal(result.deletedBranch, false);
    assert.equal(result.error, "fetch failed");
    assert.deepEqual(
      calls.map((call) => call.args),
      [
        ["switch", "main"],
        ["pull", "--ff-only"],
        ["fetch", "--prune"],
      ],
    );
  });
});
