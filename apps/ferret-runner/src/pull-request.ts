import type { ClaimedReviewJob } from "@flawferret2/db";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type DraftPullRequestResult =
  | {
      ok: true;
      metadata: {
        baseBranch: string;
        commitSha: string;
        commitMessage: string;
        headBranch: string;
        prUrl: string;
        pushed: true;
      };
    }
  | {
      ok: false;
      message: string;
      metadata: {
        baseBranch: string | null;
        commitMessage: string | null;
        commitSha: string | null;
        error?: string;
        headBranch: string | null;
        prUrl: null;
        pushed: boolean;
      };
    };

export type PullRequestLifecycleState =
  | "CHECKS_FAILED"
  | "CHECKS_PASSED"
  | "CHECKS_PENDING"
  | "CLOSED"
  | "MERGED"
  | "NO_CHECKS";

type PullRequestCheckCounts = {
  failed: number;
  passed: number;
  pending: number;
  skipped: number;
  total: number;
};

export type PullRequestLifecycleResult =
  | {
      ok: true;
      metadata: {
        checks: PullRequestCheckCounts;
        lifecycleState: PullRequestLifecycleState;
        mergeStateStatus: string | null;
        mergedAt: string | null;
        prUrl: string;
        state: string | null;
      };
    }
  | {
      ok: false;
      message: string;
      metadata: {
        error?: string;
        prUrl: string | null;
      };
    };

const runCommand = async (command: string, args: string[], cwd: string) => {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    maxBuffer: 1024 * 1024,
  });

  return stdout.trim();
};

const getCheckState = (check: unknown) => {
  if (!check || typeof check !== "object") {
    return {
      conclusion: null,
      status: null,
    };
  }

  const record = check as Record<string, unknown>;
  const conclusion = typeof record.conclusion === "string" ? record.conclusion.toUpperCase() : null;
  const status =
    typeof record.status === "string"
      ? record.status.toUpperCase()
      : typeof record.state === "string"
        ? record.state.toUpperCase()
        : null;

  return {
    conclusion,
    status,
  };
};

const getLifecycleState = ({
  checks,
  mergedAt,
  state,
}: {
  checks: PullRequestCheckCounts;
  mergedAt: string | null;
  state: string | null;
}): PullRequestLifecycleState => {
  if (mergedAt || state === "MERGED") {
    return "MERGED";
  }

  if (state === "CLOSED") {
    return "CLOSED";
  }

  if (checks.failed > 0) {
    return "CHECKS_FAILED";
  }

  if (checks.total === 0) {
    return "NO_CHECKS";
  }

  if (checks.pending > 0) {
    return "CHECKS_PENDING";
  }

  return "CHECKS_PASSED";
};

const getPayloadValue = (payload: unknown, key: string) => {
  if (!payload || typeof payload !== "object" || !(key in payload)) {
    return "";
  }

  const value = (payload as Record<string, unknown>)[key];

  return typeof value === "string" ? value : "";
};

const getMetadataRecord = (metadata: unknown): Record<string, unknown> => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return metadata as Record<string, unknown>;
};

const getMetadataString = (metadata: unknown, key: string) => {
  const value = getMetadataRecord(metadata)[key];

  return typeof value === "string" && value.length > 0 ? value : null;
};

const getChangedFiles = (metadata: unknown) => {
  const validation = getMetadataRecord(getMetadataRecord(metadata).validation);
  const changedFiles = validation.changedFiles;

  return Array.isArray(changedFiles)
    ? changedFiles.filter((value): value is string => typeof value === "string")
    : [];
};

const buildPullRequestTitle = (job: ClaimedReviewJob) => {
  const featureArea = getPayloadValue(job.payload, "featureArea");

  if (featureArea) {
    return `Add Playwright coverage for ${featureArea}`;
  }

  return `Add Playwright coverage for job ${job.id.slice(0, 8)}`;
};

const buildCommitMessage = (job: ClaimedReviewJob) => {
  const featureArea = getPayloadValue(job.payload, "featureArea");

  if (featureArea) {
    return `Add Playwright coverage for ${featureArea}`;
  }

  return `Add Playwright coverage for job ${job.id.slice(0, 8)}`;
};

const buildPullRequestBody = (job: ClaimedReviewJob, runMetadata: unknown) => {
  const changedFiles = getChangedFiles(runMetadata);
  const codex = getMetadataRecord(getMetadataRecord(runMetadata).codex);
  const finalResponse = typeof codex.finalResponse === "string" ? codex.finalResponse : null;
  const lines = [
    "## Summary",
    getPayloadValue(job.payload, "goal") || "- Add requested Playwright test coverage.",
    "",
    "## Acceptance Criteria",
    getPayloadValue(job.payload, "acceptanceCriteria") || "- See FlawFerret job details.",
    "",
    "## Changed Files",
    ...(changedFiles.length > 0
      ? changedFiles.map((file) => `- ${file}`)
      : ["- No changed files recorded."]),
    "",
    "## Codex Notes",
    finalResponse ?? "- No Codex summary recorded.",
    "",
    "## FlawFerret",
    `- Job: ${job.id}`,
  ];

  return lines.join("\n");
};

