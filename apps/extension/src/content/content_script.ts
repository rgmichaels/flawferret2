type SelectorCandidate = {
  kind: "byRole" | "byLabel" | "byPlaceholder" | "byTestId" | "byText" | "css";
  selector: string;
  reason: string;
};

type OverlayMeta = {
  title: string;
  elementKey: string;
  url: string;
  role: string | null;
  name: string | null;
  outerHTML: string;
  selectors: SelectorCandidate[];
  captureRect: { x: number; y: number; width: number; height: number } | null;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  snapshotUrl: string | null;
  selectedText: string | null;
  imageName: string | null;
  thenLine: string;
  recordingDataUrl: string | null;
  recordingId: string | null;
  initialUi?: {
    projectKey?: string;
    issueType?: string;
    summary?: string;
    cucumber?: string;
  };
};

type CaptureResult = {
  ok: boolean;
  error?: string;
  data?: {
    url: string;
    title: string;
    pageKey: string;
    role: string | null;
    name: string | null;
    outerHTML: string;
    elementKey: string;
    selectors: SelectorCandidate[];
    warnings: string[];
  };
};

const DEFAULT_FLAWFERRET2_BASE_URL = "http://localhost:3000";

let lastRightClickedElement: Element | null = null;

document.addEventListener(
  "contextmenu",
  (event) => {
    if (event.target && event.target instanceof Element) {
      lastRightClickedElement = event.target as Element;
    }
  },
  true
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "capture-and-copy") {
    void handleCaptureAndCopy()
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) })
      );
    return true;
  }
  if (message?.type === "record:stopped") {
    const context = message.recordingContext as { text: string; meta: OverlayMeta };
    if (context) {
      showOverlay(context.text, {
        ...context.meta,
        recordingDataUrl: message.recordingDataUrl || null,
        recordingId: message.recordingId || null,
      });
    }
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

void initRecordingControl();

async function handleCaptureAndCopy(): Promise<CaptureResult> {
  const target = pickTargetElement();
  if (!target) {
    return { ok: false, error: "No element found." };
  }

  const capture = buildCapture(target);
  const output = formatClipboard(capture);
  const captureRect = getCaptureRect(target);
  const snapshotUrl = captureRect ? await requestSnapshot(captureRect) : null;
  showOverlay(output, {
    title: capture.title,
    elementKey: capture.elementKey,
    url: capture.url,
    role: capture.role,
    name: capture.name,
    outerHTML: capture.outerHTML,
    selectors: capture.selectors,
    captureRect,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio || 1,
    snapshotUrl,
    selectedText: capture.selectedText,
    imageName: capture.imageName,
    thenLine: buildThenLine(capture),
    recordingDataUrl: null,
    recordingId: null,
  });
  return { ok: true, data: capture };
}

function pickTargetElement(): Element | null {
  if (lastRightClickedElement && document.contains(lastRightClickedElement)) {
    return lastRightClickedElement;
  }
  const active = document.activeElement;
  if (active && active !== document.body) return active;
  return document.body;
}

function buildCapture(element: Element) {
  const url = window.location.href;
  const title = document.title || "";
  const pageKey = buildPageKey(url, title);
  const selectedText = getSelectedText();
  const imageName = getImageName(element);
  const role = getRole(element);
  const name = getAccessibleName(element);
  const outerHTML = getOuterHtmlSnippet(element);

  const selectors = buildSelectors(element, role, name);
  const elementKey = buildElementKey(element, role, name, selectors);
  const warnings = buildWarnings(selectors, name, element);

  return {
    url,
    title,
    pageKey,
    selectedText,
    imageName,
    role,
    name,
    outerHTML,
    elementKey,
    selectors,
    warnings,
  };
}

function getRole(element: Element): string | null {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;

  const tag = element.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a" && (element as HTMLAnchorElement).href) return "link";
  if (tag === "img") return "img";
  if (tag === "input") {
    const type = (element as HTMLInputElement).type;
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "submit" || type === "button") return "button";
    return "textbox";
  }
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  return null;
}

function getAccessibleName(element: Element): string | null {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return normalizeWhitespace(ariaLabel);

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ")
      .trim();
    if (text) return normalizeWhitespace(text);
  }

  if (element instanceof HTMLImageElement) {
    const alt = element.getAttribute("alt");
    if (alt) return normalizeWhitespace(alt);
  }

  const labelText = findLabelText(element);
  if (labelText) return normalizeWhitespace(labelText);

  const placeholder = (element as HTMLInputElement).getAttribute?.("placeholder");
  if (placeholder) return normalizeWhitespace(placeholder);

  const title = element.getAttribute("title");
  if (title) return normalizeWhitespace(title);

  const text = element.textContent?.trim();
  if (text) return normalizeWhitespace(text);

  return null;
}

function findLabelText(element: Element): string | null {
  if (!(element instanceof HTMLElement)) return null;
  if (element.id) {
    const label = document.querySelector(`label[for="${cssEscape(element.id)}"]`);
    if (label?.textContent) return label.textContent;
  }
  const parentLabel = element.closest("label");
  if (parentLabel?.textContent) return parentLabel.textContent;
  return null;
}

