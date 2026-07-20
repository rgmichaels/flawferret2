"use client";

import type { ExplainCucumberScenarioResponse, JobResponse } from "@flawferret2/job-schemas";
import { useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function ScenarioExplainer({
  featurePath,
  repositoryDefaultBranch,
  repositoryId,
  scenarioName,
  scenarioLine,
}: {
  featurePath: string;
  repositoryDefaultBranch: string;
  repositoryId: string;
  scenarioName: string;
  scenarioLine: number;
}) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmittingRepair, setIsSubmittingRepair] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [selectedQaNote, setSelectedQaNote] = useState<string | null>(null);
  const [createdJobHref, setCreatedJobHref] = useState<string | null>(null);
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<string | null>(null);
  const [provider, setProvider] = useState<ExplainCucumberScenarioResponse["provider"] | null>(null);
  const qaNotes = getQaNotes(explanation);
  const repairDraft = buildRepairDraft({
    explanation,
    featurePath,
    qaNote: selectedQaNote,
    scenarioLine,
    scenarioName,
  });

  const explain = async () => {
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch(`${apiUrl}/repositories/${repositoryId}/features/explain`, {
        body: JSON.stringify({
          path: featurePath,
          scenarioLine,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Unable to explain this scenario.");
      }

      const body = (await response.json()) as ExplainCucumberScenarioResponse;

      setExplanation(body.explanation);
      setProvider(body.provider);
      setLastAnalyzedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to explain this scenario.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="scenario-explainer">
      <button disabled={isLoading} onClick={explain} type="button">
        {isLoading ? "Analyzing..." : explanation ? "Analyze Again" : "What Does This Do?"}
      </button>
      {provider === "local" && explanation ? <span>Source summary</span> : null}
      {lastAnalyzedAt ? <span>Updated {lastAnalyzedAt}</span> : null}
      {error ? <p role="alert">{error}</p> : null}
      {explanation ? <div className="scenario-explanation">{explanation}</div> : null}
      {qaNotes.length > 0 ? (
        <>
          <div className="qa-note-list" aria-label="QA notes">
            {qaNotes.map((note, index) => {
              const displayNote = splitQaNote(note);

              return (
              <div className="qa-note-item" key={`${index}-${note}`}>
                <div className="qa-note-copy">
                  <strong>Issue</strong>
                  <span>{displayNote.issue}</span>
                  {displayNote.recommendation ? (
                    <>
                      <strong>Recommendation</strong>
                      <span>{displayNote.recommendation}</span>
                    </>
                  ) : null}
                </div>
                <button
                  className="scenario-fix-button"
                  onClick={() => {
                    setCreatedJobHref(null);
                    setRepairError(null);
                    setSelectedQaNote(note);
                  }}
                  type="button"
                >
                  Fix This
                </button>
              </div>
              );
            })}
          </div>
          {selectedQaNote ? (
            <div className="repair-modal" role="dialog" aria-modal="true" aria-label="Repair scenario">
              <div className="repair-modal-panel">
                <div className="repair-modal-header">
                  <div>
                    <p className="eyebrow">Scenario Repair</p>
                    <h3>Fix This Scenario</h3>
                  </div>
                  <button onClick={() => setSelectedQaNote(null)} type="button">
                    Close
                  </button>
                </div>
                <form
                  className="repair-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    setRepairError(null);
                    setCreatedJobHref(null);
                    setIsSubmittingRepair(true);

                    const form = event.currentTarget as unknown as {
                      elements: {
                        namedItem: (name: string) => { checked?: boolean; value?: string } | null;
                      };
                    };
                    const value = (name: string) => {
                      const field = form.elements.namedItem(name);

                      return field?.value ?? "";
                    };
                    const checked = (name: string) => {
                      const field = form.elements.namedItem(name);

                      return field?.checked ?? false;
                    };

                    try {
                      const response = await fetch(`${apiUrl}/jobs`, {
                        body: JSON.stringify({
                          jobType: "ADD_PLAYWRIGHT_TEST",
                          priority: value("priority"),
                          payload: {
                            acceptanceCriteria: value("acceptanceCriteria"),
                            createDraftPr: checked("createDraftPr"),
                            featureArea: value("featureArea"),
                            goal: value("goal"),
                            repositoryId,
                            runAffectedTests: checked("runAffectedTests"),
                            targetBranch: value("targetBranch"),
                          },
                        }),
                        headers: {
                          "Content-Type": "application/json",
                        },
                        method: "POST",
                      });

                      if (!response.ok) {
                        throw new Error("Unable to queue repair job.");
                      }

                      const job = (await response.json()) as JobResponse;
                      setCreatedJobHref(`/jobs/${job.id}`);
                    } catch (caught) {
                      setRepairError(caught instanceof Error ? caught.message : "Unable to queue repair job.");
                    } finally {
                      setIsSubmittingRepair(false);
                    }
                  }}
                >
                  <label>
                    Target Branch
                    <input name="targetBranch" defaultValue={repositoryDefaultBranch} required />
                  </label>
                  <label>
                    Feature Area
                    <input name="featureArea" defaultValue={repairDraft.featureArea} required />
                  </label>
                  <label>
                    Goal
                    <textarea name="goal" defaultValue={repairDraft.goal} required />
                  </label>
                  <label>
                    Acceptance Criteria
                    <textarea name="acceptanceCriteria" defaultValue={repairDraft.acceptanceCriteria} required />
                  </label>
                  <label>
                    Priority
                    <select name="priority" defaultValue="NORMAL">
                      <option value="LOW">Low</option>
                      <option value="NORMAL">Normal</option>
                      <option value="HIGH">High</option>
                      <option value="URGENT">Urgent</option>
                    </select>
                  </label>
                  <div className="toggles">
                    <label>
                      <input name="runAffectedTests" type="checkbox" defaultChecked />
                      Run affected tests only
                    </label>
                    <label>
                      <input name="createDraftPr" type="checkbox" defaultChecked />
                      Create draft PR
                    </label>
                  </div>
                  {repairError ? <p role="alert">{repairError}</p> : null}
                  {createdJobHref ? (
                    <a className="primary-link" href={createdJobHref}>
                      Open Queued Job
                    </a>
                  ) : (
                    <button type="submit" disabled={isSubmittingRepair}>
                      {isSubmittingRepair ? "Queueing..." : "Queue Repair Job"}
                    </button>
                  )}
                </form>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const getQaNotes = (explanation: string | null) => {
  const notes =
    explanation
    ?.split(/\r?\n/)
    .filter((line) => line.includes("QA note:"))
    .map((line) => line.replace(/^-\s*QA note:\s*/, "").trim())
    .filter((note) => note.length > 0) ?? [];

  return notes;
};

const splitQaNote = (note: string) => {
  const recommendationStarts = [
    "Add or repair the missing step definition before trusting this test.",
    "Rename or split this step so the scenario says what interaction is being tested.",
    "It would probably be clearer split into a load/content scenario and a right-click alert scenario.",
  ];
  const recommendationStart = recommendationStarts.find((start) => note.includes(start));

  if (!recommendationStart) {
    return {
      issue: note,
      recommendation: null,
    };
  }

  const issue = note.slice(0, note.indexOf(recommendationStart)).trim();

  return {
    issue,
    recommendation: note.slice(note.indexOf(recommendationStart)).trim(),
  };
};

const buildRepairDraft = ({
  explanation,
  featurePath,
  qaNote,
  scenarioLine,
  scenarioName,
}: {
  explanation: string | null;
  featurePath: string;
  qaNote: string | null;
  scenarioLine: number;
  scenarioName: string;
}) => {
  const behaviorLines =
    explanation
      ?.split(/\r?\n/)
      .filter((line) => /^- (Given|When|Then|And|But) /.test(line))
      .join("\n") ?? "";

  return {
    acceptanceCriteria: [
      `Feature file: ${featurePath}`,
      `Scenario line: ${scenarioLine}`,
      "",
      "Current behavior summary:",
      behaviorLines || "No implementation summary was available.",
      "",
      qaNote ? `Detected issue: ${qaNote}` : "Detected issue: Scenario repair requested from the feature catalog.",
      "",
      "Acceptance criteria:",
      "- Existing behavior remains covered.",
      "- Split broad behavior into focused, readable Cucumber scenarios.",
      "- Remove or replace vague wording such as \"exercise the page\" with concrete user behavior.",
      "- Reuse existing page objects and step definitions where sensible.",
      "- Add or adjust step/page-object methods only where needed.",
      "- Affected tests pass.",
    ].join("\n"),
    featureArea: `Repair ${scenarioName}`,
    goal: [
      `Refactor the Cucumber scenario "${scenarioName}" into clearer focused coverage.`,
      "",
      qaNote
        ? `Reason: ${qaNote}`
        : "Reason: the feature catalog flagged this scenario for manual QA repair.",
    ].join("\n"),
  };
};
