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

export type CommandRunner = (command: string, args: string[], cwd: string) => Promise<string>;

export type FailingCheckLog = {
  /** Fetched Actions log output, the surfaced details URL, or an error message, depending on `source`. */
  detail: string;
  name: string;
  runId: string | null;
  source: "actions-log" | "details-url-fallback";
  url: string | null;
};

export type FetchFailingCheckLogsResult =
  | {
      ok: true;
      metadata: {
        checkNames: string[];
        checks: FailingCheckLog[];
        feedback: string;
      };
    }
  | {
      ok: false;
      message: string;
      metadata: {
        error?: string;
        prUrl: string;
      };
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

const FAILING_CHECK_BUCKETS = new Set(["fail", "cancel"]);
const FAILING_CHECK_STATES = new Set([
  "ACTION_REQUIRED",
  "CANCELLED",
  "CANCELED",
  "FAILURE",
  "TIMED_OUT",
]);

const isFailingCheck = (check: unknown) => {
  if (!check || typeof check !== "object") {
    return false;
  }

  const record = check as Record<string, unknown>;
  const bucket = typeof record.bucket === "string" ? record.bucket.toLowerCase() : null;
  const state = typeof record.state === "string" ? record.state.toUpperCase() : null;

  return (bucket && FAILING_CHECK_BUCKETS.has(bucket)) || (state !== null && FAILING_CHECK_STATES.has(state));
};

// GitHub Actions check `link` URLs look like
// https://github.com/<owner>/<repo>/actions/runs/<runId>/job/<jobId>. Third-party
// checks (e.g. external CI providers) link elsewhere and have no extractable run id -
// those fall back to surfacing the details URL instead of a fetched log.
const extractActionsRunId = (url: string | null) => {
  if (!url) {
    return null;
  }

  const match = url.match(/\/actions\/runs\/(\d+)/);

  return match ? match[1] : null;
};

// Total character budget for the concatenated `feedback` string handed to Codex as
// retry context. Split evenly across failing checks (rather than truncating the
// final concatenation from the front) so that with 3+ failing checks every check
// still contributes some signal instead of the first check's log alone consuming
// the whole budget and silently dropping the rest.
const FEEDBACK_BUDGET_CHARACTERS = 4000;

const truncateCheckDetail = (detail: string, maxLength: number) => {
  if (detail.length <= maxLength) {
    return detail;
  }

  return `${detail.slice(0, maxLength)}...`;
};

// Splits `budget` across `checks` in two passes so unused headroom from short checks
// (e.g. a details-url fallback message) is redistributed to checks that actually need
// more room (e.g. a large Actions log), rather than every check getting a fixed even
// share regardless of how much of it goes unused.
const allocateCheckBudgets = (checks: FailingCheckLog[], budget: number): number[] => {
  const evenShare = Math.max(1, Math.floor(budget / checks.length));
  const allocations = checks.map((check) => Math.min(check.detail.length, evenShare));
  const leftover = budget - allocations.reduce((sum, allocation) => sum + allocation, 0);

  if (leftover <= 0) {
    return allocations;
  }

  const needsMoreIndexes = checks
    .map((check, index) => index)
    .filter((index) => checks[index].detail.length > allocations[index]);

  if (needsMoreIndexes.length === 0) {
    return allocations;
  }

  const extraShare = Math.max(1, Math.floor(leftover / needsMoreIndexes.length));

  for (const index of needsMoreIndexes) {
    const remainingNeed = checks[index].detail.length - allocations[index];

    allocations[index] += Math.min(remainingNeed, extraShare);
  }

  return allocations;
};

const buildFeedback = (checks: FailingCheckLog[], budget = FEEDBACK_BUDGET_CHARACTERS) => {
  const allocations = allocateCheckBudgets(checks, budget);

  return checks
    .map(
      (check, index) =>
        `## ${check.name}${check.url ? ` (${check.url})` : ""}\n${truncateCheckDetail(check.detail, allocations[index])}`,
    )
    .join("\n\n");
};

/**
 * Fetches failing-check output for a pull request via `gh`, for use as auto-heal
 * `retryFeedback`. Enumerates failing checks with `gh pr checks --json`, then pulls
 * the failed-step log for each GitHub Actions check via `gh run view --log-failed`.
 * Non-Actions checks (no extractable run id) fall back to surfacing the check's
 * details URL instead of fetched log output, since there's no generic API for
 * third-party CI output.
 *
 * Any `gh` invocation failure (rate limit, auth issue, deleted run, etc.) causes the
 * whole fetch to fail (`ok: false`) rather than returning partial/empty feedback, so
 * callers can fall back to today's `BLOCKED` behavior for that poll.
 */
export const fetchFailingCheckLogs = async ({
  localPath,
  prUrl,
  run = runCommand,
}: {
  localPath: string;
  prUrl: string;
  run?: CommandRunner;
}): Promise<FetchFailingCheckLogsResult> => {
  let checksOutput: string;

  try {
    checksOutput = await run(
      "gh",
      ["pr", "checks", prUrl, "--json", "name,state,link,bucket"],
      localPath,
    );
  } catch (error) {
    return {
      ok: false,
      message: "Failed to enumerate pull request checks via gh.",
      metadata: {
        error: error instanceof Error ? error.message : String(error),
        prUrl,
      },
    };
  }

  let parsedChecks: unknown;

  try {
    parsedChecks = JSON.parse(checksOutput);
  } catch (error) {
    return {
      ok: false,
      message: "Failed to parse `gh pr checks` output.",
      metadata: {
        error: error instanceof Error ? error.message : String(error),
        prUrl,
      },
    };
  }

  const failingChecks = (Array.isArray(parsedChecks) ? parsedChecks : []).filter(isFailingCheck) as Array<
    Record<string, unknown>
  >;

  if (failingChecks.length === 0) {
    return {
      ok: false,
      message: "`gh pr checks` reported no failing checks to fetch logs for.",
      metadata: {
        prUrl,
      },
    };
  }

  const checks: FailingCheckLog[] = [];

  for (const check of failingChecks) {
    const name = typeof check.name === "string" && check.name.length > 0 ? check.name : "Unnamed check";
    const url = typeof check.link === "string" && check.link.length > 0 ? check.link : null;
    const runId = extractActionsRunId(url);

    if (!runId) {
      checks.push({
        detail: url
          ? `No GitHub Actions log is available for this check. Details: ${url}`
          : "No GitHub Actions log or details URL is available for this check.",
        name,
        runId: null,
        source: "details-url-fallback",
        url,
      });
      continue;
    }

    try {
      const log = await run("gh", ["run", "view", runId, "--log-failed"], localPath);

      checks.push({
        detail: log,
        name,
        runId,
        source: "actions-log",
        url,
      });
    } catch (error) {
      return {
        ok: false,
        message: `Failed to fetch failed-step log for check "${name}" via gh.`,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          prUrl,
        },
      };
    }
  }

  const feedback = buildFeedback(checks);

  return {
    ok: true,
    metadata: {
      checkNames: checks.map((check) => check.name),
      checks,
      feedback,
    },
  };
};