function buildSelectors(
  element: Element,
  role: string | null,
  name: string | null
): SelectorCandidate[] {
  const selectors: SelectorCandidate[] = [];

  if (role && name) {
    selectors.push({
      kind: "byRole",
      selector: `getByRole('${escapeQuotes(role)}', { name: '${escapeQuotes(name)}' })`,
      reason: "Accessible role + name",
    });
  } else if (role) {
    selectors.push({
      kind: "byRole",
      selector: `getByRole('${escapeQuotes(role)}')`,
      reason: "Accessible role",
    });
  }

  const labelText = findLabelText(element);
  if (labelText) {
    selectors.push({
      kind: "byLabel",
      selector: `getByLabel('${escapeQuotes(normalizeWhitespace(labelText))}')`,
      reason: "Associated label",
    });
  }

  const placeholder = (element as HTMLInputElement).getAttribute?.("placeholder");
  if (placeholder) {
    selectors.push({
      kind: "byPlaceholder",
      selector: `getByPlaceholder('${escapeQuotes(normalizeWhitespace(placeholder))}')`,
      reason: "Placeholder text",
    });
  }

  const testId =
    element.getAttribute("data-testid") ||
    element.getAttribute("data-test-id") ||
    (element as HTMLElement).dataset?.testid;
  if (testId) {
    selectors.push({
      kind: "byTestId",
      selector: `getByTestId('${escapeQuotes(testId)}')`,
      reason: "data-testid",
    });
  }

  const textContent = normalizeWhitespace(element.textContent || "");
  if (textContent) {
    selectors.push({
      kind: "byText",
      selector: `getByText('${escapeQuotes(textContent)}')`,
      reason: "Visible text",
    });
  }

  selectors.push({
    kind: "css",
    selector: buildCssSelector(element),
    reason: "CSS fallback",
  });

  return selectors;
}

function buildElementKey(
  element: Element,
  role: string | null,
  name: string | null,
  selectors: SelectorCandidate[]
): string {
  const id = (element as HTMLElement).id;
  const text = name || id || element.tagName.toLowerCase();
  const base = text.replace(/[^a-zA-Z0-9\s_-]/g, " ").trim();
  const words = base.split(/\s+/).filter(Boolean);
  const rolePrefix = role ? `${role}_` : "";
  const raw = `${rolePrefix}${words.join("_")}`.toLowerCase();
  const compact = raw.replace(/_+/g, "_").slice(0, 40);
  if (compact.length > 0) return compact;
  const fallback = selectors[0]?.kind || "element";
  return `element_${fallback}`;
}

function buildWarnings(
  selectors: SelectorCandidate[],
  name: string | null,
  element: Element
): string[] {
  const warnings: string[] = [];
  const hasCss = selectors.some((s) => s.kind === "css");
  if (hasCss) warnings.push("A) CSS fallback included");

  if (name && looksDynamicText(name)) {
    warnings.push("B) Text looks dynamic (numbers or variable tokens)");
  }

  const textContent = normalizeWhitespace(element.textContent || "");
  if (textContent) {
    const sameTextCount = countElementsByText(textContent);
    if (sameTextCount > 1) {
      warnings.push("C) Multiple elements share the same text");
    }
  }

  return warnings;
}

function looksDynamicText(text: string): boolean {
  return /\d{2,}/.test(text) || /#\d+/.test(text);
}

function countElementsByText(text: string): number {
  const matches = Array.from(document.querySelectorAll("body *")).filter(
    (el) => normalizeWhitespace(el.textContent || "") === text
  );
  return matches.length;
}

function buildCssSelector(element: Element): string {
  if (!(element instanceof Element)) return "";
  const id = (element as HTMLElement).id;
  if (id) return `#${cssEscape(id)}`;

  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  while (current && current.tagName.toLowerCase() !== "html" && depth < 4) {
    const tag = current.tagName.toLowerCase();
    const className = current.className
      ? `.${Array.from(current.classList)
          .slice(0, 2)
          .map(cssEscape)
          .join(".")}`
      : "";
    const siblingIndex = getSiblingIndex(current);
    const nth = siblingIndex > 0 ? `:nth-of-type(${siblingIndex})` : "";
    parts.unshift(`${tag}${className}${nth}`);
    current = current.parentElement;
    depth += 1;
  }
  return parts.join(" > ") || element.tagName.toLowerCase();
}

function getSiblingIndex(element: Element): number {
  if (!element.parentElement) return 0;
  const siblings = Array.from(element.parentElement.children).filter(
    (child) => child.tagName === element.tagName
  );
  const index = siblings.indexOf(element);
  return index >= 0 ? index + 1 : 0;
}

function getOuterHtmlSnippet(element: Element): string {
  const html = element.outerHTML || "";
  const cleaned = html.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 200) return cleaned;
  return `${cleaned.slice(0, 200)}…`;
}

function formatClipboard(capture: {
  url: string;
  title: string;
  pageKey: string;
  selectedText: string | null;
  imageName: string | null;
  role: string | null;
  name: string | null;
  outerHTML: string;
  elementKey: string;
  selectors: SelectorCandidate[];
  warnings: string[];
}): string {
  const scenario = [
    `Given I am on the "${capture.pageKey}" page`,
    buildThenLine(capture),
  ].join("\n");
  return appendPageLine(scenario, capture.url);
}

function appendPageLine(text: string, url: string): string {
  const trimmed = text.trim();
  return `${trimmed}\n\nPage: ${url}`;
}

function buildMappingBlock(capture: {
  url: string;
  title: string;
  role: string | null;
  name: string | null;
  outerHTML: string;
  elementKey: string;
  selectors: SelectorCandidate[];
}): string {
  const prefer = capture.selectors[0];
  const fallbacks = capture.selectors.slice(1);

  return [
    `${capture.elementKey}:`,
    `  prefer: ${prefer ? `'${prefer.selector}'` : "''"}`,
    `  fallback:`,
    ...fallbacks.map((s) => `  - '${s.selector}'`),
    `  meta:`,
    `    url: '${escapeQuotes(capture.url)}'`,
    `    title: '${escapeQuotes(capture.title)}'`,
    `    role: '${escapeQuotes(capture.role || "")}'`,
    `    name: '${escapeQuotes(capture.name || "")}'`,
    `    html: '${escapeQuotes(capture.outerHTML)}'`,
  ].join("\n");
}

function buildPageKey(url: string, title: string): string {
  const titleKey = normalizeWhitespace(title);
  return titleKey || "home";
}

function buildThenLine(capture: {
  elementKey: string;
  selectedText: string | null;
  imageName: string | null;
  role: string | null;
  name: string | null;
}): string {
  if (capture.selectedText) {
    return `Then the text "${capture.selectedText}" should be visible`;
  }
  if (capture.imageName) {
    return `Then the image "${capture.imageName}" should be visible`;
  }
  if (capture.role === "link" && capture.name) {
    return `Then the link "${capture.name}" should be visible`;
  }
  return `Then the "${capture.elementKey}" should be visible`;
}

