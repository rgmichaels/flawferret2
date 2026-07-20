import type {
  CucumberFeatureDetailResponse,
  CucumberScenario,
  ExplainCucumberScenarioResponse,
} from "@flawferret2/job-schemas";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const SNIPPET_RADIUS = 10;
const MAX_SNIPPET_CHARS = 8_000;

type StepDefinitionSnippet = {
  definitionSource: string;
  fullSource: string;
  path: string;
  line: number;
  source: string;
};

type RelatedSourceFile = {
  path: string;
  source: string;
};

const isPathInside = (root: string, candidate: string) => {
  const relativePath = relative(root, candidate);

  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.includes(`..${sep}`));
};

const scenarioText = (scenario: CucumberScenario) =>
  scenario.steps.map((step) => `${step.keyword} ${step.text}`).join("\n");

const sentenceCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const extractStepDefinitionSource = (lines: string[], line: number) => {
  const definitionStartPattern = /\b(?:Given|When|Then|And|But)\s*\(/;
  const start = Math.max(
    0,
    lines
      .slice(0, line)
      .map((sourceLine, index) => ({ index, sourceLine }))
      .reverse()
      .find((item) => definitionStartPattern.test(item.sourceLine))?.index ?? line - 1,
  );
  const endOffset = lines
    .slice(start)
    .findIndex((sourceLine, index) => index > 0 && /^\s*}\s*\)\s*;?\s*$|^\s*\)\s*;?\s*$/.test(sourceLine));
  const end = endOffset >= 0 ? start + endOffset + 1 : Math.min(lines.length, line + SNIPPET_RADIUS);

  return lines.slice(start, end).join("\n");
};

