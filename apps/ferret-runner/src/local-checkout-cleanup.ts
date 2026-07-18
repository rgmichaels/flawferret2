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

type GitRunner = (localPath: string, args: string[]) => Promise<string>;

const runGit: GitRunner = async (localPath, args) => {
  const { stdout } = await execFileAsync("git", ["-C", localPath, ...args], {
    maxBuffer: 1024 * 1024,
  });

  return stdout.trim();
};

const isFlawFerretBranch = (branch: string | null) =>
  Boolean(branch?.startsWith("flawferret/job-"));

export const cleanupMergedPullRequestCheckout = async ({
  baseBranch,
  git = runGit,
  headBranch,
  localPath,
}: {
  baseBranch: string | null;
  git?: GitRunner;
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
    await git(localPath, ["switch", baseBranch]);
    result.switchedToBase = true;

    await git(localPath, ["pull", "--ff-only"]);
    result.updatedBase = true;

    await git(localPath, ["fetch", "--prune"]);
    result.pruned = true;

    const matchingLocalBranch = await git(localPath, ["branch", "--list", headBranch]);
    if (matchingLocalBranch.length === 0) {
      result.deletedBranch = true;
      return {
        ...result,
        ok: true,
      };
    }

    await git(localPath, ["branch", "-d", headBranch]);
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
