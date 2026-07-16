export const serviceName = "flawferret2";

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