function getSelectedText(): string | null {
  const selection = window.getSelection();
  const text = selection?.toString().trim() || "";
  return text.length > 0 ? normalizeWhitespace(text) : null;
}

function getImageName(element: Element): string | null {
  if (!(element instanceof HTMLImageElement)) return null;
  const src = element.currentSrc || element.src;
  if (!src) return null;
  try {
    const url = new URL(src, window.location.href);
    const parts = url.pathname.split("/").filter(Boolean);
    const file = parts[parts.length - 1];
    return file || "image";
  } catch {
    const parts = src.split("/").filter(Boolean);
    return parts[parts.length - 1] || "image";
  }
}

function getCaptureRect(
  element: Element
): { x: number; y: number; width: number; height: number } | null {
  const selectionRect = getSelectionRect();
  const rect = selectionRect || element.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const x = clamp(rect.left, 0, viewportWidth);
  const y = clamp(rect.top, 0, viewportHeight);
  const right = clamp(rect.right, 0, viewportWidth);
  const bottom = clamp(rect.bottom, 0, viewportHeight);
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);

  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function getSelectionRect(): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rects = Array.from(range.getClientRects());
  if (rects.length === 0) {
    const rect = range.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  }

  let left = rects[0].left;
  let top = rects[0].top;
  let right = rects[0].right;
  let bottom = rects[0].bottom;

  rects.slice(1).forEach((rect) => {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  });

  return new DOMRect(left, top, right - left, bottom - top);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function requestSnapshot(
  rect: { x: number; y: number; width: number; height: number }
): Promise<string | null> {
  const dpr = window.devicePixelRatio || 1;
  const scaled = {
    x: rect.x * dpr,
    y: rect.y * dpr,
    width: rect.width * dpr,
    height: rect.height * dpr,
  };
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "capture:snapshot-preview", rect: scaled },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        if (!response?.ok || !response?.dataUrl) {
          resolve(null);
          return;
        }
        resolve(response.dataUrl);
      }
    );
  });
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeQuotes(value: string): string {
  return value.replace(/'/g, "\\'");
}

function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (match) => `\\${match}`);
}

