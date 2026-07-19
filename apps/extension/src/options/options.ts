type JiraConfig = {
  baseUrl: string;
  email: string;
  token: string;
};

type AiConfig = {
  serverUrl: string;
  provider: "openai" | "ollama";
  model: string;
  ollamaUrl: string;
};

type FlawFerret2Config = {
  baseUrl: string;
};

const DEFAULT_FLAWFERRET2_BASE_URL = "http://localhost:3000";

const baseUrlEl = document.getElementById("baseUrl") as HTMLInputElement;
const emailEl = document.getElementById("email") as HTMLInputElement;
const tokenEl = document.getElementById("token") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const saveButton = document.getElementById("save") as HTMLButtonElement;
const testButton = document.getElementById("test") as HTMLButtonElement;
const aiServerEl = document.getElementById("aiServer") as HTMLInputElement;
const aiProviderEl = document.getElementById("aiProvider") as HTMLSelectElement;
const aiModelEl = document.getElementById("aiModel") as HTMLInputElement;
const ollamaUrlEl = document.getElementById("ollamaUrl") as HTMLInputElement;
const aiStatusEl = document.getElementById("aiStatus") as HTMLSpanElement;
const saveAiButton = document.getElementById("saveAi") as HTMLButtonElement;
const testAiButton = document.getElementById("testAi") as HTMLButtonElement;
const ff2BaseUrlEl = document.getElementById("ff2BaseUrl") as HTMLInputElement;
const ff2StatusEl = document.getElementById("ff2Status") as HTMLSpanElement;
const saveFf2Button = document.getElementById("saveFf2") as HTMLButtonElement;

const setStatus = (message: string, isError = false) => {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b00020" : "#1f1f1f";
};

const setAiStatus = (message: string, isError = false) => {
  aiStatusEl.textContent = message;
  aiStatusEl.style.color = isError ? "#b00020" : "#1f1f1f";
};

const setFf2Status = (message: string, isError = false) => {
  ff2StatusEl.textContent = message;
  ff2StatusEl.style.color = isError ? "#b00020" : "#1f1f1f";
};

const loadConfig = async () => {
  const stored = (await chrome.storage.local.get([
    "jiraConfig",
    "aiConfig",
    "flawFerret2Config",
  ])) as {
    jiraConfig?: JiraConfig;
    aiConfig?: AiConfig;
    flawFerret2Config?: FlawFerret2Config;
  };
  const config = stored.jiraConfig;
  if (config) {
    baseUrlEl.value = config.baseUrl || "";
    emailEl.value = config.email || "";
    tokenEl.value = config.token || "";
  }
  const aiConfig = stored.aiConfig;
  if (aiConfig) {
    aiServerEl.value = aiConfig.serverUrl || "";
    aiProviderEl.value = aiConfig.provider || "ollama";
    aiModelEl.value = aiConfig.model || "codellama";
    ollamaUrlEl.value = aiConfig.ollamaUrl || "http://localhost:11434";
  }
  ff2BaseUrlEl.value =
    stored.flawFerret2Config?.baseUrl || DEFAULT_FLAWFERRET2_BASE_URL;
};

const saveConfig = async () => {
  const config: JiraConfig = {
    baseUrl: baseUrlEl.value.trim(),
    email: emailEl.value.trim(),
    token: tokenEl.value.trim(),
  };
  await chrome.storage.local.set({ jiraConfig: config });
};

const saveAiConfig = async () => {
  const config: AiConfig = {
    serverUrl: aiServerEl.value.trim(),
    provider: (aiProviderEl.value as "openai" | "ollama") || "ollama",
    model: aiModelEl.value.trim() || "codellama",
    ollamaUrl: ollamaUrlEl.value.trim() || "http://localhost:11434",
  };
  await chrome.storage.local.set({ aiConfig: config });
};

const normalizeFf2BaseUrl = (value: string): string | null => {
  const trimmed = value.trim() || DEFAULT_FLAWFERRET2_BASE_URL;

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
};

const saveFf2Config = async (): Promise<boolean> => {
  const baseUrl = normalizeFf2BaseUrl(ff2BaseUrlEl.value);

  if (!baseUrl) {
    setFf2Status("Enter a valid URL", true);
    return false;
  }

  const config: FlawFerret2Config = {
    baseUrl,
  };
  await chrome.storage.local.set({ flawFerret2Config: config });
  ff2BaseUrlEl.value = baseUrl;
  return true;
};

saveButton.addEventListener("click", async () => {
  await saveConfig();
  setStatus("Saved");
});

saveAiButton.addEventListener("click", async () => {
  await saveAiConfig();
  setAiStatus("Saved");
});

saveFf2Button.addEventListener("click", async () => {
  const saved = await saveFf2Config();

  if (saved) {
    setFf2Status("Saved");
  }
});

testAiButton.addEventListener("click", async () => {
  setAiStatus("Testing...");
  await saveAiConfig();
  chrome.runtime.sendMessage({ type: "ai:test" }, (response) => {
    if (chrome.runtime.lastError) {
      setAiStatus(chrome.runtime.lastError.message, true);
      return;
    }
    if (!response?.ok) {
      setAiStatus(response?.error || "Test failed", true);
      return;
    }
    setAiStatus(response?.message || "Connection OK");
  });
});

testButton.addEventListener("click", async () => {
  setStatus("Testing...");
  await saveConfig();
  chrome.runtime.sendMessage({ type: "jira:test" }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, true);
      return;
    }
    if (!response?.ok) {
      setStatus(response?.error || "Test failed", true);
      return;
    }
    setStatus("Connection OK");
  });
});

void loadConfig();
