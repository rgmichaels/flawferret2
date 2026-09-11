/**
 * Fairness helpers for the main worker loop.
 *
 * PR_CREATED jobs are claimed and inspected before queued jobs are claimed, so a
 * job that legitimately sits at PR_CREATED (waiting on a human) would otherwise
 * hold the queue hostage forever. These helpers make every Nth iteration skip the
 * PR-lifecycle claim so queued jobs always get a claim attempt on a bounded delay.
 */

/**
 * Advances the loop-iteration counter, wrapping at `fairnessN` so the counter
 * stays bounded (values cycle through 1..fairnessN) instead of growing forever.
 */
export const nextLoopIteration = (currentIteration: number, fairnessN: number): number => {
  const cycleLength = Number.isFinite(fairnessN) && fairnessN >= 1 ? Math.floor(fairnessN) : 1;
  const previous = Number.isFinite(currentIteration) && currentIteration >= 0 ? Math.floor(currentIteration) : 0;

  return (previous % cycleLength) + 1;
};

/**
 * Returns true when this iteration should skip the PR-lifecycle claim and go
 * straight to claiming a queued job. With `fairnessN` of 1 every iteration
 * prioritizes queued jobs; with 3 (the default) every third one does.
 */
export const shouldPrioritizeQueuedClaim = (iterationCount: number, fairnessN: number): boolean => {
  if (!Number.isFinite(fairnessN) || fairnessN <= 1) {
    return true;
  }

  if (!Number.isFinite(iterationCount)) {
    return false;
  }

  return Math.floor(iterationCount) % Math.floor(fairnessN) === 0;
};