function showOverlay(text: string, meta: OverlayMeta): void {
  const existing = document.getElementById("test-authoring-helper-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "test-authoring-helper-overlay";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.25)";
  overlay.style.zIndex = "2147483647";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";

  const card = document.createElement("div");
  card.style.width = "min(860px, 92vw)";
  card.style.maxHeight = "85vh";
  card.style.background = "#ffffff";
  card.style.borderRadius = "12px";
  card.style.boxShadow = "0 20px 60px rgba(0,0,0,0.35)";
  card.style.display = "flex";
  card.style.flexDirection = "column";
  card.style.overflow = "hidden";
  card.style.border = "1px solid #e0d8cc";

  const header = document.createElement("div");
  header.style.background = "#1f1f1f";
  header.style.color = "#ffffff";
  header.style.padding = "12px 16px";
  header.style.fontFamily = "system-ui, -apple-system, sans-serif";
  header.style.fontWeight = "600";
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.gap = "8px";
  header.style.cursor = "move";

  const headerTitle = document.createElement("div");
  headerTitle.textContent = "FlawFerret";

  const headerCloseButton = document.createElement("button");
  headerCloseButton.textContent = "✕";
  headerCloseButton.title = "Close";
  headerCloseButton.setAttribute("aria-label", "Close");
  headerCloseButton.style.width = "30px";
  headerCloseButton.style.height = "30px";
  headerCloseButton.style.padding = "0";
  headerCloseButton.style.borderRadius = "8px";
  headerCloseButton.style.border = "1px solid rgba(255,255,255,0.55)";
  headerCloseButton.style.background = "transparent";
  headerCloseButton.style.color = "#ffffff";
  headerCloseButton.style.cursor = "pointer";
  headerCloseButton.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });
  headerCloseButton.addEventListener("click", (event) => {
    event.stopPropagation();
    overlay.remove();
  });

  header.appendChild(headerTitle);
  header.appendChild(headerCloseButton);

  const body = document.createElement("div");
  body.style.padding = "12px 16px";
  body.style.overflow = "auto";
  body.style.background = "#f8f4ee";

  const gherkinKeywords = [
    "Feature",
    "Rule",
    "Background",
    "Scenario",
    "Scenario Outline",
    "Examples",
    "Given",
    "When",
    "Then",
    "And",
    "But",
  ];

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.width = "100%";
  textarea.style.minHeight = "220px";
  textarea.style.resize = "vertical";
  textarea.style.margin = "0";
  textarea.style.padding = "10px";
  textarea.style.whiteSpace = "pre-wrap";
  textarea.style.wordBreak = "break-word";
  textarea.style.fontFamily =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
  textarea.style.fontSize = "13px";
  textarea.style.color = "#1f1f1f";
  textarea.style.border = "1px solid #e0d8cc";
  textarea.style.borderRadius = "8px";
  textarea.style.background = "#ffffff";

  const makeKeywordButton = (keyword: string) => {
    const button = document.createElement("button");
    button.textContent = keyword;
    button.style.padding = "6px 10px";
    button.style.borderRadius = "999px";
    button.style.border = "1px solid #1f1f1f";
    button.style.background = "#ffffff";
    button.style.color = "#1f1f1f";
    button.style.cursor = "pointer";
    button.style.fontSize = "12px";
    button.addEventListener("click", () => {
      insertAtCursor(textarea, `${keyword} `);
      textarea.focus();
    });
    return button;
  };

  const jiraPanel = document.createElement("div");
  jiraPanel.style.marginBottom = "12px";
  jiraPanel.style.padding = "12px";
  jiraPanel.style.borderRadius = "10px";
  jiraPanel.style.border = "1px solid #e0d8cc";
  jiraPanel.style.background = "#ffffff";
  jiraPanel.style.setProperty("color", "#1f1f1f", "important");

  const jiraHeader = document.createElement("div");
  jiraHeader.style.display = "flex";
  jiraHeader.style.alignItems = "center";
  jiraHeader.style.justifyContent = "space-between";
  jiraHeader.style.marginBottom = "8px";

  const jiraTitle = document.createElement("div");
  jiraTitle.textContent = "Create Jira Ticket";
  jiraTitle.style.fontWeight = "600";
  jiraTitle.style.fontFamily = "system-ui, -apple-system, sans-serif";
  jiraTitle.style.setProperty("color", "#1f1f1f", "important");

  const jiraRow = document.createElement("div");
  jiraRow.style.display = "flex";
  jiraRow.style.gap = "8px";
  jiraRow.style.flexWrap = "wrap";

  const issueTypeSelect = document.createElement("select");
  issueTypeSelect.style.flex = "0 1 140px";
  issueTypeSelect.style.padding = "8px 10px";
  issueTypeSelect.style.borderRadius = "8px";
  issueTypeSelect.style.border = "1px solid #e0d8cc";
  issueTypeSelect.style.background = "#ffffff";
  issueTypeSelect.style.setProperty("color", "#1f1f1f", "important");
  const issueTypePlaceholder = document.createElement("option");
  issueTypePlaceholder.value = "";
  issueTypePlaceholder.textContent = "Issue type";
  issueTypeSelect.appendChild(issueTypePlaceholder);

  const projectSelect = document.createElement("select");
  projectSelect.style.flex = "1 1 200px";
  projectSelect.style.padding = "8px 10px";
  projectSelect.style.borderRadius = "8px";
  projectSelect.style.border = "1px solid #e0d8cc";
  projectSelect.style.background = "#ffffff";
  projectSelect.style.setProperty("color", "#1f1f1f", "important");

  const summaryInput = document.createElement("input");
  summaryInput.type = "text";
  summaryInput.style.flex = "2 1 320px";
  summaryInput.style.padding = "8px 10px";
  summaryInput.style.borderRadius = "8px";
  summaryInput.style.border = "1px solid #e0d8cc";
  summaryInput.style.background = "#ffffff";
  summaryInput.style.setProperty("color", "#1f1f1f", "important");
  summaryInput.value = `UI: ${meta.elementKey} should be visible`;

  const jiraStatus = document.createElement("div");
  jiraStatus.style.fontSize = "12px";
  jiraStatus.style.color = "#4b4b4b";

  const jiraLink = document.createElement("a");
  jiraLink.style.fontSize = "12px";
  jiraLink.style.color = "#1f1f1f";
  jiraLink.style.marginLeft = "8px";
  jiraLink.style.textDecoration = "underline";
  jiraLink.style.display = "none";
  jiraLink.target = "_blank";

  const shareActionButton = document.createElement("button");
  shareActionButton.textContent = "Copy Share Update";
  shareActionButton.style.padding = "4px 10px";
  shareActionButton.style.borderRadius = "999px";
  shareActionButton.style.border = "1px solid #1f1f1f";
  shareActionButton.style.background = "#ffffff";
  shareActionButton.style.color = "#1f1f1f";
  shareActionButton.style.fontSize = "12px";
  shareActionButton.style.cursor = "pointer";
  shareActionButton.style.display = "none";

  let createdIssueKey: string | null = null;
  let createdIssueUrl: string | null = null;

  shareActionButton.addEventListener("click", async () => {
    if (!createdIssueKey) return;
    const sharePacket = buildSharePacket({
      issueKey: createdIssueKey,
      issueUrl: createdIssueUrl,
      summary: summaryInput.value.trim(),
      scenario: textarea.value.trim(),
    });
    const copied = await copyTextToClipboard(sharePacket);
    if (!copied) {
      jiraStatus.style.color = "#c62828";
      jiraStatus.textContent = "Could not copy share update";
      return;
    }
    jiraStatus.style.color = "#2e7d32";
    jiraStatus.textContent = "Share update copied";
    chrome.runtime.sendMessage({
      type: "metrics:track",
      event: "share_packet_copied",
      issueKey: createdIssueKey,
    });
  });

  const jiraButton = document.createElement("button");
  jiraButton.textContent = "Create Jira Ticket";
  jiraButton.style.padding = "8px 14px";
  jiraButton.style.borderRadius = "8px";
  jiraButton.style.border = "1px solid #1f1f1f";
  jiraButton.style.background = "#1f1f1f";
  jiraButton.style.color = "#ffffff";
  jiraButton.style.cursor = "pointer";

  const optionsButton = document.createElement("button");
  optionsButton.textContent = "⚙";
  optionsButton.title = "Jira Settings";
  optionsButton.setAttribute("aria-label", "Jira Settings");
  optionsButton.style.width = "42px";
  optionsButton.style.height = "42px";
  optionsButton.style.padding = "0";
  optionsButton.style.borderRadius = "8px";
  optionsButton.style.border = "1px solid #1f1f1f";
  optionsButton.style.background = "#ffffff";
  optionsButton.style.color = "#1f1f1f";
  optionsButton.style.fontSize = "20px";
  optionsButton.style.lineHeight = "1";
  optionsButton.style.cursor = "pointer";
  optionsButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "open-options" });
  });

  jiraRow.appendChild(projectSelect);
  jiraRow.appendChild(issueTypeSelect);
  jiraRow.appendChild(summaryInput);
  const jiraStatusWrap = document.createElement("div");
  jiraStatusWrap.style.display = "flex";
  jiraStatusWrap.style.alignItems = "center";
  jiraStatusWrap.style.justifyContent = "flex-end";
  jiraStatusWrap.style.gap = "6px";
  jiraStatusWrap.appendChild(jiraStatus);
  jiraStatusWrap.appendChild(shareActionButton);
  jiraStatusWrap.appendChild(jiraLink);

  jiraHeader.appendChild(jiraTitle);
  jiraHeader.appendChild(jiraStatusWrap);

  jiraPanel.appendChild(jiraHeader);
  jiraPanel.appendChild(jiraRow);

  const keywordBar = document.createElement("div");
  keywordBar.style.display = "flex";
  keywordBar.style.flexWrap = "wrap";
  keywordBar.style.gap = "8px";
  keywordBar.style.marginBottom = "10px";

  gherkinKeywords.forEach((keyword) => {
    keywordBar.appendChild(makeKeywordButton(keyword));
  });

  const footer = document.createElement("div");
  footer.style.display = "flex";
  footer.style.justifyContent = "space-between";
  footer.style.gap = "12px";
  footer.style.alignItems = "center";
  footer.style.padding = "10px 16px 14px";
  footer.style.background = "#ffffff";

  const footerActions = document.createElement("div");
  footerActions.style.display = "flex";
  footerActions.style.gap = "12px";
  footerActions.style.alignItems = "center";
  footerActions.style.justifyContent = "flex-end";
  footerActions.style.flexWrap = "wrap";

  const setButtonProgressState = (
    button: HTMLButtonElement,
    isInProgress: boolean,
    defaultLabel: string,
    progressLabel: string,
    withSpinner = false
  ): void => {
    button.disabled = isInProgress;
    button.style.opacity = isInProgress ? "0.68" : "1";
    button.style.cursor = isInProgress ? "not-allowed" : "pointer";
    if (isInProgress) {
      button.textContent = withSpinner ? `⏳ ${progressLabel}` : progressLabel;
      return;
    }
    button.textContent = defaultLabel;
  };

  const applyInitialUi = () => {
    if (meta.initialUi?.issueType) issueTypeSelect.value = meta.initialUi.issueType;
    if (meta.initialUi?.projectKey) projectSelect.value = meta.initialUi.projectKey;
    if (meta.initialUi?.summary) summaryInput.value = meta.initialUi.summary;
    if (meta.initialUi?.cucumber) textarea.value = meta.initialUi.cucumber;
  };

  if (meta.initialUi) {
    applyInitialUi();
  }

  const aiButton = document.createElement("button");
  aiButton.textContent = "✦ Generate with AI";
  aiButton.style.padding = "10px 18px";
  aiButton.style.borderRadius = "12px";
  aiButton.style.border = "1px solid #b8b8b8";
  aiButton.style.background = "#ffffff";
  aiButton.style.color = "#1f1f1f";
  aiButton.style.cursor = "pointer";
  const aiButtonLabel = "✦ Generate with AI";
  aiButton.addEventListener("click", async () => {
    setButtonProgressState(aiButton, true, aiButtonLabel, "Generating...");
    try {
      const scenario = await generateScenario(meta, issueTypeSelect.value);
      if (scenario) {
        textarea.value = appendPageLine(scenario, meta.url);
        summaryInput.value = buildJiraSummaryFromScenario(scenario, meta.elementKey);
        headerTitle.textContent = "AI scenario ready";
      } else {
        headerTitle.textContent = "AI generation failed";
      }
    } finally {
      setButtonProgressState(aiButton, false, aiButtonLabel, "Generating...");
    }
  });

  const recordButton = document.createElement("button");
  recordButton.textContent = "⦿ Record Tab";
  recordButton.style.padding = "10px 18px";
  recordButton.style.borderRadius = "12px";
  recordButton.style.border = "1px solid #b8b8b8";
  recordButton.style.background = "#ffffff";
  recordButton.style.color = "#1f1f1f";
  recordButton.style.cursor = "pointer";
  const recordButtonLabel = "⦿ Record Tab";
  recordButton.addEventListener("click", async () => {
    setButtonProgressState(recordButton, true, recordButtonLabel, "Recording...");
    const started = await startTabRecording();
    setButtonProgressState(recordButton, false, recordButtonLabel, "Recording...");
    if (!started.ok) {
      headerTitle.textContent = started.error
        ? `Recording failed: ${started.error}`
        : "Recording failed";
      return;
    }
    await setRecordingState(true, {
      text,
      meta: {
        ...meta,
        initialUi: {
          projectKey: projectSelect.value,
          issueType: issueTypeSelect.value,
          summary: summaryInput.value,
          cucumber: textarea.value,
        },
      },
    });
    overlay.remove();
    showRecordingControls();
  });

  const addPlaywrightTestButton = document.createElement("button");
  addPlaywrightTestButton.textContent = "Add Playwright Test";
  addPlaywrightTestButton.style.padding = "10px 18px";
  addPlaywrightTestButton.style.borderRadius = "12px";
  addPlaywrightTestButton.style.border = "1px solid #1f1f1f";
  addPlaywrightTestButton.style.background = "#1f1f1f";
  addPlaywrightTestButton.style.color = "#ffffff";
  addPlaywrightTestButton.style.cursor = "pointer";
  addPlaywrightTestButton.addEventListener("click", async () => {
    const ff2Url = await buildFlawFerret2NewJobUrl(meta, textarea.value);
    const opened = window.open(ff2Url, "_blank", "noopener,noreferrer");

    if (!opened) {
      jiraStatus.style.color = "#c62828";
      jiraStatus.textContent = "Allow popups to open FlawFerret2";
      return;
    }

    jiraStatus.style.color = "#2e7d32";
    jiraStatus.textContent = "Opened FlawFerret2";
  });

  body.appendChild(jiraPanel);
  body.appendChild(keywordBar);
  body.appendChild(textarea);

  if (meta.snapshotUrl) {
    const previewWrap = document.createElement("div");
    previewWrap.style.marginTop = "10px";
    previewWrap.style.border = "1px dashed #e0d8cc";
    previewWrap.style.borderRadius = "8px";
    previewWrap.style.padding = "8px";
    previewWrap.style.background = "#faf7f2";

    const previewLabel = document.createElement("div");
    previewLabel.textContent = "Snapshot preview";
    previewLabel.style.fontSize = "12px";
    previewLabel.style.color = "#4b4b4b";
    previewLabel.style.marginBottom = "6px";

    const img = document.createElement("img");
    img.src = meta.snapshotUrl;
    img.alt = "Selection snapshot preview";
    img.style.maxWidth = "100%";
    img.style.borderRadius = "6px";
    img.style.border = "1px solid #e0d8cc";

    previewWrap.appendChild(previewLabel);
    previewWrap.appendChild(img);
    body.appendChild(previewWrap);
  }

  if (meta.recordingDataUrl || meta.recordingId) {
    const videoWrap = document.createElement("div");
    videoWrap.style.marginTop = "10px";
    videoWrap.style.border = "1px dashed #e0d8cc";
    videoWrap.style.borderRadius = "8px";
    videoWrap.style.padding = "8px";
    videoWrap.style.background = "#faf7f2";

    const videoLabel = document.createElement("div");
    videoLabel.textContent = meta.recordingDataUrl
      ? "Recording preview"
      : "Recording captured (will attach to Jira)";
    videoLabel.style.fontSize = "12px";
    videoLabel.style.color = "#4b4b4b";
    videoLabel.style.marginBottom = "6px";

    videoWrap.appendChild(videoLabel);
    if (meta.recordingDataUrl) {
      const video = document.createElement("video");
      video.src = meta.recordingDataUrl;
      video.controls = true;
      video.style.maxWidth = "100%";
      video.style.borderRadius = "6px";
      video.style.border = "1px solid #e0d8cc";
      videoWrap.appendChild(video);
    }
    body.appendChild(videoWrap);
  }

  optionsButton.style.borderColor = "#b8b8b8";
  optionsButton.style.borderRadius = "12px";
  optionsButton.style.width = "52px";
  optionsButton.style.height = "44px";

  jiraButton.style.padding = "10px 20px";
  jiraButton.style.borderRadius = "12px";
  jiraButton.style.minWidth = "220px";
  jiraButton.style.textAlign = "center";
  jiraButton.style.fontSize = "14px";
  const jiraButtonLabel = "Create Jira Ticket  ›";
  jiraButton.textContent = jiraButtonLabel;

  footer.appendChild(optionsButton);
  footerActions.appendChild(aiButton);
  footerActions.appendChild(recordButton);
  footerActions.appendChild(addPlaywrightTestButton);
  footerActions.appendChild(jiraButton);
  footer.appendChild(footerActions);
  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  makeDraggable(header, card, overlay);

  void loadJiraProjects(projectSelect, jiraStatus).then(() => {
    if (meta.initialUi?.projectKey) {
      projectSelect.value = meta.initialUi.projectKey;
      void loadIssueTypes(issueTypeSelect, jiraStatus, meta.initialUi.projectKey).then(
        () => applyInitialUi()
      );
      return;
    }
    if (projectSelect.value) {
      void loadIssueTypes(issueTypeSelect, jiraStatus, projectSelect.value).then(
        () => applyInitialUi()
      );
    }
    applyInitialUi();
  });

  projectSelect.addEventListener("change", () => {
    if (!projectSelect.value) return;
    void loadIssueTypes(issueTypeSelect, jiraStatus, projectSelect.value);
  });

  jiraButton.addEventListener("click", () => {
    const projectKey = projectSelect.value;
    const summary = summaryInput.value.trim();
    const description = textarea.value.trim();
    const mappingBlock = buildMappingBlock({
      url: meta.url,
      title: meta.title,
      role: meta.role,
      name: meta.name,
      outerHTML: meta.outerHTML,
      elementKey: meta.elementKey,
      selectors: meta.selectors,
    });

    if (!projectKey) {
      jiraStatus.style.color = "#c62828";
      jiraStatus.textContent = "Choose Jira project";
      return;
    }

    jiraStatus.style.color = "#4b4b4b";
    jiraStatus.textContent = "Creating ticket...";
    jiraLink.style.display = "none";
    shareActionButton.style.display = "none";
    createdIssueKey = null;
    createdIssueUrl = null;
    setButtonProgressState(
      jiraButton,
      true,
      jiraButtonLabel,
      "Creating Jira Ticket...",
      true
    );
    chrome.runtime.sendMessage(
      {
        type: "jira:create-issue",
        projectKey,
        summary,
        description,
        mapping: mappingBlock,
        issueType: issueTypeSelect.value,
        snapshotDataUrl: meta.snapshotUrl,
        recordingDataUrl: meta.recordingDataUrl,
        recordingId: meta.recordingId,
        captureRect: meta.captureRect,
        viewport: meta.viewport,
        devicePixelRatio: meta.devicePixelRatio,
      },
      async (response) => {
        setButtonProgressState(
          jiraButton,
          false,
          jiraButtonLabel,
          "Creating Jira Ticket...",
          true
        );
        if (chrome.runtime.lastError) {
          jiraStatus.style.color = "#c62828";
          jiraStatus.textContent = chrome.runtime.lastError.message;
          return;
        }
        if (!response?.ok) {
          jiraStatus.style.color = "#c62828";
          jiraStatus.textContent = response?.error || "Failed to create issue";
          return;
        }
        jiraStatus.style.color = "#2e7d32";
        jiraStatus.textContent = `Created ${response.key}`;
        createdIssueKey = response.key;
        const baseUrl = await getJiraBaseUrl();
        if (baseUrl) {
          createdIssueUrl = `${baseUrl}/browse/${response.key}`;
          jiraLink.href = createdIssueUrl;
          jiraLink.textContent = "Open";
          jiraLink.style.display = "inline";
        } else {
          createdIssueUrl = null;
        }
        shareActionButton.style.display = "inline-flex";
      }
    );
  });
}

