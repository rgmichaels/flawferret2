// A minimal monotonic sequence gate used to guard against out-of-order async responses. Toggling a
// form field (e.g. the destination radio) can fire more than one preview refetch in quick
// succession — the fetches don't necessarily resolve in the order they were started, so without
// this a slower, older response could overwrite state set by a newer one. Each call to `begin()`
// hands the caller a token for that request; `isStale(token)` reports whether a newer request has
// started since, so the caller can drop an obsolete response instead of applying it. Kept
// dependency-free (no DOM/React) so it's directly unit-testable.
export function createRequestSequencer() {
  let latest = 0;

  return {
    begin(): number {
      latest += 1;
      return latest;
    },
    isStale(token: number): boolean {
      return token !== latest;
    },
  };
}
