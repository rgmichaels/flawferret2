import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  isFlawFerretWorkBranch,
  removeJobWorktree,
  type GitRunner,
  type WorktreeRemovalResult,
} from "./worktree.js";

const execFileAsync = promisify(execFile);

export type BaseFastForwardDecision =
  | { fastForward: true }
  | { fastForward: false; reason: "dirty-tree" | "wrong-branch" };

export type BaseFastForwardResult = {
  attempted: boolean;
  currentBranch: string | null;
  error?: string;
  ok: boolean;
  reason?: "dirty-tree" | "wrong-branch";
  skipped: boolean;
};

export type LocalCheckoutCleanupResult = {
  baseBranch: string | null;
  error?: string;
  fastForward: BaseFastForwardResult | null;
  headBranch: string | null;
  ok: boolean;
  repositoryLocalPath: string;
  worktree: WorktreeRemovalResult | null;
  worktreePath: string | null;
};

const runGit: GitRunner = async (localPath, args) => {
  const { stdout } = await execFileAsync("git", ["-C", localPath, ...args], {
    maxBuffer: 1024 * 1024,
  });

  return stdout.trim();
};

// The user's checkout is only ever fast-forwarded, and only when they are sitting on
// the base branch with nothing uncommitted. Anything else is skipped, never forced.
export const decideBaseFastForward = ({
  baseBranch,
  currentBranch,
  statusPorcelain,
}: {
  baseBranch: string;
  currentBranch: string | null;
  statusPorcelain: string;
}): BaseFastForwardDecision => {
  if (!currentBranch || currentBranch !== baseBranch) {
    return { fastForward: false, reason: "wrong-branch" };
  }

  if (statusPorcelain.trim().length > 0) {
    return { fastForward: false, reason: "dirty-tree" };
  }

  return { fastForward: true };
};

const fastForwardBaseBranch = async ({
  baseBranch,
  git,
  repositoryLocalPath,
}: {
  baseBranch: string;
  git: GitRunner;
  repositoryLocalPath: string;
}): Promise<BaseFastForwardResult> => {
  let currentBranch: string | null = null;

  try {
    currentBranch = (await git(repositoryLocalPath, ["branch", "--show-current"])) || null;
    const statusPorcelain = await git(repositoryLocalPath, ["status", "--porcelain"]);
    const decision = decideBaseFastForward({ baseBranch, currentBranch, statusPorcelain });

    if (!decision.fastForward) {
      return {
        attempted: false,
        currentBranch,
        ok: true,
        reason: decision.reason,
        skipped: true,
      };
    }

    await git(repositoryLocalPath, ["pull", "--ff-only"]);

    return {
      attempted: true,
      currentBranch,
      ok: true,
      skipped: false,
    };
  } catch (error) {
    return {
      attempted: true,
      currentBranch,
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      skipped: false,
    };
  }
};

export const cleanupMergedPullRequestCheckout = async ({
  baseBranch,
  git = runGit,
  headBranch,
  repositoryLocalPath,
  worktreePath,
  worktreeRoot,
}: {
  baseBranch: string | null;
  git?: GitRunner;
  headBranch: string | null;
  repositoryLocalPath: string;
  worktreePath: string | null;
  worktreeRoot: string;
}): Promise<LocalCheckoutCleanupResult> => {
  const result: LocalCheckoutCleanupResult = {
    baseBranch,
    fastForward: null,
    headBranch,
    ok: false,
    repositoryLocalPath,
    worktree: null,
    worktreePath,
  };

  if (!baseBranch || !headBranch) {
    return {
      ...result,
      error: "Missing base or head branch for local checkout cleanup.",
    };
  }

  if (!isFlawFerretWorkBranch(headBranch)) {
    return {
      ...result,
      error: "Refusing to delete a non-FlawFerret work branch.",
    };
  }

  result.fastForward = await fastForwardBaseBranch({
    baseBranch,
    git,
    repositoryLocalPath,
  });

  if (worktreePath) {
    result.worktree = await removeJobWorktree({
      git,
      reason: "pr-merged",
      repositoryLocalPath,
      workBranch: headBranch,
      worktreePath,
      worktreeRoot,
    });
  } else {
    // Runs prepared before worktrees existed only have a work branch in the user's
    // checkout; keep the old non-forcing `branch -d` so unmerged local commits survive.
    try {
      const matchingLocalBranch = await git(repositoryLocalPath, ["branch", "--list", headBranch]);

      if (matchingLocalBranch.length > 0) {
        await git(repositoryLocalPath, ["branch", "-d", headBranch]);
      }
    } catch (error) {
      return {
        ...result,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const errors = [result.fastForward.error, result.worktree?.error].filter(
    (error): error is string => Boolean(error),
  );

  return {
    ...result,
    ...(errors.length > 0 ? { error: errors.join("\n") } : {}),
    ok: errors.length === 0,
  };
};
