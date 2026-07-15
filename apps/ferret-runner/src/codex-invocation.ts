import type { ClaimedCodexJob } from "@flawferret2/db";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

export type CodexInvocationPlan = {
  args: string[];
  command: string;
  enabled: boolean;
  localPath: string | null;
  model: string | null;
  prompt: string;
  timeoutMs: number;
  workBranch: string | null;
};

export type CodexInvocationResult = {
  error: string | null;
  exitCode: number | null;
  finalResponse: string | null;
  logPath: string;
  ok: boolean;
  stderrPath: string;
  timedOut: boolean;
  usage: unknown;
};

type BuildCodexInvocationPlanInput = {
  codexCommand: string;
  codexEnabled: boolean;
  codexModel?: string;
  codexTimeoutMs: number;
  job: ClaimedCodexJob;
};

const getStringMetadataValue = (metadata: unknown, key: string) => {
  if (!metadata || typeof metadata !== "object" || !(key in metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];

  return typeof value === "string" && value.length > 0 ? value : null;
};

const getPayloadValue = (payload: unknown, key: string) => {
  if (!payload || typeof payload !== "object" || !(key in payload)) {
    return "";
  }

  const value = (payload as Record<string, unknown>)[key];

  return typeof value === "string" ? value : "";
};

const sanitizePathPart = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, "-");

const textFromUnknown = (value: unknown): string | null => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }

        return "";
      })
      .filter(Boolean)
      .join("\n");

    return text.length > 0 ? text : null;
  }

  return null;
};

const extractCodexProgress = (line: string) => {
  try {
    const event = JSON.parse(line) as unknown;

    if (!event || typeof event !== "object") {
      return {
        finalResponse: null,
        usage: null,
      };
    }

    const record = event as Record<string, unknown>;
    const type = record.type;
    const item = record.item;
    const finalResponse =
      type === "item.completed" && item && typeof item === "object"
        ? textFromUnknown((item as Record<string, unknown>).text) ??
          textFromUnknown((item as Record<string, unknown>).content)
        : textFromUnknown(record.final_response) ?? textFromUnknown(record.finalResponse);
    const usage = type === "turn.completed" && "usage" in record ? record.usage : null;

    return {
      finalResponse,
      usage,
    };
  } catch {
    return {
      finalResponse: null,
      usage: null,
    };
  }
};

export const buildCodexPrompt = (job: ClaimedCodexJob) => {
  const latestRun = job.runs[0] ?? null;
  const workBranch = getStringMetadataValue(latestRun?.metadata, "workBranch") ?? "unknown";
  const targetBranch =
    getPayloadValue(job.payload, "targetBranch") ||
    getPayloadValue(job.payload, "branch") ||
    "main";

  return [
    "You are working on a FlawFerret2 ADD_PLAYWRIGHT_TEST job.",
    "",
    "Repository:",
    job.repository ? `${job.repository.owner}/${job.repository.name}` : "unknown",
    "",
    "Branch context:",
    `- Target branch: ${targetBranch}`,
    `- Current generated work branch: ${workBranch}`,
    "",
    "Request:",
    `- Feature area: ${getPayloadValue(job.payload, "featureArea")}`,
    `- Goal: ${getPayloadValue(job.payload, "goal")}`,
    `- Acceptance criteria: ${getPayloadValue(job.payload, "acceptanceCriteria")}`,
    "",
    "Instructions:",
    "- Add or update the minimal Playwright test coverage needed for the request.",
    "- Keep changes narrowly scoped.",
    "- Do not push branches or create pull requests.",
    "- Run only the smallest relevant local checks you need.",
    "- Leave a concise summary of changed files and verification performed.",
  ].join("\n");
};

export const buildCodexInvocationPlan = ({
  codexCommand,
  codexEnabled,
  codexModel,
  codexTimeoutMs,
  job,
}: BuildCodexInvocationPlanInput): CodexInvocationPlan => {
  const latestRun = job.runs[0] ?? null;
  const localPath = getStringMetadataValue(latestRun?.metadata, "localPath");
  const workBranch = getStringMetadataValue(latestRun?.metadata, "workBranch");
  const prompt = buildCodexPrompt(job);
  const args = ["exec", "--json", "--sandbox", "workspace-write"];

  if (codexModel) {
    args.push("--model", codexModel);
  }

  args.push(prompt);

  return {
    args,
    command: codexCommand,
    enabled: codexEnabled,
    localPath,
    model: codexModel ?? null,
    prompt,
    timeoutMs: codexTimeoutMs,
    workBranch,
  };
};

export const runCodexInvocation = async ({
  jobId,
  logDir,
  plan,
  runId,
}: {
  jobId: string;
  logDir: string;
  plan: CodexInvocationPlan;
  runId: string;
}): Promise<CodexInvocationResult> => {
  if (!plan.localPath) {
    throw new Error("Cannot run Codex without a local checkout path.");
  }

  const runLogDir = resolve(
    logDir,
    sanitizePathPart(jobId),
    sanitizePathPart(runId),
  );
  await mkdir(runLogDir, {
    recursive: true,
  });

  const logPath = join(runLogDir, "codex.jsonl");
  const stderrPath = join(runLogDir, "codex.stderr.log");
  const stdoutStream = createWriteStream(logPath, {
    flags: "a",
  });
  const stderrStream = createWriteStream(stderrPath, {
    flags: "a",
  });

  let finalResponse: string | null = null;
  let spawnErrorMessage: string | null = null;
  let stdoutBuffer = "";
  let timedOut = false;
  let usage: unknown = null;

  const child = spawn(plan.command, plan.args, {
    cwd: plan.localPath,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");

    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 5000).unref();
  }, plan.timeoutMs);
  timeout.unref();

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutStream.write(chunk);
    stdoutBuffer += chunk.toString("utf8");

    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }

      const progress = extractCodexProgress(line);

      if (progress.finalResponse) {
        finalResponse = progress.finalResponse;
      }

      if (progress.usage) {
        usage = progress.usage;
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrStream.write(chunk);
  });

  const exitCode = await new Promise<number | null>((resolveExit) => {
    child.on("error", (error) => {
      spawnErrorMessage = error.message;
      resolveExit(null);
    });
    child.on("close", (code) => {
      resolveExit(code);
    });
  }).finally(() => {
    clearTimeout(timeout);
  });

  if (stdoutBuffer.trim().length > 0) {
    const progress = extractCodexProgress(stdoutBuffer);

    if (progress.finalResponse) {
      finalResponse = progress.finalResponse;
    }

    if (progress.usage) {
      usage = progress.usage;
    }
  }

  await Promise.all([
    new Promise<void>((resolveStream) => stdoutStream.end(resolveStream)),
    new Promise<void>((resolveStream) => stderrStream.end(resolveStream)),
  ]);

  return {
    error: spawnErrorMessage,
    exitCode,
    finalResponse,
    logPath,
    ok: exitCode === 0 && !timedOut && !spawnErrorMessage,
    stderrPath,
    timedOut,
    usage,
  };
};
