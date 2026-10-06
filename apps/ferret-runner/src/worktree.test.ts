import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";
import {
  buildWorkBranchName,
  buildWorktreePath,
  createJobWorktree,
  decideWorktreeSweepAction,
  isFlawFerretWorkBranch,
  parseWorktreeJobId,
  parseWorktreeListPorcelain,
  removeJobWorktree,
  runWorktreeSweep,
  type SweepJob,
} from "./worktree.js";

const execFileAsync = promisify(execFile);

const git = async (cwd: string, ...args: string[]) => {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);

  return stdout.trim();
};

const exists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const HOUR_MS = 60 * 60 * 1000;

describe("work branch naming", () => {
  it("uses the full job id instead of an 8-character slice", () => {
    const jobId = "0f8fad5b-d9cb-469f-a165-70867728950e";

    assert.equal(buildWorkBranchName(jobId), `flawferret/job-${jobId}`);
  });

  it("recognizes only generated work branches", () => {
    assert.equal(isFlawFerretWorkBranch("flawferret/job-abc"), true);
    assert.equal(isFlawFerretWorkBranch("flawferret/job-"), false);
    assert.equal(isFlawFerretWorkBranch("feature/flawferret/job-abc"), false);
    assert.equal(isFlawFerretWorkBranch(null), false);
  });

  it("namespaces worktree paths per repository and job", () => {
    assert.equal(
      buildWorktreePath({ jobId: "job-id", repositoryId: "repo-id", worktreeRoot: "/srv/worktrees" }),
      "/srv/worktrees/repo-id/job-job-id",
    );
  });

  it("only parses job ids from generated worktree directory names", () => {
    const jobId = randomUUID();

    assert.equal(parseWorktreeJobId(`/srv/worktrees/repo/job-${jobId}`), jobId);
    assert.equal(parseWorktreeJobId("/srv/worktrees/repo/job-not-a-uuid"), null);
    assert.equal(parseWorktreeJobId(`/srv/worktrees/repo/${jobId}`), null);
  });
});

describe("parseWorktreeListPorcelain", () => {
  it("parses paths and branches, including detached worktrees", () => {
    const output = [
      "worktree /home/me/repo",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /home/me/.flawferret/worktrees/r/job-1",
      "HEAD 2222222222222222222222222222222222222222",
      "detached",
      "",
    ].join("\n");

    assert.deepEqual(parseWorktreeListPorcelain(output), [
      { branch: "main", path: "/home/me/repo" },
      { branch: null, path: "/home/me/.flawferret/worktrees/r/job-1" },
    ]);
  });
});

describe("decideWorktreeSweepAction", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const job = (overrides: Partial<SweepJob>): SweepJob => ({
    completedAt: null,
    id: randomUUID(),
    status: "BLOCKED",
    updatedAt: now,
    ...overrides,
  });

  it("removes true orphans regardless of age", () => {
    assert.deepEqual(decideWorktreeSweepAction({ job: null, now, retentionMs: 24 * HOUR_MS }), {
      action: "remove",
      reason: "orphan-sweep",
    });
  });

  it("removes terminal jobs once the retention window has elapsed", () => {
    for (const status of ["BLOCKED", "FAILED", "CANCELED"]) {
      assert.deepEqual(
        decideWorktreeSweepAction({
          job: job({ completedAt: new Date(now.getTime() - 25 * HOUR_MS), status }),
          now,
          retentionMs: 24 * HOUR_MS,
        }),
        { action: "remove", reason: "retention-expired" },
      );
    }
  });

  it("keeps terminal jobs still inside the retention window", () => {
    assert.deepEqual(
      decideWorktreeSweepAction({
        job: job({ completedAt: new Date(now.getTime() - 2 * HOUR_MS) }),
        now,
        retentionMs: 24 * HOUR_MS,
      }),
      { action: "keep", reason: "within-retention" },
    );
  });

  it("falls back to updatedAt when the terminal job has no completedAt", () => {
    assert.equal(
      decideWorktreeSweepAction({
        job: job({ updatedAt: new Date(now.getTime() - 30 * HOUR_MS) }),
        now,
        retentionMs: 24 * HOUR_MS,
      }).action,
      "remove",
    );
  });

  it("never touches in-flight or completed jobs, however old", () => {
    const old = new Date(now.getTime() - 1000 * HOUR_MS);

    for (const status of [
      "QUEUED",
      "RUNNING",
      "READY_FOR_CODEX",
      "VALIDATING",
      "REVIEW",
      "PR_APPROVED",
      "PR_CREATED",
      "COMPLETED",
    ]) {
      assert.deepEqual(
        decideWorktreeSweepAction({
          job: job({ completedAt: old, status, updatedAt: old }),
          now,
          retentionMs: 24 * HOUR_MS,
        }),
        { action: "keep", reason: "in-flight" },
      );
    }
  });
});

