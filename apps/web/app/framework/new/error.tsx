"use client";

import { isStaleServerActionError } from "./stale-server-action-error";

// Route-scoped error boundary for the framework builder. Without it, any runtime error here — most
// commonly a stale Server Action id after the server restarted or redeployed while the page was
// open — crashes to Next's raw error overlay.
export default function FrameworkBuilderError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isStale = isStaleServerActionError(error);

  // The DOM lib isn't enabled in this package's tsconfig, so location is reached through globalThis
  // with a narrow local type — same approach as FormElementLike in framework-destination-context.
  const reloadPage = () => {
    (globalThis as { location?: { reload: () => void } }).location?.reload();
  };

  return (
    <section className="workspace">
      <header className="topbar">
        <div>
          <p className="eyebrow">Create</p>
          <h1>Framework Builder</h1>
        </div>
      </header>

      <div className="notice error">
        <strong>{isStale ? "This page is out of date" : "Something went wrong"}</strong>
        <span>
          {isStale
            ? "The app was updated while this page was open, so the form could not be submitted. Refresh and try again — nothing was created."
            : "Please refresh the page and try again. If it keeps happening, check that the API is running."}
        </span>
        {error.digest ? <span>Reference: {error.digest}</span> : null}
      </div>

      <div className="panel-actions">
        <button onClick={reloadPage} type="button">
          Refresh page
        </button>
        {isStale ? null : (
          <button className="secondary-button" onClick={reset} type="button">
            Try again
          </button>
        )}
      </div>
    </section>
  );
}