export type AutoRetryDecision =
  | {
      outcome: "budget-exhausted";
    }
  | {
      outcome: "fetch-failed";
      reason: string;
    }
  | {
      outcome: "retry";
    };

/**
 * Decides what `ferret-runner` should do about a `CHECKS_FAILED` pull request, given
 * the job's durable auto-retry counter and (if the budget allows it) the result of
 * fetching the failing check logs. Pure decision logic, kept separate from the
 * `index.ts` orchestration (db writes, job events, Slack) so the budget/fallback
 * branching is unit-testable on its own.
 */
export const decideAutoRetryOutcome = ({
  autoRetryCount,
  fetchResult,
  maxAutoRetries,
}: {
  autoRetryCount: number;
  fetchResult: FetchFailingCheckLogsResult | null;
  maxAutoRetries: number;
}): AutoRetryDecision => {
  if (autoRetryCount >= maxAutoRetries) {
    return {
      outcome: "budget-exhausted",
    };
  }

  if (!fetchResult || !fetchResult.ok) {
    return {
      outcome: "fetch-failed",
      reason: fetchResult?.message ?? "Auto-retry budget is available, but no failing check logs were fetched.",
    };
  }

  return {
    outcome: "retry",
  };
};

/**
 * Builds the run metadata for an auto-heal retry, using the same `retryFeedback`
 * shape the manual `/jobs/:id/retry-stage` route writes and clearing the run's
 * `validation` / `pullRequest` metadata, so the next Codex pass starts clean
 * regardless of whether the retry was triggered by a human or by auto-heal.
 */
export const buildAutoRetryRunMetadata = ({
  feedback,
  previousRunStatus,
  previousStatus,
  runMetadata,
}: {
  feedback: string;
  previousRunStatus: string;
  previousStatus: string;
  runMetadata: Record<string, unknown>;
}) => {
  const { pullRequest: _pullRequest, validation: _validation, ...rest } = runMetadata;

  return {
    ...rest,
    retryFeedback: {
      createdAt: new Date().toISOString(),
      feedback,
      previousRunStatus,
      previousStatus,
    },
  };
};