describe("job worktrees against a real git repository", () => {
  let tempDir: string;
  let originPath: string;
  let checkoutPath: string;
  let worktreeRoot: string;
  const repositoryId = randomUUID();

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "flawferret-worktree-test-"));
    originPath = join(tempDir, "origin.git");
    checkoutPath = join(tempDir, "checkout");
    worktreeRoot = join(tempDir, "worktrees");

    await execFileAsync("git", ["init", "--bare", "--initial-branch=main", originPath]);
    await execFileAsync("git", ["clone", originPath, checkoutPath]);
    await git(checkoutPath, "config", "user.email", "ferret@example.com");
    await git(checkoutPath, "config", "user.name", "Ferret Test");
    await git(checkoutPath, "config", "commit.gpgsign", "false");
    await git(checkoutPath, "symbolic-ref", "HEAD", "refs/heads/main");
    await writeFile(join(checkoutPath, "README.md"), "hello\n");
    await git(checkoutPath, "add", "README.md");
    await git(checkoutPath, "commit", "-m", "Initial commit");
    await git(checkoutPath, "push", "-u", "origin", "main");
  });

  after(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it("creates a worktree off origin/<target> without touching the user's checkout", async () => {
    const jobId = randomUUID();

    // The user is mid-work: a dirty file and a different branch checked out.
    await git(checkoutPath, "switch", "-c", "feature/my-work");
    await writeFile(join(checkoutPath, "scratch.txt"), "uncommitted\n");
    const headBefore = await git(checkoutPath, "rev-parse", "HEAD");
    const statusBefore = await git(checkoutPath, "status", "--porcelain");

    // Another clone advances origin/main; the user's local main is now behind.
    const otherPath = join(tempDir, "other");
    await execFileAsync("git", ["clone", originPath, otherPath]);
    await git(otherPath, "config", "user.email", "ferret@example.com");
    await git(otherPath, "config", "user.name", "Ferret Test");
    await git(otherPath, "config", "commit.gpgsign", "false");
    await writeFile(join(otherPath, "upstream.txt"), "new upstream work\n");
    await git(otherPath, "add", "upstream.txt");
    await git(otherPath, "commit", "-m", "Upstream change");
    await git(otherPath, "push", "origin", "main");
    const upstreamHead = await git(otherPath, "rev-parse", "HEAD");

    const result = await createJobWorktree({
      jobId,
      repositoryId,
      repositoryLocalPath: checkoutPath,
      targetBranch: "main",
      worktreeRoot,
    });

    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.equal(result.metadata.worktreePath, buildWorktreePath({ jobId, repositoryId, worktreeRoot }));
    assert.equal(result.metadata.localPath, result.metadata.worktreePath);
    assert.equal(result.metadata.repositoryLocalPath, checkoutPath);
    assert.equal(result.metadata.workBranch, `flawferret/job-${jobId}`);
    assert.equal(result.metadata.baseRef, "origin/main");
    assert.equal(result.metadata.baseCommit, upstreamHead);
    assert.equal(
      await git(result.metadata.worktreePath, "branch", "--show-current"),
      `flawferret/job-${jobId}`,
    );
    assert.ok(await exists(join(result.metadata.worktreePath, "upstream.txt")));

    assert.equal(await git(checkoutPath, "branch", "--show-current"), "feature/my-work");
    assert.equal(await git(checkoutPath, "rev-parse", "HEAD"), headBefore);
    assert.equal(await git(checkoutPath, "status", "--porcelain"), statusBefore);
  });

  it("refuses when a worktree or work branch for the job already exists", async () => {
    const jobId = randomUUID();
    const input = {
      jobId,
      repositoryId,
      repositoryLocalPath: checkoutPath,
      targetBranch: "main",
      worktreeRoot,
    };

    assert.equal((await createJobWorktree(input)).ok, true);

    const second = await createJobWorktree(input);

    assert.equal(second.ok, false);
    assert.ok(!second.ok);
    assert.equal(second.reason, "already-exists");
  });

  it("reports a missing target branch without creating anything", async () => {
    const jobId = randomUUID();
    const result = await createJobWorktree({
      jobId,
      repositoryId,
      repositoryLocalPath: checkoutPath,
      targetBranch: "does-not-exist",
      worktreeRoot,
    });

    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.reason, "base-not-found");
    assert.equal(await exists(buildWorktreePath({ jobId, repositoryId, worktreeRoot })), false);
  });

  it("reports worktree-add-failed when the worktree cannot be created", async () => {
    const blockedRoot = join(tempDir, "blocked-root");
    const blockedRepositoryId = randomUUID();
    await mkdir(blockedRoot, { recursive: true });
    // A file where the per-repository directory should go makes `mkdir` fail.
    await writeFile(join(blockedRoot, blockedRepositoryId), "not a directory\n");

    const result = await createJobWorktree({
      jobId: randomUUID(),
      repositoryId: blockedRepositoryId,
      repositoryLocalPath: checkoutPath,
      targetBranch: "main",
      worktreeRoot: blockedRoot,
    });

    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.reason, "worktree-add-failed");
    assert.equal(typeof result.metadata.error, "string");
  });

  it("removes a worktree and force-deletes its work branch", async () => {
    const jobId = randomUUID();
    const created = await createJobWorktree({
      jobId,
      repositoryId,
      repositoryLocalPath: checkoutPath,
      targetBranch: "main",
      worktreeRoot,
    });
    assert.ok(created.ok);

    // Uncommitted generated work must not stop cleanup.
    await writeFile(join(created.metadata.worktreePath, "generated.spec.ts"), "test\n");

    const removal = await removeJobWorktree({
      reason: "pr-merged",
      repositoryLocalPath: checkoutPath,
      workBranch: created.metadata.workBranch,
      worktreePath: created.metadata.worktreePath,
      worktreeRoot,
    });

    assert.equal(removal.ok, true, removal.error ?? "removal failed");
    assert.equal(removal.removedWorktree, true);
    assert.equal(removal.deletedBranch, true);
    assert.equal(await exists(created.metadata.worktreePath), false);
    assert.equal(await git(checkoutPath, "branch", "--list", created.metadata.workBranch), "");
  });

  it("treats an already-deleted worktree directory as removed", async () => {
    const jobId = randomUUID();
    const created = await createJobWorktree({
      jobId,
      repositoryId,
      repositoryLocalPath: checkoutPath,
      targetBranch: "main",
      worktreeRoot,
    });
    assert.ok(created.ok);
    await rm(created.metadata.worktreePath, { force: true, recursive: true });

    const removal = await removeJobWorktree({
      reason: "retention-expired",
      repositoryLocalPath: checkoutPath,
      workBranch: created.metadata.workBranch,
      worktreePath: created.metadata.worktreePath,
      worktreeRoot,
    });

    assert.equal(removal.ok, true, removal.error ?? "removal failed");
    assert.equal(removal.deletedBranch, true);
  });

  it("sweeps orphans and expired worktrees but keeps in-flight and retained ones", async () => {
    const sweepRoot = join(tempDir, "sweep-worktrees");
    const now = new Date();
    const ids = {
      expired: randomUUID(),
      inFlight: randomUUID(),
      orphan: randomUUID(),
      retained: randomUUID(),
    };

    for (const jobId of Object.values(ids)) {
      const created = await createJobWorktree({
        jobId,
        repositoryId,
        repositoryLocalPath: checkoutPath,
        targetBranch: "main",
        worktreeRoot: sweepRoot,
      });
      assert.ok(created.ok);
    }

    const jobs: SweepJob[] = [
      {
        completedAt: new Date(now.getTime() - 48 * HOUR_MS),
        id: ids.expired,
        status: "BLOCKED",
        updatedAt: now,
      },
      {
        completedAt: new Date(now.getTime() - 1 * HOUR_MS),
        id: ids.retained,
        status: "FAILED",
        updatedAt: now,
      },
      {
        completedAt: null,
        id: ids.inFlight,
        status: "PR_CREATED",
        updatedAt: new Date(now.getTime() - 100 * HOUR_MS),
      },
    ];
    const recorded: Array<{ jobExists: boolean; jobId: string; reason: string }> = [];

    const removals = await runWorktreeSweep({
      findJobs: async (jobIds) => jobs.filter((job) => jobIds.includes(job.id)),
      listRepositories: async () => [
        { id: repositoryId, localPath: checkoutPath },
        { id: randomUUID(), localPath: null },
      ],
      now,
      onRemoval: async (removal, jobExists) => {
        recorded.push({ jobExists, jobId: removal.jobId, reason: removal.reason });
      },
      onRepositoryError: (_repositoryId, error) => {
        assert.fail(error);
      },
      retentionMs: 24 * HOUR_MS,
      worktreeRoot: sweepRoot,
    });

    assert.equal(removals.length, 2);
    assert.ok(removals.every((removal) => removal.ok));
    assert.deepEqual(
      recorded.sort((a, b) => a.reason.localeCompare(b.reason)),
      [
        { jobExists: false, jobId: ids.orphan, reason: "orphan-sweep" },
        { jobExists: true, jobId: ids.expired, reason: "retention-expired" },
      ],
    );

    const pathFor = (jobId: string) => buildWorktreePath({ jobId, repositoryId, worktreeRoot: sweepRoot });
    assert.equal(await exists(pathFor(ids.orphan)), false);
    assert.equal(await exists(pathFor(ids.expired)), false);
    assert.equal(await exists(pathFor(ids.retained)), true);
    assert.equal(await exists(pathFor(ids.inFlight)), true);
    assert.equal(await git(checkoutPath, "branch", "--list", buildWorkBranchName(ids.orphan)), "");
    assert.notEqual(await git(checkoutPath, "branch", "--list", buildWorkBranchName(ids.retained)), "");
  });
});
