import type { CucumberDuplicateScenarioId, CucumberScenario } from "@flawferret2/job-schemas";

// Tag IDs are stable; fingerprints change on rename/move, so they are labelled unstable.
export function ScenarioIdBadge({ scenario }: { scenario: CucumberScenario }) {
  if (scenario.idConflict) {
    return (
      <code
        className="scenario-id-badge conflict"
        title={
          scenario.id
            ? "This ID tag is also used by another scenario, or by a Feature, Rule or Examples line in this file; runs by ID are refused until it is unique."
            : "This scenario has more than one ID tag, so none is used."
        }
      >
        {scenario.id ? `Conflicting ID ${scenario.id}` : "Conflicting ID tags"}
      </code>
    );
  }

  if (scenario.idSource === "tag" && scenario.id) {
    return (
      <code className="scenario-id-badge" title="Stable scenario ID from its tag">
        {scenario.id}
      </code>
    );
  }

  return (
    <code
      className="scenario-id-badge unstable"
      title={`No ID tag. Fingerprint ${scenario.fingerprint} changes if the scenario is renamed or moved.`}
    >
      Unstable ID
    </code>
  );
}

export function DuplicateScenarioIdsWarning({ duplicates }: { duplicates: CucumberDuplicateScenarioId[] }) {
  // Older API responses may omit the field.
  if (!duplicates || duplicates.length === 0) {
    return null;
  }

  return (
    <div className="scenario-id-warning" role="alert">
      <strong>
        {duplicates.length === 1 ? "1 scenario ID is" : `${duplicates.length} scenario IDs are`} used more than once.
      </strong>{" "}
      Runs by these IDs are refused until each is unique:{" "}
      {duplicates
        .map(
          (duplicate) =>
            `${duplicate.id} (${duplicate.locations.map((location) => `${location.path}:${location.line}`).join(", ")})`,
        )
        .join("; ")}
    </div>
  );
}
