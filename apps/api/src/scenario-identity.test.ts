import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { markDuplicateScenarioIds, parseFeatureFile } from "./cucumber-features.js";
import {
  recordScenarioSnapshots,
  resolveScenarioIdAtLine,
  resolveScenarioIdInFeature,
  scenarioContentHash,
  toScenarioSnapshots,
} from "./scenario-identity.js";

const parse = (relativePath: string, lines: string[]) =>
  parseFeatureFile({
    content: lines.join("\n"),
    modifiedAt: new Date("2026-10-01T00:00:00.000Z"),
    relativePath,
  });

const checkout = () =>
  parse("features/checkout.feature", [
    "Feature: Checkout",
    "",
    "  @ff-8f3a2c",
    "  Scenario: Pay by card",
    "    Given I have items",
    "",
    "  Scenario: Pay by gift card",
    "    Given I have a gift card",
    "",
    "  @ff-111111 @ff-222222",
    "  Scenario: Two IDs",
    "    Given x",
  ]);

const silentLogger = {
  warn: () => undefined,
};

describe("scenario identity snapshots", () => {
  it("snapshots tag and fingerprint scenarios and skips ID conflicts", () => {
    const feature = checkout();
    const { presentScenarioIds, scenarios } = toScenarioSnapshots([feature]);

    assert.deepEqual(
      scenarios.map((scenario) => [scenario.scenarioId, scenario.idSource, scenario.lastSeenLine]),
      [
        ["ff-8f3a2c", "tag", 4],
        [feature.scenarios[1].fingerprint, "fingerprint", 7],
      ],
    );
    assert.equal(scenarios[0].lastSeenPath, "features/checkout.feature");
    assert.equal(scenarios[0].lastSeenName, "Pay by card");
    // The conflicted scenario is not upserted but still counts as present.
    assert.equal(presentScenarioIds.length, 3);
    assert.ok(presentScenarioIds.includes(feature.scenarios[2].fingerprint));
  });

  it("hashes normalized name and step texts", () => {
    const [first] = parse("a.feature", ["Feature: A", "Scenario:  Pay  by card", "  Given I   have items"]).scenarios;
    const [same] = parse("b.feature", ["Feature: B", "Scenario: pay by card", "  Given I have items"]).scenarios;
    const [changed] = parse("a.feature", ["Feature: A", "Scenario: Pay by card", "  Given I have no items"]).scenarios;

    assert.equal(scenarioContentHash(first), scenarioContentHash(same));
    assert.notEqual(scenarioContentHash(first), scenarioContentHash(changed));
  });

  it("is best-effort: a sync failure is logged and does not throw", async () => {
    const warnings: string[] = [];
    const result = await recordScenarioSnapshots({
      features: [checkout()],
      logger: {
        warn: (_details: unknown, message?: string) => {
          warnings.push(message ?? "");
        },
      } as never,
      markMissing: true,
      repositoryId: "repo-1",
      sync: async () => {
        throw new Error("database unavailable");
      },
    });

    assert.equal(result, null);
    assert.equal(warnings.length, 1);
  });

  it("passes snapshots and the missing-marking mode to the sync", async () => {
    const calls: Array<{ markMissing: boolean; repositoryId: string; scenarioCount: number }> = [];

    await recordScenarioSnapshots({
      features: [checkout()],
      logger: silentLogger,
      markMissing: false,
      repositoryId: "repo-1",
      sync: async (input) => {
        calls.push({
          markMissing: input.markMissing,
          repositoryId: input.repositoryId,
          scenarioCount: input.scenarios.length,
        });
        return { markedMissing: 0, upserted: input.scenarios.length };
      },
    });

    assert.deepEqual(calls, [{ markMissing: false, repositoryId: "repo-1", scenarioCount: 2 }]);
  });
});

describe("scenario ID resolution", () => {
  it("resolves tag IDs and fingerprints within a feature", () => {
    const feature = checkout();

    const byTag = resolveScenarioIdInFeature(feature, "ff-8f3a2c");
    const byFingerprint = resolveScenarioIdInFeature(feature, feature.scenarios[1].fingerprint);

    assert.equal(byTag.status, "found");
    assert.equal(byTag.status === "found" ? byTag.match.scenario.line : 0, 4);
    assert.equal(byFingerprint.status, "found");
    assert.equal(resolveScenarioIdInFeature(feature, "ff-000000").status, "not_found");
    // A tagged scenario is not addressable by its fingerprint.
    assert.equal(resolveScenarioIdInFeature(feature, feature.scenarios[0].fingerprint).status, "not_found");
  });

  it("treats repo-wide duplicates and multi-ID conflicts as ambiguous", () => {
    const feature = checkout();
    const other = parse("features/refunds.feature", ["Feature: Refunds", "  @ff-8f3a2c", "  Scenario: Copy", "    Given x"]);
    markDuplicateScenarioIds([feature, other]);

    assert.equal(resolveScenarioIdInFeature(feature, "ff-8f3a2c").status, "ambiguous");
    assert.equal(resolveScenarioIdInFeature(feature, feature.scenarios[2].fingerprint).status, "ambiguous");
  });

  it("resolves backfill targets by path and line", () => {
    const feature = checkout();

    assert.equal(resolveScenarioIdAtLine([feature], "features/checkout.feature", 4), "ff-8f3a2c");
    assert.equal(
      resolveScenarioIdAtLine([feature], "features/checkout.feature", 7),
      feature.scenarios[1].fingerprint,
    );
    assert.equal(resolveScenarioIdAtLine([feature], "features/checkout.feature", 5), null);
    assert.equal(resolveScenarioIdAtLine([feature], "features/checkout.feature", 11), null);
    assert.equal(resolveScenarioIdAtLine([feature], "features/missing.feature", 4), null);
  });
});