async function buildFlawFerret2NewJobUrl(meta: OverlayMeta, notes: string): Promise<string> {
  const baseUrl = await getFlawFerret2BaseUrl();
  const url = new URL("/jobs/new", baseUrl);
  url.searchParams.set("captureContext", JSON.stringify(buildFlawFerret2CaptureContext(meta, notes)));

  return url.toString();
}

async function getFlawFerret2BaseUrl(): Promise<string> {
  const stored = (await chrome.storage.local.get("flawFerret2Config")) as {
    flawFerret2Config?: {
      baseUrl?: string;
    };
  };
  const configuredUrl = stored.flawFerret2Config?.baseUrl?.trim();

  if (!configuredUrl) {
    return DEFAULT_FLAWFERRET2_BASE_URL;
  }

  try {
    return new URL(configuredUrl).origin;
  } catch {
    return DEFAULT_FLAWFERRET2_BASE_URL;
  }
}

function buildFlawFerret2CaptureContext(
  meta: OverlayMeta,
  notes: string
): Record<string, unknown> {
  const captureContext: Record<string, unknown> = {
    url: meta.url,
    title: meta.title,
    selectedElement: meta.elementKey,
    elementKey: meta.elementKey,
    domSnippet: meta.outerHTML,
    outerHTML: meta.outerHTML,
    selectors: meta.selectors.map((selector) => selector.selector),
    locatorCandidates: meta.selectors.map((selector) => ({
      strategy: selector.kind,
      value: selector.selector,
    })),
    thenLine: meta.thenLine,
    captureRect: meta.captureRect ?? undefined,
    viewport: meta.viewport,
    devicePixelRatio: meta.devicePixelRatio,
  };

  if (meta.role) {
    captureContext.role = meta.role;
    captureContext.accessibleRole = meta.role;
  }

  if (meta.name) {
    captureContext.name = meta.name;
    captureContext.accessibleName = meta.name;
  }

  if (meta.selectedText) {
    captureContext.selectedText = meta.selectedText;
  }

  if (meta.imageName) {
    captureContext.imageName = meta.imageName;
  }

  const trimmedNotes = notes.trim();
  if (trimmedNotes) {
    captureContext.notes = trimmedNotes;
  }

  return Object.fromEntries(
    Object.entries(captureContext).filter(([, value]) => value !== undefined)
  );
}

