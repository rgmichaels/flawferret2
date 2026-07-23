export type DiscoverAcceptanceSummary = {
  guidance: string[];
  impact: string;
  notes: string | null;
  pageUrl: string;
  scenario: string[];
  source: string;
  tags: string[];
  why: string;
};

const sectionHeaderPattern = /^(Suggested scenario|Why this matters|Implementation guidance):$/;

const stripBullet = (line: string) => line.replace(/^-\s*/, "").trim();

export const parseDiscoverAcceptanceCriteria = (criteria: string): DiscoverAcceptanceSummary | null => {
  const lines = criteria
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!lines.some((line) => line === "Source: Page discovery recommendation")) {
    return null;
  }

  const fields = new Map<string, string>();
  const sections = new Map<string, string[]>();
  let activeSection: string | null = null;

  for (const line of lines) {
    if (sectionHeaderPattern.test(line)) {
      activeSection = line.replace(/:$/, "");
      sections.set(activeSection, []);
      continue;
    }

    if (activeSection) {
      sections.get(activeSection)?.push(line);
      continue;
    }

    const separatorIndex = line.indexOf(":");

    if (separatorIndex > 0) {
      fields.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 1).trim());
    }
  }

  const pageUrl = fields.get("Page URL") ?? "";
  const source = fields.get("Source") ?? "";
  const impact = fields.get("Impact") ?? "";
  const tags = (fields.get("Tags") ?? "")
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  const scenario = sections.get("Suggested scenario") ?? [];
  const why = (sections.get("Why this matters") ?? []).join(" ").trim();
  const guidance = (sections.get("Implementation guidance") ?? []).map(stripBullet).filter(Boolean);

  if (!pageUrl || !source || scenario.length === 0 || !why || guidance.length === 0) {
    return null;
  }

  return {
    guidance,
    impact,
    notes: fields.get("Discovery notes") ?? null,
    pageUrl,
    scenario,
    source,
    tags,
    why,
  };
};
