import type { ReadinessResponse } from "@flawferret2/job-schemas";
import { AppShell } from "../app-shell";
import { getReadinessNextAction } from "./view-model";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function getReadiness(): Promise<ReadinessResponse | null> {
  try {
    const response = await fetch(`${apiUrl}/readiness`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return response.json() as Promise<ReadinessResponse>;
  } catch {
    return null;
  }
}

const formatHeartbeat = (seconds: number | null) => {
  if (seconds === null) {
    return "No runner heartbeat";
  }

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  return `${Math.floor(minutes / 60)}h ago`;
};

const statusClass = (ok: boolean) => (ok ? "readiness-ok" : "readiness-warn");

const runnerHealthLabels: Record<ReadinessResponse["runner"]["health"], string> = {
  busy: "Busy",
  error: "Error",
  idle: "Idle",
  offline: "Offline",
  stale: "Stale heartbeat",
};

const modeClass = (enabled: boolean) => (enabled ? "mode-live" : "mode-dry-run");

const runnerCommandProfiles = [
  {
    command:
      "FERRET_RUNNER_ENABLE_CODEX=false FERRET_RUNNER_ENABLE_PR_CREATION=false pnpm --filter @flawferret2/ferret-runner dev",
    description: "Prepares work branches and approval gates without model spend or pushes.",
    label: "Safe dry-run",
  },
  {
    command:
      "FERRET_RUNNER_ENABLE_CODEX=true FERRET_RUNNER_ENABLE_PR_CREATION=false pnpm --filter @flawferret2/ferret-runner dev",
    description: "Allows approved Codex jobs to spend model credits, but does not push branches.",
    label: "Live Codex only",
  },
  {
    command:
      "FERRET_RUNNER_ENABLE_CODEX=true FERRET_RUNNER_ENABLE_PR_CREATION=true pnpm --filter @flawferret2/ferret-runner dev",
    description: "Allows approved Codex jobs and approved draft PR creation.",
    label: "Live Codex + PR",
  },
];

export default async function ReadinessPage() {
  const readiness = await getReadiness();

  if (!readiness) {
    return (
      <AppShell active="readiness">
        <section className="workspace">
          <header className="topbar">
            <div>
              <p className="eyebrow">Milestone</p>
              <h1>Readiness</h1>
            </div>
          </header>
          <section className="panel detail-empty">
            <h2>API unavailable</h2>
            <p>The readiness check could not reach the API.</p>
          </section>
        </section>
      </AppShell>
    );
  }

  const nextAction = getReadinessNextAction(readiness);
  const runnerFresh =
    readiness.runner.heartbeatAgeSeconds !== null &&
    readiness.runner.heartbeatAgeSeconds <= 120;
  const runnerNeedsStart =
    readiness.runner.health === "offline" || readiness.runner.health === "stale";
  const queueCanClaimWork = !readiness.queue.paused;
  const liveRunnerRisk =
    queueCanClaimWork &&
    (readiness.runner.codexEnabled || readiness.runner.prCreationEnabled);

  return (
    <AppShell active="readiness">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Milestone</p>
            <h1>Readiness</h1>
          </div>
          <a className="primary-link" href={nextAction.href}>
            {nextAction.label}
          </a>
        </header>

        <section className="panel readiness-hero">
          <div>
            <h2>Concrete next action</h2>
            <p>{nextAction.text}</p>
          </div>
          <strong>{nextAction.label}</strong>
        </section>

        <section className="panel operations-safety-card" aria-label="Operations safety">
          <div className="operations-safety-header">
            <div>
              <h2>Operations / Safety</h2>
              <p>Current execution posture before approvals, queue changes, or runner work.</p>
            </div>
            <span className={readiness.queue.paused ? "mode-dry-run" : "mode-live"}>
              Queue {readiness.queue.paused ? "paused" : "active"}
            </span>
          </div>
          <div className="safety-grid">
            <article>
              <span className={statusClass(!runnerNeedsStart && readiness.runner.health !== "error")}>
                Runner
              </span>
              <strong>{runnerHealthLabels[readiness.runner.health]}</strong>
              <p>{readiness.runner.healthText}</p>
              <code>{readiness.runner.startCommand}</code>
            </article>
            <article>
              <span className={readiness.queue.paused ? "mode-dry-run" : "mode-live"}>Queue</span>
              <strong>{readiness.queue.paused ? "Paused" : "Active"}</strong>
              <p>
                {readiness.queue.paused
                  ? "Workers will not claim new work."
                  : "Workers may claim approved or queued work."}
              </p>
            </article>
            <article>
              <span className={modeClass(readiness.runner.codexEnabled)}>Codex</span>
              <strong>{readiness.runner.codexEnabled ? "Live spend enabled" : "Dry-run only"}</strong>
              <p>
                {readiness.runner.codexEnabled
                  ? "Codex approvals can invoke the configured model command."
                  : "Codex approvals record plans without model usage."}
              </p>
              <code>FERRET_RUNNER_ENABLE_CODEX={readiness.runner.codexEnabled ? "true" : "false"}</code>
            </article>
            <article>
              <span className={modeClass(readiness.runner.prCreationEnabled)}>Draft PR</span>
              <strong>{readiness.runner.prCreationEnabled ? "Push enabled" : "Push disabled"}</strong>
              <p>
                {readiness.runner.prCreationEnabled
                  ? "Draft PR approvals can push branches and create GitHub PRs."
                  : "Draft PR approvals will not push branches or create PRs."}
              </p>
              <code>
                FERRET_RUNNER_ENABLE_PR_CREATION=
                {readiness.runner.prCreationEnabled ? "true" : "false"}
              </code>
            </article>
            <article>
              <span className={modeClass(readiness.runner.validationCommandConfigured)}>Validation</span>
              <strong>
                {readiness.runner.validationCommandConfigured ? "Command configured" : "Change check only"}
              </strong>
              <p>
                {readiness.runner.validationCommandConfigured
                  ? "Runner will execute the configured validation command."
                  : "Runner will inspect changed files without running a test command."}
              </p>
            </article>
            <article>
              <span className={modeClass(readiness.runner.slackConfigured)}>Slack</span>
              <strong>{readiness.runner.slackConfigured ? "Notifications enabled" : "Not configured"}</strong>
              <p>
                {readiness.runner.slackConfigured
                  ? "Milestones can post to the configured Slack webhook."
                  : "Slack milestone notifications are skipped."}
              </p>
              <code>SLACK_WEBHOOK_URL={readiness.runner.slackConfigured ? "set" : "unset"}</code>
            </article>
          </div>
          <div className="runner-worker-strip">
            <span>Worker</span>
            <strong>{readiness.runner.id ?? "Not connected"}</strong>
            <p>
              {readiness.runner.lastHeartbeat
                ? `Last heartbeat ${formatHeartbeat(readiness.runner.heartbeatAgeSeconds)}`
                : "No heartbeat has been recorded yet."}
            </p>
          </div>
        </section>

        <section className="panel runner-operations-card" aria-label="Runner operations">
          <div className="operations-safety-header">
            <div>
              <h2>Runner Operations</h2>
              <p>Start the runner in the mode that matches the work you are ready to allow.</p>
            </div>
            <span className={liveRunnerRisk ? "mode-live" : "mode-dry-run"}>
              {liveRunnerRisk ? "Live claims possible" : "Approval gated"}
            </span>
          </div>
          {liveRunnerRisk ? (
            <div className="runner-warning">
              <strong>Queue is active with live runner permissions.</strong>
              <p>Pause the queue if you want to approve jobs one at a time before any spend or push.</p>
            </div>
          ) : null}
          <div className="runner-command-grid">
            {runnerCommandProfiles.map((profile) => (
              <article key={profile.label}>
                <span>{profile.label}</span>
                <p>{profile.description}</p>
                <code>{profile.command}</code>
              </article>
            ))}
          </div>
        </section>

        <section className="readiness-grid" aria-label="Pipeline readiness checks">
          <article className="panel readiness-card">
            <span className={statusClass(readiness.api.databaseConnected)}>API / DB</span>
            <strong>{readiness.api.databaseConnected ? "Ready" : "Unavailable"}</strong>
            <p>Database connectivity for jobs, runs, events, and repositories.</p>
          </article>
          <article className="panel readiness-card">
            <span className={statusClass(readiness.counts.repositories > 0)}>Repository</span>
            <strong>{readiness.counts.repositories}</strong>
            <p>Registered local checkouts available for runner work.</p>
          </article>
          <article className="panel readiness-card">
            <span className={statusClass(!readiness.queue.paused)}>Queue</span>
            <strong>{readiness.queue.paused ? "Paused" : "Active"}</strong>
            <p>Queue pause protects you from accidental claims.</p>
          </article>
          <article className="panel readiness-card">
            <span className={statusClass(runnerFresh)}>Runner</span>
            <strong>{runnerHealthLabels[readiness.runner.health]}</strong>
            <p>{readiness.runner.healthText}</p>
          </article>
          <article className="panel readiness-card">
            <span className={modeClass(readiness.runner.codexEnabled)}>Codex</span>
            <strong>{readiness.runner.codexEnabled ? "Live" : "Dry-run"}</strong>
            <p>Command: {readiness.runner.codexCommand}</p>
          </article>
          <article className="panel readiness-card">
            <span className={statusClass(readiness.runner.validationCommandConfigured)}>
              Validation
            </span>
            <strong>
              {readiness.runner.validationCommandConfigured ? "Command set" : "Change check only"}
            </strong>
            <p>Runs after Codex leaves generated files.</p>
          </article>
          <article className="panel readiness-card">
            <span className={modeClass(readiness.runner.prCreationEnabled)}>Draft PR</span>
            <strong>{readiness.runner.prCreationEnabled ? "Enabled" : "Disabled"}</strong>
            <p>Still requires manual approval from review.</p>
          </article>
          <article className="panel readiness-card">
            <span className={modeClass(readiness.runner.slackConfigured)}>Slack</span>
            <strong>{readiness.runner.slackConfigured ? "Enabled" : "Unset"}</strong>
            <p>Milestone notifications for job and PR progress.</p>
          </article>
          <article className="panel readiness-card">
            <span className={statusClass(readiness.counts.blockedJobs === 0)}>Recovery</span>
            <strong>{readiness.counts.blockedJobs}</strong>
            <p>Blocked, failed, or retry jobs needing attention.</p>
          </article>
          <article className="panel readiness-card">
            <span className={statusClass(readiness.counts.cleanupFailures === 0)}>Local Cleanup</span>
            <strong>{readiness.counts.cleanupFailures}</strong>
            <p>
              {readiness.cleanup.latestFailure
                ? readiness.cleanup.latestFailure.error ?? readiness.cleanup.latestFailure.message
                : "No merged PR checkout cleanup failures."}
            </p>
            {readiness.cleanup.latestFailure ? (
              <a href={readiness.cleanup.latestFailure.href}>Open cleanup item</a>
            ) : null}
          </article>
        </section>

        <section className="panel readiness-summary">
          <h2>Current pipeline</h2>
          <dl>
            <div>
              <dt>Total Jobs</dt>
              <dd>{readiness.counts.jobs}</dd>
            </div>
            <div>
              <dt>Active</dt>
              <dd>{readiness.counts.activeJobs}</dd>
            </div>
            <div>
              <dt>Needs Review</dt>
              <dd>{readiness.counts.needsReviewJobs}</dd>
            </div>
            <div>
              <dt>Awaiting Codex Approval</dt>
              <dd>{readiness.counts.codexApprovalJobs}</dd>
            </div>
            <div>
              <dt>Awaiting Draft PR Approval</dt>
              <dd>{readiness.counts.prApprovalJobs}</dd>
            </div>
            <div>
              <dt>Pull Requests Created</dt>
              <dd>{readiness.counts.prCreatedJobs}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>{readiness.counts.completedJobs}</dd>
            </div>
            <div>
              <dt>Cleanup Needed</dt>
              <dd>{readiness.counts.cleanupFailures}</dd>
            </div>
          </dl>
        </section>
      </section>
    </AppShell>
  );
}
