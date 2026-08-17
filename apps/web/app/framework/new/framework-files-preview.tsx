"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FrameworkTemplatePreviewResponse, FrameworkTemplateRequest } from "@flawferret2/job-schemas";
import { buildClientPreviewRequest } from "./build-client-preview-request";
import { fetchFrameworkPreview } from "./fetch-framework-preview";
import { useFrameworkDestination } from "./framework-destination-context";
import { FrameworkFilePreviewDetails } from "./framework-file-preview-details";
import { formatAfterBuildSteps } from "./framework-request-utils";
import { createRequestSequencer } from "./preview-request-sequencer";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const previewDebounceMs = 400;

// See framework-destination-context.tsx's FormElementLike comment: the "dom" lib isn't in this
// tsconfig, so `new FormData(form)` isn't typed even though it works at runtime. Cast through a
// constructor signature that matches how FormData is actually used here.
type FormDataConstructorWithForm = new (form: unknown) => FormData;
const readFormData = (form: unknown): FormData => new (FormData as unknown as FormDataConstructorWithForm)(form);

// Each "After building" toggle submits a hidden "false" ahead of its checkbox, so the last value
// for a name is the live one — same convention page.tsx's getCheckedFormValue reads on submit.
const isCheckedInFormData = (formData: FormData, name: string) => {
  const lastValue = formData.getAll(name).map(String).at(-1);

  return lastValue === "true" || lastValue === "on";
};

const readAfterBuildSteps = (formData: FormData) =>
  formatAfterBuildSteps({
    createGithubRepository: isCheckedInFormData(formData, "createGithubRepository"),
    initializeGitRepository: isCheckedInFormData(formData, "initializeGitRepository"),
    registerLocalRepository: isCheckedInFormData(formData, "registerLocalRepository"),
  });

// The "Files" preview + the build-summary/submit row that follows it. Both were previously
// rendered from the request derived once per server render from searchParams/defaults, so editing
// Naming/Include/Where fields without submitting left this section showing a stale preview (wrong
// file count, wrong conflicts, wrong target). This component instead owns a live preview that
// refetches from the API (debounced) whenever a relevant form field changes via a native DOM event,
// and also whenever the shared refreshSignal bumps — which covers programmatic field updates (e.g.
// destinationType, or "Choose Folder" setting targetDirectory from an async fetch response) that
// never dispatch a native "input"/"change" event for the form listener below to catch.
export function FrameworkFilesPreview({
  initialAfterBuildSteps,
  initialError,
  initialPreview,
  initialRequest,
}: {
  initialAfterBuildSteps: string;
  initialError: string | null;
  initialPreview: FrameworkTemplatePreviewResponse | null;
  initialRequest: FrameworkTemplateRequest;
}) {
  const { destinationType, formRef, refreshSignal } = useFrameworkDestination();
  const [preview, setPreview] = useState(initialPreview);
  const [error, setError] = useState(initialError);
  const [request, setRequest] = useState(initialRequest);
  // The build bar's "Then" cell, kept in sync with the "After building" toggles by the same form
  // listeners that drive the preview refresh below.
  const [afterBuildSteps, setAfterBuildSteps] = useState(initialAfterBuildSteps);
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

    const formData = readFormData(form);
    const liveRequest = buildClientPreviewRequest(formData);
    setRequest(liveRequest);
    setAfterBuildSteps(readAfterBuildSteps(formData));
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

  const target =
    destinationType === "github"
      ? `${request.githubOwner || "authenticated user"}/${request.githubRepository || request.packageName.replace(/^@[^/]+\//, "")}`
      : request.targetDirectory;

  return (
    <>
      <section className="framework-section">
        <div className="framework-section-label">
          <h5>Files</h5>
          <p>
            {preview
              ? `${createCount} to create, ${existingCount} conflict${existingCount === 1 ? "" : "s"}.`
              : "Preview unavailable."}
            {isRefreshing ? " Refreshing…" : ""}
          </p>
        </div>
        <div className="framework-section-body">
          {preview ? (
            <>
              {error ? <p className="framework-preview-stale-error">Refresh failed: {error}</p> : null}
              <FrameworkFilePreviewDetails existingCount={existingCount} preview={preview} />
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
            </>
          ) : (
            <p>{error ?? "Preview unavailable."}</p>
          )}
        </div>
      </section>

      <div className="framework-build-bar">
        <dl>
          <div>
            <dt>Target</dt>
            <dd className="framework-build-bar-path">{target}</dd>
          </div>
          <div>
            <dt>Files</dt>
            <dd>{preview ? `${createCount} new, ${existingCount} existing` : "Unknown"}</dd>
          </div>
          <div>
            <dt>Then</dt>
            <dd>{afterBuildSteps}</dd>
          </div>
        </dl>
        <button type="submit">Build framework</button>
      </div>
    </>
  );
}