export const createDraftPullRequest = async ({
  job,
  localPath,
  runMetadata,
}: {
  job: ClaimedReviewJob;
  localPath: string;
  runMetadata: unknown;
}): Promise<DraftPullRequestResult> => {
  const baseBranch =
    getMetadataString(runMetadata, "targetBranch") ||
    getPayloadValue(job.payload, "targetBranch") ||
    getPayloadValue(job.payload, "branch") ||
    "main";
  const headBranch = getMetadataString(runMetadata, "workBranch");
  const commitMessage = buildCommitMessage(job);

  if (!headBranch) {
    return {
      ok: false,
      message: "Draft PR creation failed because the generated work branch is missing.",
      metadata: {
        baseBranch,
        commitMessage,
        commitSha: null,
        headBranch,
        prUrl: null,
        pushed: false,
      },
    };
  }

  let pushed = false;
  let commitSha: string | null = null;

  try {
    const status = await runCommand("git", ["status", "--porcelain"], localPath);

    if (status.length === 0) {
      return {
        ok: false,
        message: "Draft PR creation failed because there are no generated changes to commit.",
        metadata: {
          baseBranch,
          commitMessage,
          commitSha,
          headBranch,
          prUrl: null,
          pushed,
        },
      };
    }

    await runCommand("git", ["add", "--all"], localPath);
    await runCommand("git", ["commit", "-m", commitMessage], localPath);
    commitSha = await runCommand("git", ["rev-parse", "HEAD"], localPath);

    await runCommand("git", ["push", "-u", "origin", headBranch], localPath);
    pushed = true;

    const prUrl = await runCommand(
      "gh",
      [
        "pr",
        "create",
        "--draft",
        "--base",
        baseBranch,
        "--head",
        headBranch,
        "--title",
        buildPullRequestTitle(job),
        "--body",
        buildPullRequestBody(job, runMetadata),
      ],
      localPath,
    );

    return {
      ok: true,
      metadata: {
        baseBranch,
        commitMessage,
        commitSha,
        headBranch,
        prUrl,
        pushed,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: "Draft PR creation failed.",
      metadata: {
        baseBranch,
        commitMessage,
        commitSha,
        error: error instanceof Error ? error.message : String(error),
        headBranch,
        prUrl: null,
        pushed,
      },
    };
  }
};

export const inspectPullRequestLifecycle = async ({
  localPath,
  prUrl,
}: {
  localPath: string;
  prUrl: string;
}): Promise<PullRequestLifecycleResult> => {
  try {
    const output = await runCommand(
      "gh",
      [
        "pr",
        "view",
        prUrl,
        "--json",
        "mergeStateStatus,mergedAt,state,statusCheckRollup,url",
      ],
      localPath,
    );
    const parsed = JSON.parse(output) as {
      mergeStateStatus?: unknown;
      mergedAt?: unknown;
      state?: unknown;
      statusCheckRollup?: unknown;
      url?: unknown;
    };
    const statusCheckRollup = Array.isArray(parsed.statusCheckRollup)
      ? parsed.statusCheckRollup
      : [];
    const counts = statusCheckRollup.reduce(
      (accumulator, check) => {
        const { conclusion, status } = getCheckState(check);

        if (
          conclusion &&
          ["ACTION_REQUIRED", "CANCELLED", "CANCELED", "FAILURE", "TIMED_OUT"].includes(conclusion)
        ) {
          accumulator.failed += 1;
          return accumulator;
        }

        if (conclusion && ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(conclusion)) {
          if (conclusion === "SKIPPED") {
            accumulator.skipped += 1;
          } else {
            accumulator.passed += 1;
          }

          return accumulator;
        }

        if (status === "SUCCESS") {
          accumulator.passed += 1;
          return accumulator;
        }

        if (status === "FAILURE" || status === "ERROR") {
          accumulator.failed += 1;
          return accumulator;
        }

        accumulator.pending += 1;
        return accumulator;
      },
      {
        failed: 0,
        passed: 0,
        pending: 0,
        skipped: 0,
        total: statusCheckRollup.length,
      },
    );
    const mergedAt = typeof parsed.mergedAt === "string" && parsed.mergedAt.length > 0 ? parsed.mergedAt : null;
    const state = typeof parsed.state === "string" && parsed.state.length > 0 ? parsed.state.toUpperCase() : null;

    return {
      ok: true,
      metadata: {
        checks: counts,
        lifecycleState: getLifecycleState({
          checks: counts,
          mergedAt,
          state,
        }),
        mergeStateStatus:
          typeof parsed.mergeStateStatus === "string" && parsed.mergeStateStatus.length > 0
            ? parsed.mergeStateStatus
            : null,
        mergedAt,
        prUrl: typeof parsed.url === "string" && parsed.url.length > 0 ? parsed.url : prUrl,
        state,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: "Pull request lifecycle inspection failed.",
      metadata: {
        error: error instanceof Error ? error.message : String(error),
        prUrl,
      },
    };
  }
};
