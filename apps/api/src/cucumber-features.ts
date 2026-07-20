import type {
  CucumberAssociatedFile,
  CucumberFeatureCatalogResponse,
  CucumberFeatureDetailResponse,
  CucumberFeatureSummary,
  CucumberScenario,
  CucumberStep,
  RepositoryResponse,
} from "@flawferret2/job-schemas";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const FEATURE_ROOT_CANDIDATES = ["features", "test/features", "tests/features", "e2e/features"];
const ASSOCIATED_FILE_DIRS = [
  "features/step_definitions",
  "features/steps",
  "features/support",
  "src/step_definitions",
  "src/steps",
  "src/support",
  "step_definitions",
  "steps",
  "support",
];
const MAX_FEATURE_BYTES = 400_000;
const SKIPPED_DIRECTORIES = new Set([".git", "dist", "node_modules", "reports"]);
const STEP_KEYWORDS = new Set(["Given", "When", "Then", "And", "But"]);

const normalizeRelativePath = (value: string) => value.split(sep).join("/");

type StepDefinition = {
  expression: string;
  line: number;
  path: string;
  regex: RegExp;
};

const isPathInside = (root: string, candidate: string) => {
  const relativePath = relative(root, candidate);

  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.includes(`..${sep}`));
};

const pathExists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const walkFiles = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, {
    withFileTypes: true,
  });
  const nested = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith(".") && !SKIPPED_DIRECTORIES.has(entry.name))
      .map(async (entry) => {
        const fullPath = join(root, entry.name);

        if (entry.isDirectory()) {
          return walkFiles(fullPath);
        }

        return entry.isFile() ? [fullPath] : [];
      }),
  );

  return nested.flat();
};

export const parseFeatureFile = ({
  content,
  modifiedAt,
  relativePath,
  stepDefinitions = [],
}: {
  content: string;
  modifiedAt: Date;
  relativePath: string;
  stepDefinitions?: StepDefinition[];
}): CucumberFeatureSummary => {
  const lines = content.split(/\r?\n/);
  const scenarios: CucumberScenario[] = [];
  const featureTags = new Set<string>();
  let description: string | null = null;
  let feature = relativePath.split("/").pop()?.replace(/\.feature$/i, "") ?? relativePath;
  let pendingTags: string[] = [];

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) {
      return;
    }

    if (line.startsWith("@")) {
      pendingTags = line.split(/\s+/).filter((tag) => tag.startsWith("@"));
      pendingTags.forEach((tag) => featureTags.add(tag));
      return;
    }

    const featureMatch = line.match(/^Feature:\s*(.+)$/i);
    if (featureMatch) {
      feature = featureMatch[1].trim();
      return;
    }

    const scenarioMatch = line.match(/^(Scenario(?: Outline)?|Example):\s*(.+)$/i);
    if (scenarioMatch) {
      scenarios.push({
        keyword: scenarioMatch[1],
        line: index + 1,
        name: scenarioMatch[2].trim(),
        steps: [],
        tags: pendingTags,
        unmatchedStepCount: 0,
      });
      pendingTags = [];
      return;
    }

    const stepMatch = line.match(/^(Given|When|Then|And|But)\s+(.+)$/i);
    if (stepMatch && scenarios.length > 0) {
      const keyword = stepMatch[1];
      const text = stepMatch[2].trim();
      const matchedDefinition = stepDefinitions.find((definition) => definition.regex.test(text)) ?? null;
      const step: CucumberStep = {
        keyword,
        line: index + 1,
        matchedDefinition: matchedDefinition
          ? {
              expression: matchedDefinition.expression,
              line: matchedDefinition.line,
              path: matchedDefinition.path,
            }
          : null,
        text,
      };
      const scenario = scenarios[scenarios.length - 1];
      scenario.steps.push(step);
      scenario.unmatchedStepCount = scenario.steps.filter((item) => !item.matchedDefinition).length;
      return;
    }

    if (!description && scenarios.length === 0 && !line.match(/^(Background|Rule):/i)) {
      description = line;
    }
  });

  return {
    description,
    feature,
    modifiedAt: modifiedAt.toISOString(),
    path: relativePath,
    scenarioCount: scenarios.length,
    scenarios,
    tags: [...featureTags].sort((left, right) => left.localeCompare(right)),
  };
};

const findFeatureRoot = async (localPath: string) => {
  for (const candidate of FEATURE_ROOT_CANDIDATES) {
    const candidatePath = resolve(localPath, candidate);

    if (isPathInside(localPath, candidatePath) && (await pathExists(candidatePath))) {
      const candidateStat = await stat(candidatePath);

      if (candidateStat.isDirectory()) {
        return candidatePath;
      }
    }
  }

  return localPath;
};

const listFeatureSummaries = async (localPath: string) => {
  const root = await findFeatureRoot(localPath);
  const files = (await walkFiles(root))
    .filter((file) => file.endsWith(".feature"))
    .sort((left, right) => left.localeCompare(right));
  const features = await Promise.all(
    files.map(async (file) => {
      const [content, fileStat] = await Promise.all([readFile(file, "utf8"), stat(file)]);

      return parseFeatureFile({
        content,
        modifiedAt: fileStat.mtime,
        relativePath: normalizeRelativePath(relative(localPath, file)),
      });
    }),
  );

  return {
    features,
    root,
  };
};

