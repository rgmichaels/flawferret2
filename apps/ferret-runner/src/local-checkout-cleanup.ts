import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type LocalCheckoutCleanupResult = {
  baseBranch: string | null;
  deletedBranch: boolean;
  error?: string;
  headBranch: string | null;
  localPath: string;
  ok: boolean;
  pruned: boolean;
  switchedToBase: boolean;
  updatedBase: boolean;
};

const runGit = async (localPath: string, args: string[]) => {
  const { stdout } = await execFileAsync("git", ["-C", localPath, ...args], {
    maxBuffer: 1024 * 1024,
  });

  return stdout.trim();
};

const isFlawFerretBranch = (branch: string | null) =>
  Boolean(branch?.startsWith("flawferret/job-"));

export const cleanupMergedPullRequestCheckout = async ({
  baseBranch,
  headBranch,
  localPath,
}: {
  baseBranch: string | null;
  headBranch: string | null;
  localPath: string;
}): Promise<LocalCheckoutCleanupResult> => {
  const result: LocalCheckoutCleanupResult = {
    baseBranch,
    deletedBranch: false,
    headBranch,
    localPath,
    ok: false,
    pruned: false,
    switchedToBase: false,
    updatedBase: false,
  };

  if (!baseBranch || !headBranch) {
    return {
      ...result,
      error: "Missing base or head branch for local checkout cleanup.",
    };
  }

  if (!isFlawFerretBranch(headBranch)) {
    return {
      ...result,
      error: "Refusing to delete a non-FlawFerret work branch.",
    };
  }

  try {
    await runGit(localPath, ["switch", baseBranch]);
    result.switchedToBase = true;

    await runGit(localPath, ["pull", "--ff-only"]);
    result.updatedBase = true;

    await runGit(localPath, ["fetch", "--prune"]);
    result.pruned = true;

    const matchingLocalBranch = await runGit(localPath, ["branch", "--list", headBranch]);
    if (matchingLocalBranch.length === 0) {
      result.deletedBranch = true;
      return {
        ...result,
        ok: true,
      };
    }

    await runGit(localPath, ["branch", "-d", headBranch]);
    result.deletedBranch = true;

    return {
      ...result,
      ok: true,
    };
  } catch (error) {
    return {
      ...result,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
