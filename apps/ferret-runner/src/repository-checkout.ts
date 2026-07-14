import type { Repository } from "@flawferret2/db";
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CheckoutValidationResult =
  | {
      ok: true;
      metadata: {
        branchRef: string;
        localPath: string;
        remoteUrl: string;
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

const parseGitHubRepository = (value: string) => {
  const normalized = value.trim().replace(/\.git$/, "");
  const httpsMatch = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  const sshUrlMatch = normalized.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/i);
  const match = httpsMatch ?? sshMatch ?? sshUrlMatch;

  if (!match) {
    return null;
  }

  return {
    owner: match[1].toLowerCase(),
    name: match[2].toLowerCase(),
  };
};

const hasMatchingOrigin = ({
  expected,
  remoteUrl,
}: {
  expected: Repository;
  remoteUrl: string;
}) => {
  const parsedRemote = parseGitHubRepository(remoteUrl);

  if (!parsedRemote) {
    return false;
  }

  return (
    parsedRemote.owner === expected.owner.toLowerCase() &&
    parsedRemote.name === expected.name.toLowerCase()
  );
};

export const validateRepositoryCheckout = async ({
  repository,
  targetBranch,
}: {
  repository: Repository;
  targetBranch: string;
}): Promise<CheckoutValidationResult> => {
  if (!repository.localPath) {
    return {
      ok: false,
      message: "Repository has no configured local checkout path.",
      metadata: {
        repository: `${repository.owner}/${repository.name}`,
      },
    };
  }

  const localPath = repository.localPath;

  try {
    const pathStat = await stat(localPath);

    if (!pathStat.isDirectory()) {
      return {
        ok: false,
        message: "Configured local checkout path is not a directory.",
        metadata: {
          localPath,
        },
      };
    }
  } catch (error) {
    return {
      ok: false,
      message: "Configured local checkout path does not exist.",
      metadata: {
        error: error instanceof Error ? error.message : String(error),
        localPath,
      },
    };
  }

  try {
    const insideWorkTree = await runGit(localPath, ["rev-parse", "--is-inside-work-tree"]);

    if (insideWorkTree !== "true") {
      return {
        ok: false,
        message: "Configured local checkout path is not inside a Git work tree.",
        metadata: {
          localPath,
        },
      };
    }

    const remoteUrl = await runGit(localPath, ["remote", "get-url", "origin"]);

    if (!hasMatchingOrigin({ expected: repository, remoteUrl })) {
      return {
        ok: false,
        message: "Configured local checkout origin does not match the registered repository.",
        metadata: {
          expectedRepository: `${repository.owner}/${repository.name}`,
          localPath,
          remoteUrl,
        },
      };
    }

    const status = await runGit(localPath, ["status", "--porcelain"]);

    if (status.length > 0) {
      return {
        ok: false,
        message: "Configured local checkout has uncommitted changes.",
        metadata: {
          localPath,
        },
      };
    }

    await runGit(localPath, ["fetch", "--prune", "origin"]);

    const branchRef = await runGit(localPath, [
      "rev-parse",
      "--verify",
      "--quiet",
      targetBranch,
    ]).catch(async () =>
      runGit(localPath, ["rev-parse", "--verify", "--quiet", `origin/${targetBranch}`]),
    );

    return {
      ok: true,
      metadata: {
        branchRef,
        localPath,
        remoteUrl,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: "Configured local checkout could not be validated.",
      metadata: {
        error: error instanceof Error ? error.message : String(error),
        localPath,
        targetBranch,
      },
    };
  }
};
