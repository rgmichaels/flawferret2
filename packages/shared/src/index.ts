import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const serviceName = "flawferret2";

export const TEST_ARCHITECT_PROMPT_PREFACE =
  "You are a principal Software Development Engineer in Test specializing in Playwright, TypeScript, Cucumber BDD, API testing, and maintainable test architecture. Your primary objective is to improve long-term test reliability, readability, and maintainability rather than simply making tests pass.";

export const MODEL_PROMPT_PREFACE_CONFIG_PATH = "config/model-prompt-preface.txt";

const findUp = (startDirectory: string, relativePath: string) => {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    const candidate = join(currentDirectory, relativePath);

    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
};

export const getConfiguredModelPromptPreface = ({
  cwd = process.cwd(),
  env = process.env,
}: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}) => {
  const directPreface = env.FF2_MODEL_PROMPT_PREFACE?.trim();

  if (directPreface) {
    return directPreface;
  }

  const configuredPath = env.FF2_MODEL_PROMPT_PREFACE_PATH?.trim();
  const promptPrefacePath = configuredPath
    ? isAbsolute(configuredPath)
      ? configuredPath
      : resolve(cwd, configuredPath)
    : findUp(cwd, MODEL_PROMPT_PREFACE_CONFIG_PATH);

  if (promptPrefacePath && existsSync(promptPrefacePath)) {
    const filePreface = readFileSync(promptPrefacePath, "utf8").trim();

    if (filePreface.length > 0) {
      return filePreface;
    }
  }

  return TEST_ARCHITECT_PROMPT_PREFACE;
};

export type SlackNotificationResult =
  | {
      reason: "not_configured";
      sent: false;
    }
  | {
      sent: true;
    }
  | {
      reason: string;
      sent: false;
    };

export const shortJobId = (jobId: string) => `#${jobId.slice(0, 8)}`;

export const getJobTitle = (payload: unknown) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "Untitled job";
  }

  const { featureArea, goal } = payload as Record<string, unknown>;

  if (typeof featureArea === "string" && featureArea.trim().length > 0) {
    return featureArea.trim();
  }

  if (typeof goal === "string" && goal.trim().length > 0) {
    return goal.trim();
  }

  return "Untitled job";
};

export const getJobGoal = (payload: unknown) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const { goal } = payload as Record<string, unknown>;

  return typeof goal === "string" && goal.trim().length > 0 ? goal.trim() : null;
};

export const sendSlackNotification = async ({
  text,
  webhookUrl,
}: {
  text: string;
  webhookUrl?: string | null;
}): Promise<SlackNotificationResult> => {
  if (!webhookUrl) {
    return {
      reason: "not_configured",
      sent: false,
    };
  }

  try {
    const response = await fetch(webhookUrl, {
      body: JSON.stringify({
        text,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      return {
        reason: `Slack webhook returned HTTP ${response.status}`,
        sent: false,
      };
    }

    return {
      sent: true,
    };
  } catch (error) {
    return {
      reason: error instanceof Error ? error.message : "Slack webhook request failed",
      sent: false,
    };
  }
};
