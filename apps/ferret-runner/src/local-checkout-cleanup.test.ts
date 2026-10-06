import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanupMergedPullRequestCheckout, decideBaseFastForward } from "./local-checkout-cleanup.js";

const repositoryLocalPath = "/tmp/flawferret-checkout";
const worktreeRoot = "/tmp/flawferret-worktrees";
const worktreePath = `${worktreeRoot}/repo-1/job-abc123`;
const headBranch = "flawferret/job-abc123";

type GitCall = {
  args: string[];
  cwd: string;
};

const createGitSpy = ({
  currentBranch = "main",
  failOn,
  status = "",
}: {
  currentBranch?: string;
  failOn?: string;
  status?: string;
} = {}) => {
  const calls: GitCall[] = [];
  const git = async (cwd: string, args: string[]) => {
    calls.push({ args, cwd });

    if (failOn && args.join(" ").startsWith(failOn)) {
      throw new Error(`${failOn} failed`);
    }

    if (args[0] === "branch" && args[1] === "--show-current") {
      return currentBranch;
    }

    if (args[0] === "status") {
      return status;
    }

    if (args[0] === "branch" && args[1] === "--list") {
      return args[2] ?? "";
    }

    return "";
  };

  return { calls, git };
};

describe("decideBaseFastForward", () => {
  it("fast-forwards only on a clean base branch", () => {
    assert.deepEqual(
      decideBaseFastForward({ baseBranch: "main", currentBranch: "main", statusPorcelain: "" }),
      { fastForward: true },
    );
  });

  it("skips when the user is on a different branch", () => {
    assert.deepEqual(
      decideBaseFastForward({ baseBranch: "main", currentBranch: "feature/x", statusPorcelain: "" }),
      { fastForward: false, reason: "wrong-branch" },
    );
  });

  it("skips when the user has a detached HEAD", () => {
    assert.deepEqual(
      decideBaseFastForward({ baseBranch: "main", currentBranch: null, statusPorcelain: "" }),
      { fastForward: false, reason: "wrong-branch" },
    );
  });

  it("skips when the base branch has uncommitted changes", () => {
    assert.deepEqual(
      decideBaseFastForward({ baseBranch: "main", currentBranch: "main", statusPorcelain: " M src/app.ts" }),
      { fastForward: false, reason: "dirty-tree" },
    );
  });
});

describe("cleanupMergedPullRequestCheckout", () => {
  it("returns an error without running git when branch metadata is missing", async () => {
    const { calls, git } = createGitSpy();

    const result = await cleanupMergedPullRequestCheckout({
      baseBranch: null,
      git,
      headBranch,
      repositoryLocalPath,
      worktreePath,
      worktreeRoot,
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
      repositoryLocalPath,
      worktreePath,
      worktreeRoot,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, "Refusing to delete a non-FlawFerret work branch.");
    assert.deepEqual(calls, []);
  });

  it("fast-forwards a clean base branch, then removes the worktree and work branch", async () => {
    const { calls, git } = createGitSpy();

    const result = await cleanupMergedPullRequestCheckout({
      baseBranch: "main",
      git,
      headBranch,
      repositoryLocalPath,
      worktreePath,
      worktreeRoot,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.fastForward, {
      attempted: true,
      currentBranch: "main",
      ok: true,
      skipped: false,
    });
    assert.equal(result.worktree?.removedWorktree, true);
    assert.equal(result.worktree?.deletedBranch, true);
    assert.equal(result.worktree?.reason, "pr-merged");
    assert.deepEqual(
      calls.map((call) => call.args),
      [
        ["branch", "--show-current"],
        ["status", "--porcelain"],
        ["pull", "--ff-only"],
        ["worktree", "remove", "--force", worktreePath],
        ["worktree", "prune"],
        ["show-ref", "--verify", "--quiet", `refs/heads/${headBranch}`],
        ["branch", "-D", headBranch],
      ],
    );
    assert.ok(calls.every((call) => call.cwd === repositoryLocalPath));
  });

  it("skips the fast-forward on a dirty tree but still removes the worktree", async () => {
    const { calls, git } = createGitSpy({ status: " M notes.txt" });

    const result = await cleanupMergedPullRequestCheckout({
      baseBranch: "main",
      git,
      headBranch,
      repositoryLocalPath,
      worktreePath,
      worktreeRoot,
    });

    assert.equal(result.ok, true);
    assert.equal(result.fastForward?.skipped, true);
    assert.equal(result.fastForward?.reason, "dirty-tree");
    assert.equal(result.fastForward?.attempted, false);
    assert.equal(result.worktree?.ok, true);
    const commands = calls.map((call) => call.args.join(" "));
    assert.ok(!commands.includes("pull --ff-only"));
    assert.ok(!commands.some((command) => /^(switch|checkout|stash|reset|clean)\b/.test(command)));
  });

  it("skips the fast-forward when the user is on another branch", async () => {
    const { calls, git } = createGitSpy({ currentBranch: "feature/mine" });

    const result = await cleanupMergedPullRequestCheckout({
      baseBranch: "main",
      git,
      headBranch,
      repositoryLocalPath,
      worktreePath,
      worktreeRoot,
    });

    assert.equal(result.ok, true);
    assert.equal(result.fastForward?.reason, "wrong-branch");
    assert.ok(!calls.some((call) => call.args[0] === "pull"));
  });

  it("records a failed fast-forward but still removes the worktree", async () => {
    const { git } = createGitSpy({ failOn: "pull" });

    const result = await cleanupMergedPullRequestCheckout({
      baseBranch: "main",
      git,
      headBranch,
      repositoryLocalPath,
      worktreePath,
      worktreeRoot,
    });

    assert.equal(result.ok, false);
    assert.equal(result.fastForward?.ok, false);
    assert.equal(result.error, "pull failed");
    assert.equal(result.worktree?.ok, true);
  });

  it("refuses to remove a worktree path outside the worktree directory", async () => {
    const { calls, git } = createGitSpy();

    const result = await cleanupMergedPullRequestCheckout({
      baseBranch: "main",
      git,
      headBranch,
      repositoryLocalPath,
      worktreePath: repositoryLocalPath,
      worktreeRoot,
    });

    assert.equal(result.ok, false);
    assert.equal(result.worktree?.removedWorktree, false);
    assert.ok(!calls.some((call) => call.args[0] === "worktree"));
  });

  it("only deletes the work branch with a non-forcing delete for runs without a worktree", async () => {
    const { calls, git } = createGitSpy();

    const result = await cleanupMergedPullRequestCheckout({
      baseBranch: "main",
      git,
      headBranch,
      repositoryLocalPath,
      worktreePath: null,
      worktreeRoot,
    });

    assert.equal(result.ok, true);
    assert.equal(result.worktree, null);
    assert.deepEqual(calls.slice(-2).map((call) => call.args), [
      ["branch", "--list", headBranch],
      ["branch", "-d", headBranch],
    ]);
  });
});
