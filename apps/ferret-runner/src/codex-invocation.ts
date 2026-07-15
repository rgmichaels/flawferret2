import type { ClaimedCodexJob } from "@flawferret2/db";

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
