import type { JobStatus, LocalTestRunStatus, RunStatus } from "@flawferret2/job-schemas";
import type { ReactNode } from "react";

/**
 * The six-tone status signal system. See docs/specs/design-status-signal-system.md.
 * `decision` is reserved exclusively for "a human must act now" — never reused for
 * anything else, so the meaning stays consistent everywhere a Beacon appears.
 */
export type SignalTone = "active" | "attention" | "decision" | "inactive" | "success" | "waiting";

export const jobStatusTone: Record<JobStatus, SignalTone> = {
  BLOCKED: "attention",
  CANCELED: "inactive",
  CLAIMED: "active",
  CODEX_APPROVED: "active",
  COMPLETED: "success",
  DRAFT: "inactive",
  FAILED: "attention",
  NEEDS_REVIEW: "decision",
  QUEUED: "waiting",
  READY_FOR_CODEX: "decision",
  RETRY: "attention",
  PR_APPROVED: "active",
  PR_CREATED: "active",
  REVIEW: "decision",
  RUNNING: "active",
  VALIDATING: "active",
};

export const runStatusTone: Record<RunStatus, SignalTone> = {
  CODEX_RUNNING: "active",
  FAILED: "attention",
  PR_CREATED: "success",
  PUSHING: "active",
  READY_FOR_CODEX: "decision",
  STARTED: "active",
  SUCCEEDED: "success",
  VALIDATING: "active",
};

export const localTestRunStatusTone: Record<LocalTestRunStatus, SignalTone> = {
  CANCELED: "inactive",
  FAILED: "attention",
  PASSED: "success",
  QUEUED: "waiting",
  RUNNING: "active",
};

export function Beacon({ children, tone }: { children: ReactNode; tone: SignalTone }) {
  return (
    <span className={`beacon beacon--${tone}`}>
      <span className="beacon-dot" aria-hidden="true" />
      {children}
    </span>
  );
}
