import { execFile } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitRunner = (cwd: string, args: string[]) => Promise<string>;

const runGit: GitRunner = async (cwd, args) => {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    maxBuffer: 1024 * 1024,
  });

  return stdout.trim();
};

const gitSucceeds = async (git: GitRunner, cwd: string, args: string[]) => {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
};

const pathExists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const WORK_BRANCH_PREFIX = "flawferret/job-";
const WORKTREE_DIRECTORY_PREFIX = "job-";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sanitizePathPart = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, "-");

// The full job id keeps branch names collision-free now that several jobs can target
// the same repository; the old 8-character slice was only safe with one job at a time.
export const buildWorkBranchName = (jobId: string) => `${WORK_BRANCH_PREFIX}${jobId}`;

export const isFlawFerretWorkBranch = (branch: string | null | undefined) =>
  Boolean(branch?.startsWith(WORK_BRANCH_PREFIX) && branch.length > WORK_BRANCH_PREFIX.length);

export const buildRepositoryWorktreeRoot = ({
  repositoryId,
  worktreeRoot,
}: {
  repositoryId: string;
  worktreeRoot: string;
}) => resolve(worktreeRoot, sanitizePathPart(repositoryId));

export const buildWorktreePath = ({
  jobId,
  repositoryId,
  worktreeRoot,
}: {
  jobId: string;
  repositoryId: string;
  worktreeRoot: string;
}) =>
  join(
    buildRepositoryWorktreeRoot({ repositoryId, worktreeRoot }),
    `${WORKTREE_DIRECTORY_PREFIX}${sanitizePathPart(jobId)}`,
  );

export const isPathInside = (parent: string, child: string) => {
  const relativePath = relative(resolve(parent), resolve(child));

  return relativePath.length > 0 && !relativePath.startsWith("..") && !relativePath.startsWith(sep);
};

// `git worktree list` reports symlink-resolved paths (e.g. /private/var on macOS), so
// containment is checked against both the configured and the resolved root.
const isInsideRoot = async (root: string, path: string) => {
  if (isPathInside(root, path)) {
    return true;
  }

  const resolvedRoot = await realpath(root).catch(() => null);

  return resolvedRoot !== null && isPathInside(resolvedRoot, path);
};

// Only directories this module generated (`job-<uuid>`) are ever considered for removal.
export const parseWorktreeJobId = (worktreePath: string) => {
  const name = basename(worktreePath);

  if (!name.startsWith(WORKTREE_DIRECTORY_PREFIX)) {
    return null;
  }

  const jobId = name.slice(WORKTREE_DIRECTORY_PREFIX.length);

  return UUID_PATTERN.test(jobId) ? jobId : null;
};

export type WorktreeCreationResult =
  | {
      ok: true;
      metadata: {
        baseCommit: string;
        baseRef: string;
        localPath: string;
        repositoryLocalPath: string;
        targetBranch: string;
        workBranch: string;
        worktreePath: string;
      };
    }
  | {
      ok: false;
      // `worktree-add-failed` is the only reason that maps to WORKTREE_CREATION_FAILED;
      // the others keep today's plain JOB_BLOCKED behavior.
      reason: "already-exists" | "base-not-found" | "fetch-failed" | "worktree-add-failed";
      message: string;
      metadata: Record<string, unknown>;
    };

const getBaseRef = async ({
  git,
  repositoryLocalPath,
  targetBranch,
}: {
  git: GitRunner;
  repositoryLocalPath: string;
  targetBranch: string;
}) => {
  const remoteRef = `refs/remotes/origin/${targetBranch}`;

  if (await gitSucceeds(git, repositoryLocalPath, ["show-ref", "--verify", "--quiet", remoteRef])) {
    return {
      display: `origin/${targetBranch}`,
      ref: remoteRef,
    };
  }

  const localRef = `refs/heads/${targetBranch}`;

  if (await gitSucceeds(git, repositoryLocalPath, ["show-ref", "--verify", "--quiet", localRef])) {
    return {
      display: targetBranch,
      ref: localRef,
    };
  }

  return null;
};

