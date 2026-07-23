import type { ReadinessResponse } from "@flawferret2/job-schemas";

export const getReadinessNextAction = (readiness: ReadinessResponse) => {
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

  if (readiness.counts.needsReviewJobs > 0) {
    return {
      href: "/#jobs",
      label: "Review Job",
      text: "A generated request is waiting before it enters the active queue.",
    };
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

  if (readiness.cleanup.latestFailure) {
    return {
      href: readiness.cleanup.latestFailure.href,
      label: "Resolve local cleanup",
      text: "A merged job completed, but its local checkout still needs operator cleanup.",
    };
  }

  return {
    href: "/jobs/new",
    label: "Queue a test-writing job",
    text: "The next concrete run starts with an Add Playwright Test job.",
  };
};
