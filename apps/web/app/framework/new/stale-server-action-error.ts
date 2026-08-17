// Next.js throws an UnrecognizedActionError in the browser when the page bundle still holds a
// Server Action id that the current server process no longer knows about — i.e. the dev server
// restarted or the app was redeployed while the framework builder page was open. The action id is
// baked into the bundle, so it can't be repaired in place; the page has to be reloaded. The error
// surfaces to the route's error boundary, which uses this helper to show a "refresh" message
// instead of a generic failure. Matching is deliberately loose (name, message, or docs link) so a
// wording change on Next's side degrades to the generic message rather than breaking.
export function isStaleServerActionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const { name, message } = error as { name?: unknown; message?: unknown };

  if (typeof name === "string" && name === "UnrecognizedActionError") {
    return true;
  }

  if (typeof message !== "string") {
    return false;
  }

  return (
    /server action\b.*\bwas not found/i.test(message) ||
    message.includes("failed-to-find-server-action")
  );
}