export const createJobWorktree = async ({
  git = runGit,
  jobId,
  repositoryId,
  repositoryLocalPath,
  targetBranch,
  worktreeRoot,
}: {
  git?: GitRunner;
  jobId: string;
  repositoryId: string;
  repositoryLocalPath: string;
  targetBranch: string;
  worktreeRoot: string;
}): Promise<WorktreeCreationResult> => {
  const workBranch = buildWorkBranchName(jobId);
  const worktreePath = buildWorktreePath({ jobId, repositoryId, worktreeRoot });
  const baseMetadata = {
    repositoryLocalPath,
    targetBranch,
    workBranch,
    worktreePath,
  };

  if (await pathExists(worktreePath)) {
    return {
      ok: false,
      reason: "already-exists",
      message: "A worktree directory for this job already exists.",
      metadata: baseMetadata,
    };
  }

  if (
    await gitSucceeds(git, repositoryLocalPath, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${workBranch}`,
    ])
  ) {
    return {
      ok: false,
      reason: "already-exists",
      message: "Generated work branch already exists in the local repository.",
      metadata: baseMetadata,
    };
  }

  try {
    await git(repositoryLocalPath, ["fetch", "--prune", "origin"]);
  } catch (error) {
    return {
      ok: false,
      reason: "fetch-failed",
      message: "Could not fetch origin before creating the job worktree.",
      metadata: {
        ...baseMetadata,
        error: errorMessage(error),
      },
    };
  }

  const baseRef = await getBaseRef({ git, repositoryLocalPath, targetBranch });

  if (!baseRef) {
    return {
      ok: false,
      reason: "base-not-found",
      message: "Target branch was not found locally or on origin.",
      metadata: baseMetadata,
    };
  }

  try {
    await mkdir(dirname(worktreePath), {
      recursive: true,
    });
    await git(repositoryLocalPath, ["worktree", "add", "--detach", worktreePath, baseRef.ref]);
  } catch (error) {
    return {
      ok: false,
      reason: "worktree-add-failed",
      message: "git worktree add failed for the job worktree.",
      metadata: {
        ...baseMetadata,
        baseRef: baseRef.display,
        error: errorMessage(error),
      },
    };
  }

  try {
    const baseCommit = await git(worktreePath, ["rev-parse", "HEAD"]);

    await git(worktreePath, ["switch", "-c", workBranch]);

    return {
      ok: true,
      metadata: {
        ...baseMetadata,
        baseCommit,
        baseRef: baseRef.display,
        localPath: worktreePath,
      },
    };
  } catch (error) {
    // Don't leave a half-prepared worktree behind; it would block a requeue of this job.
    await git(repositoryLocalPath, ["worktree", "remove", "--force", worktreePath]).catch(() => "");

    return {
      ok: false,
      reason: "worktree-add-failed",
      message: "The job worktree was created but its work branch could not be created.",
      metadata: {
        ...baseMetadata,
        baseRef: baseRef.display,
        error: errorMessage(error),
      },
    };
  }
};

export type WorktreeRemovalReason = "orphan-sweep" | "pr-merged" | "retention-expired";

export type WorktreeRemovalResult = {
  deletedBranch: boolean;
  error?: string;
  ok: boolean;
  pruned: boolean;
  reason: WorktreeRemovalReason;
  removedWorktree: boolean;
  repositoryLocalPath: string;
  workBranch: string | null;
  worktreePath: string;
};

export const removeJobWorktree = async ({
  git = runGit,
  reason,
  repositoryLocalPath,
  workBranch,
  worktreePath,
  worktreeRoot,
}: {
  git?: GitRunner;
  reason: WorktreeRemovalReason;
  repositoryLocalPath: string;
  workBranch: string | null;
  worktreePath: string;
  worktreeRoot: string;
}): Promise<WorktreeRemovalResult> => {
  const result: WorktreeRemovalResult = {
    deletedBranch: false,
    ok: false,
    pruned: false,
    reason,
    removedWorktree: false,
    repositoryLocalPath,
    workBranch,
    worktreePath,
  };

  // Never let a bad metadata value point `worktree remove --force` at the user's checkout.
  if (!(await isInsideRoot(worktreeRoot, worktreePath))) {
    return {
      ...result,
      error: "Refusing to remove a worktree outside the configured worktree directory.",
    };
  }

  if (workBranch !== null && !isFlawFerretWorkBranch(workBranch)) {
    return {
      ...result,
      error: "Refusing to delete a non-FlawFerret work branch.",
    };
  }

  const errors: string[] = [];

  try {
    await git(repositoryLocalPath, ["worktree", "remove", "--force", worktreePath]);
    result.removedWorktree = true;
  } catch (error) {
    if (await pathExists(worktreePath)) {
      errors.push(errorMessage(error));
    } else {
      // Already gone from disk; `worktree prune` below clears git's stale record.
      result.removedWorktree = true;
    }
  }

  try {
    await git(repositoryLocalPath, ["worktree", "prune"]);
    result.pruned = true;
  } catch (error) {
    errors.push(errorMessage(error));
  }

  if (workBranch) {
    const branchExists = await gitSucceeds(git, repositoryLocalPath, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${workBranch}`,
    ]);

    if (!branchExists) {
      result.deletedBranch = true;
    } else {
      try {
        await git(repositoryLocalPath, ["branch", "-D", workBranch]);
        result.deletedBranch = true;
      } catch (error) {
        errors.push(errorMessage(error));
      }
    }
  }

  return {
    ...result,
    ...(errors.length > 0 ? { error: errors.join("\n") } : {}),
    ok: errors.length === 0,
  };
};

export type ListedWorktree = {
  branch: string | null;
  path: string;
};

export const parseWorktreeListPorcelain = (output: string): ListedWorktree[] =>
  output
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const pathLine = lines.find((line) => line.startsWith("worktree "));
      const branchLine = lines.find((line) => line.startsWith("branch "));

      if (!pathLine) {
        return null;
      }

      return {
        branch: branchLine ? branchLine.slice("branch ".length).replace(/^refs\/heads\//, "") : null,
        path: pathLine.slice("worktree ".length),
      };
    })
    .filter((entry): entry is ListedWorktree => entry !== null);

