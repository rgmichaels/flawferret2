"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FrameworkTemplatePreviewResponse, FrameworkTemplateRequest } from "@flawferret2/job-schemas";
import { buildClientPreviewRequest } from "./build-client-preview-request";
import { fetchFrameworkPreview } from "./fetch-framework-preview";
import { useFrameworkDestination } from "./framework-destination-context";
import { FrameworkFilePreviewDetails } from "./framework-file-preview-details";
import { createRequestSequencer } from "./preview-request-sequencer";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const previewDebounceMs = 400;

// See framework-destination-context.tsx's FormElementLike comment: the "dom" lib isn't in this
// tsconfig, so `new FormData(form)` isn't typed even though it works at runtime. Cast through a
// constructor signature that matches how FormData is actually used here.
type FormDataConstructorWithForm = new (form: unknown) => FormData;
const readFormData = (form: unknown): FormData => new (FormData as unknown as FormDataConstructorWithForm)(form);

// The "Files" preview + the build-summary/submit row that follows it. Both were previously
// rendered from the request derived once per server render from searchParams/defaults, so editing
// Naming/Include/Where fields without submitting left this section showing a stale preview (wrong
// file count, wrong conflicts, wrong target). This component instead owns a live preview that
// refetches from the API (debounced) whenever a relevant form field changes via a native DOM event,
// and also whenever the shared refreshSignal bumps — which covers programmatic field updates (e.g.
// destinationType, or "Choose Folder" setting targetDirectory from an async fetch response) that
// never dispatch a native "input"/"change" event for the form listener below to catch.
export function FrameworkFilesPreview({
  initialError,
  initialPreview,
  initialRequest,
}: {
  initialError: string | null;
  initialPreview: FrameworkTemplatePreviewResponse | null;
  initialRequest: FrameworkTemplateRequest;
}) {
  const { destinationType, formRef, refreshSignal } = useFrameworkDestination();
  const [preview, setPreview] = useState(initialPreview);
  const [error, setError] = useState(initialError);
  const [request, setRequest] = useState(initialRequest);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRefreshSignalRender = useRef(true);
  // Toggling the destination radio (or any other programmatic field change that goes through
  // notifyFieldChanged) can fire two independent refreshes for the same change — the refreshSignal
  // effect below, plus the debounced form "change"/"input" handler for changes that also happen to
  // dispatch a native event — and they aren't guaranteed to resolve in the order they started.
  // sequencerRef drops a response once a newer request has begun; abortControllerRef additionally
  // cancels the superseded request's in-flight fetch so it doesn't do wasted work.
  const sequencerRef = useRef(createRequestSequencer());
  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshPreview = useCallback(async () => {
    const form = formRef.current;
    if (!form) {
      return;
    }

    const liveRequest = buildClientPreviewRequest(readFormData(form));
    setRequest(liveRequest);
    setIsRefreshing(true);

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const requestToken = sequencerRef.current.begin();

    try {
      const result = await fetchFrameworkPreview({
        apiUrl,
        isStale: () => sequencerRef.current.isStale(requestToken),
        request: liveRequest,
        signal: abortController.signal,
      });

      switch (result.kind) {
        case "stale":
        case "aborted":
          return;
        case "error":
          setError(result.message);
          return;
        case "success":
          setPreview(result.preview);
          setError(null);
          return;
      }
    } finally {
      if (!sequencerRef.current.isStale(requestToken)) {
        setIsRefreshing(false);
      }
    }
  }, [formRef]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) {
      return;
    }

    const scheduleRefresh = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        void refreshPreview();
      }, previewDebounceMs);
    };

    form.addEventListener("input", scheduleRefresh);
    form.addEventListener("change", scheduleRefresh);

    return () => {
      form.removeEventListener("input", scheduleRefresh);
      form.removeEventListener("change", scheduleRefresh);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [formRef, refreshPreview]);

  useEffect(() => {
    if (isFirstRefreshSignalRender.current) {
      isFirstRefreshSignalRender.current = false;
      return;
    }
    void refreshPreview();
  }, [refreshSignal, refreshPreview]);

  const createCount = preview?.files.filter((file) => file.status === "create").length ?? 0;
  const existingCount = preview?.files.filter((file) => file.status === "exists").length ?? 0;

  return (
    <>
      <section className="framework-wizard-section">
        <div className="framework-wizard-section-header">
          <span>5</span>
          <div>
            <h3>Files</h3>
            <p>
              Preview what will be generated, and how to handle files that already exist.
              {isRefreshing ? " Refreshing preview…" : ""}
            </p>
          </div>
        </div>
        {preview ? (
          <>
            {error ? <p className="framework-preview-stale-error">Refresh failed: {error}</p> : null}
            <p className="framework-file-summary">
              {preview.totalFiles} files under <code>{preview.targetDirectory}</code>. {createCount} will be
              created{existingCount > 0 ? `, ${existingCount} already exist` : ""}.
            </p>
            <label className="framework-overwrite-option">
              <input name="overwriteExisting" type="checkbox" />
              <span>
                <strong>Overwrite existing files</strong>
                <small>
                  {destinationType === "github"
                    ? "Leave unchecked to skip files that already exist in the target branch."
                    : "Leave unchecked to create missing files and skip conflicts."}
                </small>
              </span>
            </label>
            <FrameworkFilePreviewDetails existingCount={existingCount} preview={preview} />
          </>
        ) : (
          <p>{error ?? "Preview unavailable."}</p>
        )}
      </section>

      <div className="framework-wizard-actions framework-build-actions">
        <div className="framework-build-summary">
          <span>Target</span>
          <strong>
            {destinationType === "github"
              ? `${request.githubOwner || "authenticated user"}/${request.githubRepository || request.packageName.replace(/^@[^/]+\//, "")}`
              : request.targetDirectory}
          </strong>
          {preview ? <span>{preview.totalFiles} files</span> : null}
        </div>
        <button type="submit">Build framework</button>
      </div>
    </>
  );
}
