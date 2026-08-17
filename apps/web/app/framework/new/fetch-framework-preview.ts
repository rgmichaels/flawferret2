import type { FrameworkTemplatePreviewResponse, FrameworkTemplateRequest } from "@flawferret2/job-schemas";

// Split out of framework-files-preview.tsx so the response-body-race handling (see comment below)
// is directly unit-testable with a mocked fetch, independent of React state/hooks.
export type FrameworkPreviewFetchResult =
  | { kind: "success"; preview: FrameworkTemplatePreviewResponse }
  | { kind: "error"; message: string }
  | { kind: "stale" }
  | { kind: "aborted" };

// Fetches a framework preview and reports the outcome as a discriminated union rather than
// mutating state directly, so the caller decides what to do with a stale/aborted result.
//
// `isStale()` is checked again after EACH await that can straddle a body-parsing window
// (`response.text()`/`response.json()`), not just once right after `fetch()` resolves. Once the
// response body has fully arrived, `AbortController.abort()` is a no-op per the fetch spec — the
// already-buffered `.json()`/`.text()` parse still resolves normally. Without a staleness check
// immediately before applying the result, a superseded request whose body finished downloading
// before it was aborted can still overwrite state set by a newer, faster request.
export async function fetchFrameworkPreview({
  apiUrl,
  isStale,
  request,
  signal,
}: {
  apiUrl: string;
  isStale: () => boolean;
  request: FrameworkTemplateRequest;
  signal: AbortSignal;
}): Promise<FrameworkPreviewFetchResult> {
  try {
    const response = await fetch(`${apiUrl}/frameworks/preview`, {
      body: JSON.stringify(request),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
      signal,
    });

    if (isStale()) {
      return { kind: "stale" };
    }

    if (!response.ok) {
      const message = (await response.text()) || "Unable to preview framework.";
      if (isStale()) {
        return { kind: "stale" };
      }
      return { kind: "error", message };
    }

    const preview = (await response.json()) as FrameworkTemplatePreviewResponse;
    if (isStale()) {
      return { kind: "stale" };
    }
    return { kind: "success", preview };
  } catch (previewError) {
    if (signal.aborted) {
      return { kind: "aborted" };
    }
    return {
      kind: "error",
      message: previewError instanceof Error ? previewError.message : "Unable to preview framework.",
    };
  }
}
