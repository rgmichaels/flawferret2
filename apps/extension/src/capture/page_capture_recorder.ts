// Bridges the page's MAIN world (where the page's own console/fetch/XHR live) back to the
// extension's ISOLATED-world content script, which cannot see those objects directly.
//
// `installPageCaptureRecorder` below is injected into the page via
// `chrome.scripting.executeScript({ world: "MAIN", func: installPageCaptureRecorder })`. Chrome
// serializes that function (`Function.prototype.toString`) and re-runs it in the page's own JS
// context, so it must be fully self-contained: it cannot close over anything from this module's
// outer scope (imports, the constants below, etc.) or it will throw a ReferenceError at
// injection time. That's why the event names are duplicated as string literals inside the
// function body instead of referencing `CAPTURE_BUFFER_REQUEST_EVENT`/`CAPTURE_BUFFER_RESPONSE_EVENT` -
// keep them in sync if you change either one.

export const CAPTURE_BUFFER_REQUEST_EVENT = "flawferret2:capture-buffer-request";
export const CAPTURE_BUFFER_RESPONSE_EVENT = "flawferret2:capture-buffer-response";

export type PageCaptureBuffer = {
  consoleErrors: string[];
  networkEvents: string[];
};

const EMPTY_PAGE_CAPTURE_BUFFER: PageCaptureBuffer = {
  consoleErrors: [],
  networkEvents: [],
};

const DEFAULT_REQUEST_TIMEOUT_MS = 300;

/**
 * Runs in the page's MAIN world. Patches console.error/console.warn and fetch/XHR to record
 * failures into an in-page buffer, then answers requests for that buffer's contents from the
 * ISOLATED-world content script via CustomEvent/DOM messaging (the only channel the two worlds
 * share). Idempotent: re-running it in the same page (e.g. a second capture in the same tab)
 * is a no-op after the first install.
 */
export function installPageCaptureRecorder(): void {
  const globalWindow = window as unknown as Record<string, unknown>;
  if (globalWindow.__flawferret2CaptureInstalled) return;
  globalWindow.__flawferret2CaptureInstalled = true;

  const MAX_ENTRIES = 200;
  const consoleErrors: string[] = [];
  const networkEvents: string[] = [];

  const pushCapped = (list: string[], entry: string) => {
    list.push(entry);
    if (list.length > MAX_ENTRIES) list.shift();
  };

  const formatConsoleArgs = (args: unknown[]): string => {
    try {
      return args
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" ");
    } catch {
      return args.map((arg) => String(arg)).join(" ");
    }
  };

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    pushCapped(consoleErrors, `console.error: ${formatConsoleArgs(args)}`);
    originalConsoleError(...args);
  };

  const originalConsoleWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    pushCapped(consoleErrors, `console.warn: ${formatConsoleArgs(args)}`);
    originalConsoleWarn(...args);
  };

  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if (originalFetch) {
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const [input, init] = args;
      const method = (init?.method || (input instanceof Request ? input.method : null) || "GET").toUpperCase();
      const url = input instanceof Request ? input.url : String(input);

      try {
        const response = await originalFetch(...args);
        if (!response.ok) {
          pushCapped(networkEvents, `${method} ${url} -> ${response.status} ${response.statusText}`.trim());
        }
        return response;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        pushCapped(networkEvents, `${method} ${url} -> rejected: ${reason}`);
        throw error;
      }
    };
  }

  const OriginalXMLHttpRequest = window.XMLHttpRequest;
  if (OriginalXMLHttpRequest) {
    const originalOpen = OriginalXMLHttpRequest.prototype.open;
    const originalSend = OriginalXMLHttpRequest.prototype.send;

    OriginalXMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest & { __flawferret2Method?: string; __flawferret2Url?: string },
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      this.__flawferret2Method = method;
      this.__flawferret2Url = String(url);
      return (originalOpen as (...openArgs: unknown[]) => void).call(this, method, url, ...rest);
    };

    OriginalXMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest & { __flawferret2Method?: string; __flawferret2Url?: string },
      ...rest: unknown[]
    ) {
      const method = this.__flawferret2Method || "GET";
      const url = this.__flawferret2Url || "";

      this.addEventListener("load", () => {
        if (this.status >= 400) {
          pushCapped(networkEvents, `${method} ${url} -> ${this.status} ${this.statusText}`.trim());
        }
      });
      this.addEventListener("error", () => {
        pushCapped(networkEvents, `${method} ${url} -> rejected: network error`);
      });

      return (originalSend as (...sendArgs: unknown[]) => void).apply(this, rest);
    };
  }

  window.addEventListener("flawferret2:capture-buffer-request", () => {
    window.dispatchEvent(
      new CustomEvent("flawferret2:capture-buffer-response", {
        detail: {
          consoleErrors: consoleErrors.slice(),
          networkEvents: networkEvents.slice(),
        },
      })
    );
  });
}

/**
 * Runs in the ISOLATED-world content script. Asks the MAIN-world recorder (installed via
 * `installPageCaptureRecorder`) for its current buffer contents and resolves with them, or with
 * an empty buffer if the recorder isn't present or doesn't answer in time (e.g. injection
 * failed, or the page never triggered a capture).
 */
export function requestPageCaptureBuffer(
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<PageCaptureBuffer> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (value: PageCaptureBuffer) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(CAPTURE_BUFFER_RESPONSE_EVENT, onResponse as EventListener);
      resolve(value);
    };

    const onResponse = (event: Event) => {
      finish(parsePageCaptureBuffer((event as CustomEvent).detail));
    };

    window.addEventListener(CAPTURE_BUFFER_RESPONSE_EVENT, onResponse as EventListener);
    window.dispatchEvent(new CustomEvent(CAPTURE_BUFFER_REQUEST_EVENT));
    setTimeout(() => finish(EMPTY_PAGE_CAPTURE_BUFFER), timeoutMs);
  });
}

export function parsePageCaptureBuffer(detail: unknown): PageCaptureBuffer {
  if (!detail || typeof detail !== "object") return EMPTY_PAGE_CAPTURE_BUFFER;

  const record = detail as Record<string, unknown>;
  const consoleErrors = Array.isArray(record.consoleErrors)
    ? record.consoleErrors.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const networkEvents = Array.isArray(record.networkEvents)
    ? record.networkEvents.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

  return { consoleErrors, networkEvents };
}
