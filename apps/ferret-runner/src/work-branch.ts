import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorkBranchPreparationResult =
  | {
      ok: true;
      metadata: {
        baseCommit: string;
        baseRef: string;
        localPath: string;
        targetBranch: string;
        workBranch: string;
      };
    }
  | {
      ok: false;
      message: string;
      metadata: Record<string, unknown>;
    };

const runGit = async (localPath: string, args: string[]) => {
  const { stdout } = await execFileAsync("git", ["-C", localPath, ...args], {
    maxBuffer: 1024 * 1024,
  });

  return stdout.trim();
};

const gitSucceeds = async (localPath: string, args: string[]) => {
  try {
    await runGit(localPath, args);
    return true;
  } catch {
    return false;
  }
};

export const buildWorkBranchName = (jobId: string) => `flawferret/job-${jobId.slice(0, 8)}`;

const getBaseRef = async ({
  localPath,
  targetBranch,
}: {
  localPath: string;
  targetBranch: string;
}) => {
  const remoteRef = `refs/remotes/origin/${targetBranch}`;

  if (await gitSucceeds(localPath, ["show-ref", "--verify", "--quiet", remoteRef])) {
    return {
      display: `origin/${targetBranch}`,
      ref: remoteRef,
    };
  }

  const localRef = `refs/heads/${targetBranch}`;

  if (await gitSucceeds(localPath, ["show-ref", "--verify", "--quiet", localRef])) {
    return {
      display: targetBranch,
      ref: localRef,
    };
  }

  return null;
};

export const prepareWorkBranch = async ({
  jobId,
  localPath,
  targetBranch,
}: {
  jobId: string;
  localPath: string;
  targetBranch: string;
}): Promise<WorkBranchPreparationResult> => {
  const workBranch = buildWorkBranchName(jobId);

  try {
    const workBranchExists = await gitSucceeds(localPath, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${workBranch}`,
    ]);

    if (workBranchExists) {
      return {
        ok: false,
        message: "Generated work branch already exists in the local checkout.",
        metadata: {
          localPath,
          workBranch,
        },
      };
    }

    await runGit(localPath, ["fetch", "--prune", "origin"]);

    const baseRef = await getBaseRef({
      localPath,
      targetBranch,
    });

    if (!baseRef) {
      return {
        ok: false,
        message: "Target branch was not found locally or on origin.",
        metadata: {
          localPath,
          targetBranch,
          workBranch,
        },
      };
    }

    await runGit(localPath, ["switch", "--detach", baseRef.ref]);

    const baseCommit = await runGit(localPath, ["rev-parse", "HEAD"]);

    await runGit(localPath, ["switch", "-c", workBranch]);

    return {
      ok: true,
      metadata: {
        baseCommit,
        baseRef: baseRef.display,
        localPath,
        targetBranch,
        workBranch,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: "Generated work branch could not be prepared.",
      metadata: {
        error: error instanceof Error ? error.message : String(error),
        localPath,
        targetBranch,
        workBranch,
      },
    };
  }
};