const toAssociatedKind = (path: string): CucumberAssociatedFile["kind"] => {
  if (path.endsWith(".feature")) {
    return "feature";
  }

  if (path.includes("step_definitions/") || path.includes("/steps/") || path.startsWith("steps/")) {
    return "step_definitions";
  }

  if (path.includes("/support/") || path.startsWith("support/")) {
    return "support";
  }

  return "other";
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const cucumberExpressionToRegex = (expression: string) => {
  const source = expression
    .split(/({[^}]+})/)
    .map((part) => (part.startsWith("{") && part.endsWith("}") ? ".+" : escapeRegExp(part)))
    .join("");

  return new RegExp(`^${source}$`);
};

const parseStepDefinitions = ({
  content,
  path,
}: {
  content: string;
  path: string;
}): StepDefinition[] => {
  const definitions: StepDefinition[] = [];
  const lines = content.split(/\r?\n/);
  const pattern =
    /\b(?:Given|When|Then|And|But)\s*\(\s*(\/(?:\\.|[^/])+\/[gimsuy]*|["'`]([^"'`]+)["'`])/;

  lines.forEach((line, index) => {
    const match = line.match(pattern);

    if (!match) {
      return;
    }

    const rawExpression = match[1];
    const stringExpression = match[2];

    try {
      if (rawExpression.startsWith("/")) {
        const lastSlashIndex = rawExpression.lastIndexOf("/");
        const patternSource = rawExpression.slice(1, lastSlashIndex);
        const flags = rawExpression.slice(lastSlashIndex + 1).replace(/[gy]/g, "");
        definitions.push({
          expression: rawExpression,
          line: index + 1,
          path,
          regex: new RegExp(patternSource, flags),
        });
        return;
      }

      definitions.push({
        expression: stringExpression,
        line: index + 1,
        path,
        regex: cucumberExpressionToRegex(stringExpression),
      });
    } catch {
      // Skip invalid expressions; the catalog should stay browsable.
    }
  });

  return definitions;
};

const readStepDefinitions = async (
  localPath: string,
  associatedFiles: CucumberAssociatedFile[],
): Promise<StepDefinition[]> => {
  const stepFiles = associatedFiles.filter((file) => file.kind === "step_definitions");
  const parsed = await Promise.all(
    stepFiles.map(async (file) => {
      const fullPath = resolve(localPath, file.path);

      if (!isPathInside(localPath, fullPath)) {
        return [];
      }

      try {
        const content = await readFile(fullPath, "utf8");

        return parseStepDefinitions({
          content,
          path: file.path,
        });
      } catch {
        return [];
      }
    }),
  );

  return parsed.flat();
};

const listAssociatedFiles = async (localPath: string, featurePath: string): Promise<CucumberAssociatedFile[]> => {
  const candidates = [featurePath];
  const discovered = await Promise.all(
    ASSOCIATED_FILE_DIRS.map(async (directory) => {
      const fullDirectory = resolve(localPath, directory);

      if (!isPathInside(localPath, fullDirectory) || !(await pathExists(fullDirectory))) {
        return [];
      }

      const directoryStat = await lstat(fullDirectory);
      if (!directoryStat.isDirectory()) {
        return [];
      }

      return (await walkFiles(fullDirectory))
        .filter((file) => /\.(js|jsx|ts|tsx|mjs|cjs|rb)$/.test(file))
        .map((file) => normalizeRelativePath(relative(localPath, file)));
    }),
  );
  const uniquePaths = [...new Set([...candidates, ...discovered.flat()])].sort((left, right) =>
    left.localeCompare(right),
  );

  return uniquePaths.map((path) => ({
    kind: toAssociatedKind(path),
    path,
  }));
};

export const buildFeatureCatalog = async ({
  repository,
}: {
  repository: RepositoryResponse;
}): Promise<CucumberFeatureCatalogResponse> => {
  if (!repository.localPath) {
    return {
      features: [],
      localPath: null,
      repository,
      root: null,
      totalScenarios: 0,
    };
  }

  const localPath = resolve(repository.localPath);
  const { features, root } = await listFeatureSummaries(localPath);

  return {
    features,
    localPath,
    repository,
    root: normalizeRelativePath(relative(localPath, root)) || ".",
    totalScenarios: features.reduce((total, feature) => total + feature.scenarioCount, 0),
  };
};

export const buildFeatureDetail = async ({
  featurePath,
  repository,
}: {
  featurePath: string;
  repository: RepositoryResponse;
}): Promise<CucumberFeatureDetailResponse | null> => {
  if (!repository.localPath || featurePath.length === 0 || featurePath.startsWith("/")) {
    return null;
  }

  const localPath = resolve(repository.localPath);
  const fullPath = resolve(localPath, featurePath);

  if (!isPathInside(localPath, fullPath) || !fullPath.endsWith(".feature")) {
    return null;
  }

  const fileStat = await stat(fullPath);

  if (!fileStat.isFile() || fileStat.size > MAX_FEATURE_BYTES) {
    return null;
  }

  const content = await readFile(fullPath, "utf8");
  const associatedFiles = await listAssociatedFiles(localPath, normalizeRelativePath(relative(localPath, fullPath)));
  const stepDefinitions = await readStepDefinitions(localPath, associatedFiles);

  return {
    associatedFiles,
    content,
    feature: parseFeatureFile({
      content,
      modifiedAt: fileStat.mtime,
      relativePath: normalizeRelativePath(relative(localPath, fullPath)),
      stepDefinitions,
    }),
    localPath,
    repository,
  };
};