const extractQuotedValues = (source: string) =>
  [...source.matchAll(/(?:expectH3ToBe|toHaveText|toContain|toBe)\(\s*(['"`])([\s\S]*?)\1/g)]
    .map((match) => match[2].replace(/\s+/g, " ").trim())
    .filter(Boolean);

const methodBody = (source: string, methodName: string) => {
  const match = new RegExp(`(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*\\{`).exec(source);

  if (!match) {
    return null;
  }

  let depth = 1;
  let index = match.index + match[0].length;

  while (index < source.length && depth > 0) {
    const char = source[index];

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
    }

    index += 1;
  }

  return source.slice(match.index, index);
};

const calledMethods = (source: string) =>
  [
    ...new Set(
      [...source.matchAll(/\.\s*([A-Za-z][A-Za-z0-9_]*)\s*\(/g)]
        .map((match) => match[1])
        .filter(
          (name) =>
            ![
              "accept",
              "click",
              "getByRole",
              "goto",
              "locator",
              "nth",
              "once",
              "reload",
              "route",
              "textContent",
              "toBe",
              "toBeTruthy",
              "toBeVisible",
              "toContain",
              "toHaveCount",
              "toHaveText",
              "waitForNavigation",
            ].includes(name),
        ),
    ),
  ];

const expandWithCalledMethods = (source: string, relatedSources: RelatedSourceFile[]) => {
  const methodSources = calledMethods(source)
    .flatMap((methodName) => relatedSources.map((file) => methodBody(file.source, methodName)))
    .filter((body): body is string => Boolean(body));
  const nestedSources = methodSources
    .flatMap((body) => calledMethods(body))
    .flatMap((methodName) => relatedSources.map((file) => methodBody(file.source, methodName)))
    .filter((body): body is string => Boolean(body));

  return [source, ...methodSources, ...nestedSources].join("\n\n");
};

const summarizeSourceBehavior = (source: string) => {
  const behaviors: string[] = [];
  const quotedValues = extractQuotedValues(source);
  const hasNamedLinkClick = /getByRole\(\s*['"`]link/.test(source) && /\.click\(/.test(source);
  const hasRightClick = /button:\s*['"`]right['"`]/.test(source);

  if (hasNamedLinkClick) {
    behaviors.push("clicks the named example link and waits for navigation");
  }

  if (/\.goto\(/.test(source) && !hasNamedLinkClick) {
    behaviors.push("navigates directly to the page");
  }

  if (hasRightClick) {
    behaviors.push("right-clicks the target element");
  } else if (/\.click\(/.test(source) && !hasNamedLinkClick) {
    behaviors.push("clicks an element on the page");
  }

  if (/\.once\(\s*['"`]dialog['"`]/.test(source)) {
    behaviors.push("waits for a browser dialog and accepts it");
  }

  if (/toBeVisible\(/.test(source)) {
    behaviors.push("asserts that the target element is visible");
  }

  if (/toHaveCount\(/.test(source)) {
    const count = source.match(/toHaveCount\(\s*(\d+)/)?.[1];
    behaviors.push(count ? `asserts that ${count} matching elements are present` : "asserts an element count");
  }

  if (quotedValues.length > 0) {
    behaviors.push(`asserts text/content including "${quotedValues.slice(0, 3).join('", "')}"`);
  }

  if (/head\s*>\s*title|<title>|assertTitleTagHasText/.test(source)) {
    behaviors.push("asserts that the page title tag exists and is not empty");
  }

  return [...new Set(behaviors)];
};

const summarizeStepBehavior = ({
  relatedSources,
  step,
  snippets,
}: {
  relatedSources: RelatedSourceFile[];
  step: CucumberScenario["steps"][number];
  snippets: StepDefinitionSnippet[];
}) => {
  const snippet = step.matchedDefinition
    ? snippets.find((item) => item.path === step.matchedDefinition?.path && item.line === step.matchedDefinition.line)
    : null;
  const behaviors = snippet ? summarizeSourceBehavior(expandWithCalledMethods(snippet.definitionSource, relatedSources)) : [];

  if (behaviors.length === 0) {
    return `${step.keyword} "${step.text}": no implementation details found.`;
  }

  return `${step.keyword} "${step.text}": ${behaviors.map(sentenceCase).join("; ")}.`;
};

const scenarioQaNotes = (scenario: CucumberScenario, stepSummaries: string[]) => {
  const notes: string[] = [];
  const unmatchedSteps = scenario.steps.filter((step) => !step.matchedDefinition);
  const hasLoadStep = scenario.steps.some((step) => /should load|open the .* page/i.test(step.text));
  const hasExerciseStep = scenario.steps.some((step) => /\bexercise\b/i.test(step.text));
  const hasInteraction = stepSummaries.some((summary) => /right-clicks|clicks|dialog/i.test(summary));
  const hasContentAssertions = stepSummaries.some((summary) => /asserts text|matching elements|visible/i.test(summary));

  if (unmatchedSteps.length > 0) {
    const stepList = unmatchedSteps.map((step) => `${step.keyword} ${step.text}`).join("; ");

    notes.push(`This scenario has ${unmatchedSteps.length} unmatched step definition${
      unmatchedSteps.length === 1 ? "" : "s"
    }: ${stepList}. Add or repair the missing step definition before trusting this test.`);
  }

  if (hasLoadStep && hasExerciseStep && hasInteraction && hasContentAssertions) {
    notes.push("This scenario does a lot: it covers navigation, page load/content assertions, and the context-menu interaction. It would probably be clearer split into a load/content scenario and a right-click alert scenario.");
  }

  if (hasExerciseStep) {
    notes.push('The word "exercise" hides the real behavior. Rename or split this step so the scenario says what interaction is being tested.');
  }

  return notes;
};

export const buildLocalScenarioExplanation = ({
  relatedSources = [],
  scenario,
  snippets = [],
}: {
  relatedSources?: RelatedSourceFile[];
  scenario: CucumberScenario;
  snippets?: StepDefinitionSnippet[];
}) => {
  const stepSummaries = scenario.steps.map((step) =>
    summarizeStepBehavior({
      relatedSources,
      snippets,
      step,
    }),
  );
  const qaNotes = scenarioQaNotes(scenario, stepSummaries);

  const lines = [
    `- Checks: ${scenario.name}.`,
    ...stepSummaries.map((summary) => `- ${summary}`),
    ...qaNotes.map((note) => `- QA note: ${note}`),
  ].filter(Boolean);

  return lines.join("\n");
};

const readSnippet = async ({
  line,
  localPath,
  path,
}: {
  line: number;
  localPath: string;
  path: string;
}): Promise<StepDefinitionSnippet | null> => {
  const fullPath = resolve(localPath, path);

  if (!isPathInside(resolve(localPath), fullPath)) {
    return null;
  }

  try {
    const fullSource = await readFile(fullPath, "utf8");
    const lines = fullSource.split(/\r?\n/);
    const start = Math.max(0, line - SNIPPET_RADIUS - 1);
    const end = Math.min(lines.length, line + SNIPPET_RADIUS);
    const source = lines
      .slice(start, end)
      .map((sourceLine, index) => `${start + index + 1}: ${sourceLine}`)
      .join("\n")
      .slice(0, MAX_SNIPPET_CHARS);

    return {
      definitionSource: extractStepDefinitionSource(lines, line),
      fullSource,
      line,
      path,
      source,
    };
  } catch {
    return null;
  }
};

const resolveImportPath = (localPath: string, importerPath: string, importPath: string) => {
  if (!importPath.startsWith(".")) {
    return null;
  }

  const basePath = resolve(localPath, dirname(importerPath), importPath);
  const candidates = [basePath, `${basePath}.ts`, `${basePath}.tsx`, `${basePath}.js`, `${basePath}.jsx`];

  return candidates;
};

const readRelatedSourceFiles = async ({
  detail,
  snippets,
}: {
  detail: CucumberFeatureDetailResponse;
  snippets: StepDefinitionSnippet[];
}) => {
  if (!detail.localPath) {
    return [];
  }

  const localPath = resolve(detail.localPath);
  const importPaths = snippets.flatMap((snippet) =>
    [...snippet.fullSource.matchAll(/import\s+(?:\{[^}]+\}|[A-Za-z0-9_]+)\s+from\s+['"`]([^'"`]+)['"`]/g)].flatMap(
      (match) => resolveImportPath(localPath, snippet.path, match[1]) ?? [],
    ),
  );
  const uniquePaths = [...new Set(importPaths)];
  const files = await Promise.all(
    uniquePaths.map(async (fullPath) => {
      if (!isPathInside(localPath, fullPath)) {
        return null;
      }

      try {
        return {
          path: relative(localPath, fullPath).split(sep).join("/"),
          source: await readFile(fullPath, "utf8"),
        };
      } catch {
        return null;
      }
    }),
  );

  return files.filter((file): file is RelatedSourceFile => Boolean(file));
};

const readStepDefinitionSnippets = async ({
  detail,
  scenario,
}: {
  detail: CucumberFeatureDetailResponse;
  scenario: CucumberScenario;
}) => {
  if (!detail.localPath) {
    return [];
  }

  const uniqueDefinitions = [
    ...new Map(
      scenario.steps
        .map((step) => step.matchedDefinition)
        .filter((definition): definition is NonNullable<typeof definition> => Boolean(definition))
        .map((definition) => [`${definition.path}:${definition.line}`, definition]),
    ).values(),
  ];

  const snippets = await Promise.all(
    uniqueDefinitions.map((definition) =>
      readSnippet({
        line: definition.line,
        localPath: detail.localPath ?? "",
        path: definition.path,
      }),
    ),
  );

  return snippets.filter((snippet): snippet is StepDefinitionSnippet => Boolean(snippet));
};

const buildPrompt = ({
  detail,
  scenario,
  snippets,
  relatedSources,
}: {
  detail: CucumberFeatureDetailResponse;
  relatedSources: RelatedSourceFile[];
  scenario: CucumberScenario;
  snippets: StepDefinitionSnippet[];
}) =>
  [
    "Explain this Cucumber scenario in plain English for a manual QA tester.",
    "Focus on what page behavior is exercised and what confidence the test gives.",
    "Do not explain Cucumber syntax. Do not mention implementation details unless they reveal behavior.",
    "Keep the answer to 3 short bullets.",
    "",
    `Feature: ${detail.feature.feature}`,
    `Scenario: ${scenario.name}`,
    "",
    "Scenario steps:",
    scenarioText(scenario),
    "",
    "Matched step definition snippets:",
    snippets.length > 0
      ? snippets.map((snippet) => `# ${snippet.path}:${snippet.line}\n${snippet.source}`).join("\n\n")
      : "No matched step definition source was available.",
    "",
    "Related page object/support source:",
    relatedSources.length > 0
      ? relatedSources.map((file) => `# ${file.path}\n${file.source.slice(0, MAX_SNIPPET_CHARS)}`).join("\n\n")
      : "No related source files were available.",
  ].join("\n");

const explainWithOpenAi = async ({
  detail,
  scenario,
  snippets,
  relatedSources,
}: {
  detail: CucumberFeatureDetailResponse;
  relatedSources: RelatedSourceFile[];
  scenario: CucumberScenario;
  snippets: StepDefinitionSnippet[];
}) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    body: JSON.stringify({
      input: buildPrompt({
        detail,
        relatedSources,
        scenario,
        snippets,
      }),
      model: process.env.OPENAI_SCENARIO_EXPLAIN_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        text?: string;
        type?: string;
      }>;
    }>;
  };
  const outputText =
    body.output_text ??
    body.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text)
      .filter(Boolean)
      .join("\n")
      .trim();

  return outputText && outputText.length > 0 ? outputText : null;
};

export const explainCucumberScenario = async ({
  detail,
  scenario,
}: {
  detail: CucumberFeatureDetailResponse;
  scenario: CucumberScenario;
}): Promise<ExplainCucumberScenarioResponse> => {
  const snippets = await readStepDefinitionSnippets({
    detail,
    scenario,
  });
  const relatedSources = await readRelatedSourceFiles({
    detail,
    snippets,
  });
  const openAiExplanation = await explainWithOpenAi({
    detail,
    relatedSources,
    scenario,
    snippets,
  }).catch(() => null);

  if (openAiExplanation) {
    return {
      explanation: openAiExplanation,
      provider: "openai",
      scenarioLine: scenario.line,
    };
  }

  return {
    explanation: buildLocalScenarioExplanation({
      relatedSources,
      scenario,
      snippets,
    }),
    provider: "local",
    scenarioLine: scenario.line,
  };
};