export const WORKTREE_RETENTION_STATUSES = ["BLOCKED", "CANCELED", "FAILED"] as const;

export type SweepJob = {
  completedAt: Date | null;
  id: string;
  status: string;
  updatedAt: Date;
};

export type SweepDecision =
  | { action: "keep"; reason: "in-flight" | "within-retention" }
  | { action: "remove"; reason: "orphan-sweep" | "retention-expired" };

// Only terminal states start the retention clock (PR_CLOSED lands in BLOCKED). Every
// other status, including COMPLETED jobs that never opened a PR, is left untouched.
export const decideWorktreeSweepAction = ({
  job,
  now,
  retentionMs,
}: {
  job: SweepJob | null;
  now: Date;
  retentionMs: number;
}): SweepDecision => {
  if (!job) {
    return { action: "remove", reason: "orphan-sweep" };
  }

  if (!(WORKTREE_RETENTION_STATUSES as readonly string[]).includes(job.status)) {
    return { action: "keep", reason: "in-flight" };
  }

  const retainedSince = job.completedAt ?? job.updatedAt;

  return now.getTime() - retainedSince.getTime() >= retentionMs
    ? { action: "remove", reason: "retention-expired" }
    : { action: "keep", reason: "within-retention" };
};

export type WorktreeSweepRemoval = WorktreeRemovalResult & {
  jobId: string;
  repositoryId: string;
};

export const sweepRepositoryWorktrees = async ({
  findJobs,
  git = runGit,
  now = new Date(),
  repositoryId,
  repositoryLocalPath,
  retentionMs,
  worktreeRoot,
}: {
  findJobs: (jobIds: string[]) => Promise<SweepJob[]>;
  git?: GitRunner;
  now?: Date;
  repositoryId: string;
  repositoryLocalPath: string;
  retentionMs: number;
  worktreeRoot: string;
}): Promise<WorktreeSweepRemoval[]> => {
  const repositoryWorktreeRoot = buildRepositoryWorktreeRoot({ repositoryId, worktreeRoot });
  const listed = parseWorktreeListPorcelain(
    await git(repositoryLocalPath, ["worktree", "list", "--porcelain"]),
  );
  const insideRoot = await Promise.all(
    listed.map((entry) => isInsideRoot(repositoryWorktreeRoot, entry.path)),
  );
  const candidates = listed
    .filter((_entry, index) => insideRoot[index])
    .map((entry) => ({
      ...entry,
      jobId: parseWorktreeJobId(entry.path),
    }))
    .filter((entry): entry is ListedWorktree & { jobId: string } => entry.jobId !== null);

  if (candidates.length === 0) {
    return [];
  }

  const jobs = await findJobs(candidates.map((candidate) => candidate.jobId));
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const removals: WorktreeSweepRemoval[] = [];

  for (const candidate of candidates) {
    const decision = decideWorktreeSweepAction({
      job: jobsById.get(candidate.jobId) ?? null,
      now,
      retentionMs,
    });

    if (decision.action === "keep") {
      continue;
    }

    const removal = await removeJobWorktree({
      git,
      reason: decision.reason,
      repositoryLocalPath,
      workBranch: buildWorkBranchName(candidate.jobId),
      worktreePath: candidate.path,
      worktreeRoot,
    });

    removals.push({
      ...removal,
      jobId: candidate.jobId,
      repositoryId,
    });
  }

  return removals;
};

export const runWorktreeSweep = async ({
  findJobs,
  git = runGit,
  listRepositories,
  now = new Date(),
  onRemoval,
  onRepositoryError,
  retentionMs,
  worktreeRoot,
}: {
  findJobs: (jobIds: string[]) => Promise<SweepJob[]>;
  git?: GitRunner;
  listRepositories: () => Promise<Array<{ id: string; localPath: string | null }>>;
  now?: Date;
  onRemoval: (removal: WorktreeSweepRemoval, jobExists: boolean) => Promise<void>;
  onRepositoryError: (repositoryId: string, error: string) => Promise<void> | void;
  retentionMs: number;
  worktreeRoot: string;
}) => {
  const repositories = await listRepositories();
  const removals: WorktreeSweepRemoval[] = [];

  for (const repository of repositories) {
    if (!repository.localPath) {
      continue;
    }

    try {
      const repositoryRemovals = await sweepRepositoryWorktrees({
        findJobs,
        git,
        now,
        repositoryId: repository.id,
        repositoryLocalPath: repository.localPath,
        retentionMs,
        worktreeRoot,
      });

      for (const removal of repositoryRemovals) {
        await onRemoval(removal, removal.reason !== "orphan-sweep");
      }

      removals.push(...repositoryRemovals);
    } catch (error) {
      await onRepositoryError(repository.id, errorMessage(error));
    }
  }

  return removals;
};
