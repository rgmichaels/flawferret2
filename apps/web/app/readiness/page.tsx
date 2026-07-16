import type { ReadinessResponse } from "@flawferret2/job-schemas";
import { AppShell } from "../app-shell";

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

const getNextAction = (readiness: ReadinessResponse) => {
  if (readiness.counts.repositories === 0) {
    return {
      href: "/repositories",
      label: "Register a repository",
      text: "Add a local checkout before queuing work.",
    };
  }

  if (readiness.queue.paused) {
    return {
      href: "/",
      label: "Resume the queue",
      text: "The runner will not claim work while the queue is paused.",
    };
  }

  if (readiness.nextAction) {
    return readiness.nextAction;
  }

  if (readiness.counts.codexApprovalJobs > 0) {
    return {
      href: "/#jobs",
      label: "Approve Codex",
      text: "A prepared job is waiting before any model spend happens.",
    };
  }

  if (readiness.counts.prApprovalJobs > 0) {
    return {
      href: "/#jobs",
      label: "Approve Draft PR",
      text: "Validated work is waiting before any branch push or PR creation.",
    };
  }

  if (readiness.counts.prCreatedJobs > 0) {
    return {
      href: "/#jobs",
      label: "Review Pull Request",
      text: "A draft PR exists; checks and merge are still pending.",
    };
  }

  if (readiness.counts.blockedJobs > 0) {
    return {
      href: "/#jobs",
      label: "Open a blocked job",
      text: "Use retry controls or inspect the latest failure reason.",
    };
  }

  return {
    href: "/jobs/new",
    label: "Queue a test-writing job",
    text: "The next concrete run starts with an Add Playwright Test job.",
  };
};

const statusClass = (ok: boolean) => (ok ? "readiness-ok" : "readiness-warn");

const runnerHealthLabels: Record<ReadinessResponse["runner"]["health"], string> = {
  busy: "Busy",
  error: "Error",
  idle: "Idle",
  offline: "Offline",
  stale: "Stale heartbeat",
};

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

  const nextAction = getNextAction(readiness);
  const runnerFresh =
    readiness.runner.heartbeatAgeSeconds !== null &&
    readiness.runner.heartbeatAgeSeconds <= 120;
  const runnerNeedsStart =
    readiness.runner.health === "offline" || readiness.runner.health === "stale";

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

        <section className="panel execution-mode-card" aria-label="Execution mode">
          <div>
            <span className={readiness.runner.codexEnabled ? "mode-live" : "mode-dry-run"}>
              Codex
            </span>
            <strong>{readiness.runner.codexEnabled ? "Live execution" : "Dry-run mode"}</strong>
            <p>
              {readiness.runner.codexEnabled
                ? "Codex approvals can invoke the configured model command."
                : "Codex approvals record plans without calling the model."}
            </p>
            <code>FERRET_RUNNER_ENABLE_CODEX={readiness.runner.codexEnabled ? "true" : "false"}</code>
          </div>
          <div>
            <span className={readiness.runner.prCreationEnabled ? "mode-live" : "mode-dry-run"}>
              Draft PR
            </span>
            <strong>
              {readiness.runner.prCreationEnabled ? "PR creation enabled" : "PR creation disabled"}
            </strong>
            <p>
              {readiness.runner.prCreationEnabled
                ? "Draft PR approvals can push branches and create GitHub PRs."
                : "Draft PR approvals will not push branches or create GitHub PRs."}
            </p>
            <code>
              FERRET_RUNNER_ENABLE_PR_CREATION=
              {readiness.runner.prCreationEnabled ? "true" : "false"}
            </code>
          </div>
        </section>

        <section className="panel runner-ops-card" aria-label="Runner operations">
          <div>
            <span className={statusClass(!runnerNeedsStart && readiness.runner.health !== "error")}>
              ferret-runner
            </span>
            <strong>{runnerHealthLabels[readiness.runner.health]}</strong>
            <p>{readiness.runner.healthText}</p>
          </div>
          <div>
            <span>Start command</span>
            <code>{readiness.runner.startCommand}</code>
          </div>
          <div>
            <span>Worker</span>
            <strong>{readiness.runner.id ?? "Not connected"}</strong>
            <p>
              {readiness.runner.lastHeartbeat
                ? `Last heartbeat ${formatHeartbeat(readiness.runner.heartbeatAgeSeconds)}`
                : "No heartbeat has been recorded yet."}
            </p>
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
            <span className={statusClass(readiness.runner.codexEnabled)}>Codex</span>
            <strong>{readiness.runner.codexEnabled ? "Enabled" : "Dry-run"}</strong>
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
            <span className={statusClass(readiness.runner.prCreationEnabled)}>Draft PR</span>
            <strong>{readiness.runner.prCreationEnabled ? "Enabled" : "Disabled"}</strong>
            <p>Still requires manual approval from review.</p>
          </article>
          <article className="panel readiness-card">
            <span className={statusClass(readiness.counts.blockedJobs === 0)}>Recovery</span>
            <strong>{readiness.counts.blockedJobs}</strong>
            <p>Blocked, failed, or retry jobs needing attention.</p>
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
          </dl>
        </section>
      </section>
    </AppShell>
  );
}
