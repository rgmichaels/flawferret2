import type { CucumberFeatureDetailResponse } from "@flawferret2/job-schemas";
import { AppShell } from "../../../app-shell";
import { ScenarioExplainer } from "./scenario-explainer";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function getFeatureDetail(
  repositoryId: string,
  featurePath: string,
): Promise<CucumberFeatureDetailResponse | null> {
  try {
    const response = await fetch(
      `${apiUrl}/repositories/${repositoryId}/features/detail?path=${encodeURIComponent(featurePath)}`,
      {
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<CucumberFeatureDetailResponse>;
  } catch {
    return null;
  }
}

const formatKind = (value: string) =>
  value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const repositoryLabel = (detail: CucumberFeatureDetailResponse) =>
  `${detail.repository.owner}/${detail.repository.name}`;

export default async function FeatureDetailPage({
  params,
}: {
  params: Promise<{ featurePath: string[]; repositoryId: string }>;
}) {
  const { featurePath, repositoryId } = await params;
  const decodedFeaturePath = featurePath.map(decodeURIComponent).join("/");
  const detail = await getFeatureDetail(repositoryId, decodedFeaturePath);

  if (!detail) {
    return (
      <AppShell active="features">
        <section className="workspace">
          <a className="back-link" href="/features">
            Back to features
          </a>
          <section className="panel detail-empty">
            <h1>Feature not found</h1>
            <p>The requested feature file could not be read from the registered checkout.</p>
          </section>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell active="features">
      <section className="workspace">
        <a className="back-link" href={`/features?repositoryId=${detail.repository.id}`}>
          Back to features
        </a>

        <header className="topbar feature-detail-topbar">
          <div>
            <p className="eyebrow">{repositoryLabel(detail)}</p>
            <h1>{detail.feature.feature}</h1>
            <code>{detail.feature.path}</code>
          </div>
          <a className="primary-link" href="/jobs/new">
            New Job
          </a>
        </header>

        <div className="page-grid feature-detail-grid">
          <div className="feature-detail-main">
            <section className="panel feature-detail-panel">
              <div className="panel-header">
                <div>
                  <h2>Scenarios</h2>
                  <p>Parsed from the Cucumber feature file.</p>
                </div>
                <span>{detail.feature.scenarioCount} total</span>
              </div>
              {detail.feature.scenarios.length === 0 ? (
                <p className="empty">No scenarios found in this feature.</p>
              ) : (
                <ol className="scenario-list">
                  {detail.feature.scenarios.map((scenario) => (
                    <li key={`${scenario.line}-${scenario.name}`}>
                      <div className="scenario-list-header">
                        <div>
                          <strong>{scenario.name}</strong>
                          <span>
                            {scenario.keyword} on line {scenario.line}
                          </span>
                        </div>
                        <div className="scenario-badges">
                          {scenario.unmatchedStepCount > 0 ? (
                            <span className="unmatched-step-badge">
                              {scenario.unmatchedStepCount} unmatched
                            </span>
                          ) : (
                            <span className="matched-step-badge">All steps matched</span>
                          )}
                          {scenario.tags.length > 0 ? (
                            <div className="tag-row compact">
                              {scenario.tags.map((tag) => (
                                <span key={tag}>{tag}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <ScenarioExplainer
                        featurePath={detail.feature.path}
                        repositoryDefaultBranch={detail.repository.defaultBranch}
                        repositoryId={detail.repository.id}
                        scenarioName={scenario.name}
                        scenarioLine={scenario.line}
                      />
                      {scenario.steps.length > 0 ? (
                        <ol className="scenario-step-list">
                          {scenario.steps.map((step) => (
                            <li key={`${step.line}-${step.keyword}-${step.text}`}>
                              <div>
                                <span>{step.keyword}</span>
                                <strong>{step.text}</strong>
                              </div>
                              {step.matchedDefinition ? (
                                <code>
                                  {step.matchedDefinition.path}:{step.matchedDefinition.line}
                                </code>
                              ) : (
                                <em>Unmatched step definition</em>
                              )}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="scenario-empty">No steps parsed for this scenario.</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="panel feature-source-panel">
              <div className="panel-header">
                <div>
                  <h2>Feature Source</h2>
                  <p>{detail.localPath}</p>
                </div>
              </div>
              <pre>{detail.content}</pre>
            </section>
          </div>

          <section className="panel feature-detail-panel">
            <div className="panel-header">
              <div>
                <h2>Associated Files</h2>
                <p>Feature file plus likely step/support files.</p>
              </div>
              <span>{detail.associatedFiles.length} files</span>
            </div>
            <ul className="associated-file-list">
              {detail.associatedFiles.map((file) => (
                <li key={file.path}>
                  <span>{formatKind(file.kind)}</span>
                  <code>{file.path}</code>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