function insertAtCursor(textarea: HTMLTextAreaElement, insertText: string): void {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = `${before}${insertText}${after}`;
  const cursor = start + insertText.length;
  textarea.selectionStart = cursor;
  textarea.selectionEnd = cursor;
}

function buildSharePacket(input: {
  issueKey: string;
  issueUrl: string | null;
  summary: string;
  scenario: string;
}): string {
  const lines = input.scenario
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const reproLines = lines.slice(0, 5);

  return [
    `Filed with FlawFerret: ${input.issueKey}`,
    input.issueUrl ? `Jira: ${input.issueUrl}` : `Jira key: ${input.issueKey}`,
    input.summary ? `Summary: ${input.summary}` : "",
    "",
    "Repro context:",
    ...reproLines,
    "",
    "Try FlawFerret: right-click any UI element and choose FlawFerret.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to execCommand path.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

async function startTabRecording(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "record:request-start" }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve({ ok: Boolean(response?.ok), error: response?.error });
    });
  });
}

function showRecordingControls(): void {
  const existing = document.getElementById("gherkin-recording-control");
  if (existing) existing.remove();

  const control = document.createElement("div");
  control.id = "gherkin-recording-control";
  control.style.position = "fixed";
  control.style.bottom = "16px";
  control.style.right = "16px";
  control.style.zIndex = "2147483647";
  control.style.background = "#1f1f1f";
  control.style.color = "#ffffff";
  control.style.padding = "10px 12px";
  control.style.borderRadius = "10px";
  control.style.boxShadow = "0 8px 20px rgba(0,0,0,0.35)";
  control.style.display = "flex";
  control.style.alignItems = "center";
  control.style.gap = "10px";
  control.style.fontFamily = "system-ui, -apple-system, sans-serif";

  const dot = document.createElement("div");
  dot.style.width = "10px";
  dot.style.height = "10px";
  dot.style.borderRadius = "999px";
  dot.style.background = "#ff5f56";

  const label = document.createElement("div");
  label.textContent = "Recording tab…";

  const stopButton = document.createElement("button");
  stopButton.textContent = "Stop";
  stopButton.style.padding = "6px 10px";
  stopButton.style.borderRadius = "8px";
  stopButton.style.border = "1px solid #ffffff";
  stopButton.style.background = "transparent";
  stopButton.style.color = "#ffffff";
  stopButton.style.cursor = "pointer";

  stopButton.addEventListener("click", () => {
    stopButton.disabled = true;
    stopButton.textContent = "Stopping...";
    chrome.runtime.sendMessage({ type: "record:request-stop" }, (response) => {
      control.remove();
      if (chrome.runtime.lastError) {
        void setRecordingState(false, null);
        void restoreOverlayFromRecording(null, null);
        return;
      }
      const dataUrl = response?.dataUrl || null;
      const recordingId = response?.recordingId || null;
      void setRecordingState(false, null);
      void restoreOverlayFromRecording(dataUrl, recordingId);
    });
  });

  control.appendChild(dot);
  control.appendChild(label);
  control.appendChild(stopButton);
  document.body.appendChild(control);
}

