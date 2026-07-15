import type { ClaimedReviewJob } from "@flawferret2/db";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type DraftPullRequestResult =
  | {
      ok: true;
      metadata: {
        baseBranch: string;
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
        error?: string;
        headBranch: string | null;
        prUrl: null;
        pushed: boolean;
      };
    };

const runCommand = async (command: string, args: string[], cwd: string) => {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    maxBuffer: 1024 * 1024,
  });

  return stdout.trim();
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

  if (!headBranch) {
    return {
      ok: false,
      message: "Draft PR creation failed because the generated work branch is missing.",
      metadata: {
        baseBranch,
        headBranch,
        prUrl: null,
        pushed: false,
      },
    };
  }

  let pushed = false;

  try {
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
        error: error instanceof Error ? error.message : String(error),
        headBranch,
        prUrl: null,
        pushed,
      },
    };
  }
};