async function setRecordingState(
  active: boolean,
  context: { text: string; meta: OverlayMeta } | null
): Promise<void> {
  await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "record:state-set",
        recordingActive: active,
        recordingContext: context ?? null,
      },
      () => resolve(null)
    );
  });
}

async function restoreOverlayFromRecording(
  recordingDataUrl: string | null,
  recordingId: string | null
): Promise<void> {
  const stored = await new Promise<{
    recordingContext?: { text: string; meta: OverlayMeta } | null;
  }>((resolve) => {
    chrome.runtime.sendMessage({ type: "record:state-get" }, (response) => {
      resolve(response || {});
    });
  });
  const context = stored.recordingContext;
  if (!context) return;
  showOverlay(context.text, {
    ...context.meta,
    recordingDataUrl,
    recordingId,
  });
  await setRecordingState(false, null);
}

async function initRecordingControl(): Promise<void> {
  const stored = await new Promise<{ recordingActive?: boolean }>((resolve) => {
    chrome.runtime.sendMessage({ type: "record:state-get" }, (response) => {
      resolve(response || {});
    });
  });
  if (stored.recordingActive) {
    showRecordingControls();
  }
}

async function loadJiraProjects(
  select: HTMLSelectElement,
  status: HTMLElement
): Promise<void> {
  select.innerHTML = "";
  const loading = document.createElement("option");
  loading.textContent = "Loading projects...";
  loading.value = "";
  select.appendChild(loading);

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "jira:list-projects" }, (response) => {
      if (chrome.runtime.lastError) {
        status.textContent = chrome.runtime.lastError.message;
        select.innerHTML = "";
        const option = document.createElement("option");
        option.textContent = "Configure Jira in settings";
        option.value = "";
        select.appendChild(option);
        resolve();
        return;
      }
      if (!response?.ok) {
        status.textContent = response?.error || "Configure Jira in settings";
        select.innerHTML = "";
        const option = document.createElement("option");
        option.textContent = "Configure Jira in settings";
        option.value = "";
        select.appendChild(option);
        resolve();
        return;
      }

      select.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select project";
      select.appendChild(placeholder);

      const projects = response.projects as { key: string; name: string }[];
      projects.forEach((project) => {
        const option = document.createElement("option");
        option.value = project.key;
        option.textContent = `${project.key} — ${project.name}`;
        select.appendChild(option);
      });
      select.value = "";

      status.textContent = "";
      resolve();
    });
  });
}

async function getJiraBaseUrl(): Promise<string | null> {
  const config = (await chrome.storage.local.get("jiraConfig")) as {
    jiraConfig?: { baseUrl?: string };
  };
  const baseUrl = config.jiraConfig?.baseUrl?.trim();
  if (!baseUrl) return null;
  return baseUrl.replace(/\/+$/, "");
}

function makeDraggable(
  handle: HTMLElement,
  target: HTMLElement,
  overlay: HTMLElement
): void {
  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  const onMouseMove = (event: MouseEvent) => {
    if (!isDragging) return;
    const maxLeft = window.innerWidth - target.offsetWidth;
    const maxTop = window.innerHeight - target.offsetHeight;
    const nextLeft = clamp(event.clientX - offsetX, 0, Math.max(0, maxLeft));
    const nextTop = clamp(event.clientY - offsetY, 0, Math.max(0, maxTop));
    target.style.left = `${nextLeft}px`;
    target.style.top = `${nextTop}px`;
  };

  const onMouseUp = () => {
    if (!isDragging) return;
    isDragging = false;
    overlay.style.pointerEvents = "auto";
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };

  handle.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    target.style.position = "fixed";
    target.style.left = `${rect.left}px`;
    target.style.top = `${rect.top}px`;
    target.style.margin = "0";
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    isDragging = true;
    overlay.style.pointerEvents = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

type AiConfig = {
  serverUrl?: string;
  provider?: "openai" | "ollama";
  model?: string;
  ollamaUrl?: string;
};

async function getAiConfig(): Promise<AiConfig> {
  const stored = (await chrome.storage.local.get("aiConfig")) as {
    aiConfig?: AiConfig;
  };
  return stored.aiConfig || {};
}

async function generateScenario(
  meta: {
    url: string;
    title: string;
    elementKey: string;
    role: string | null;
    name: string | null;
    selectedText: string | null;
    imageName: string | null;
    outerHTML: string;
    thenLine: string;
  },
  issueType: string
): Promise<string | null> {
  const aiConfig = await getAiConfig();
  const serverUrl =
    aiConfig.serverUrl && aiConfig.serverUrl.length > 0
      ? aiConfig.serverUrl
      : "http://localhost:8787";
  try {
    const response = await fetch(`${serverUrl.replace(/\/+$/, "")}/generate-scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: meta.url,
        title: meta.title,
        elementKey: meta.elementKey,
        role: meta.role,
        name: meta.name,
        selectedText: meta.selectedText,
        imageName: meta.imageName,
        outerHTML: meta.outerHTML,
        thenLine: meta.thenLine,
        issueType,
        provider: aiConfig.provider || "ollama",
        model: aiConfig.model || "codellama",
        ollamaUrl: aiConfig.ollamaUrl || "http://localhost:11434",
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.scenario || null;
  } catch {
    return null;
  }
}

function buildJiraSummaryFromScenario(scenario: string, fallbackElementKey: string): string {
  const maxLen = 240;
  const lines = scenario
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const scenarioLine = lines.find((line) => /^scenario(?: outline)?:/i.test(line));
  if (scenarioLine) {
    const title = scenarioLine.replace(/^scenario(?: outline)?:\s*/i, "").trim();
    if (title) return trimToMax(title, maxLen);
  }

  const bugSummaryLine = lines.find((line) => /^bug summary:/i.test(line));
  if (bugSummaryLine) {
    const summary = bugSummaryLine.replace(/^bug summary:\s*/i, "").trim();
    if (summary) return trimToMax(summary, maxLen);
  }

  const firstMeaningful = lines.find((line) => {
    return !/^(feature|background|given|when|then|and|but|steps to reproduce)\b/i.test(line);
  });
  if (firstMeaningful) return trimToMax(firstMeaningful, maxLen);

  return trimToMax(`UI: ${fallbackElementKey} should be visible`, maxLen);
}

function trimToMax(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen - 1).trimEnd()}...`;
}

async function loadIssueTypes(
  select: HTMLSelectElement,
  status: HTMLElement,
  projectKey: string
): Promise<void> {
  select.innerHTML = "";
  const loading = document.createElement("option");
  loading.textContent = "Loading types...";
  loading.value = "";
  select.appendChild(loading);

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "jira:list-issuetypes", projectKey },
      (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          status.textContent =
            response?.error || chrome.runtime.lastError?.message || "";
          select.innerHTML = "";
          const option = document.createElement("option");
          option.value = "";
          option.textContent = "Issue type";
          select.appendChild(option);
          resolve();
          return;
        }

        select.innerHTML = "";
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "Issue type";
        select.appendChild(option);

        const issueTypes = response.issueTypes as { name: string; id: string }[];
        issueTypes.forEach((it) => {
          const item = document.createElement("option");
          item.value = it.name;
          item.textContent = it.name;
          select.appendChild(item);
        });
        resolve();
      }
    );
  });
}
