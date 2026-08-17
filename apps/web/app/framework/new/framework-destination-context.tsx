"use client";

import { createContext, useContext, type MutableRefObject } from "react";
import type { FrameworkTemplateDestinationType } from "@flawferret2/job-schemas";

// This project's tsconfig doesn't include the "dom" lib (see tsconfig.base.json), so the full DOM
// API surface (Element.closest, EventTarget.addEventListener, etc) isn't typed even though it's
// available at runtime in the browser. FormElementLike declares only the handful of members this
// module actually needs, matching the narrow-`unknown`-cast pattern already used elsewhere in this
// directory (see framework-folder-picker.tsx's getInputValue) rather than reaching for `any`.
export type FormElementLike = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

// Single source of truth for the build destination ("local" vs "github") and a handle on the live
// <form> element, shared between the "Where" section (FrameworkFolderPicker, which owns the radio
// toggle), the "After building" GitHub-push toggle, and the live Files preview. Without this,
// sections that only read the server-rendered searchParams snapshot go stale the moment the
// destination is switched client-side, which can cause duplicate `<input name="githubOwner">`-style
// collisions when two sections independently decide to render the same fields, and leaves the
// Files preview showing conflicts for a request that's no longer current.
//
// `refreshSignal`/`notifyFieldChanged` cover the general case the native "input"/"change" listeners
// in framework-files-preview.tsx miss: any tracked field set *programmatically* (i.e. via a React
// setState call that never dispatches a native DOM event) rather than by direct user input. The
// "Choose Folder" button is the motivating example — it sets targetDirectory from an async fetch
// response, not from a DOM change event — but any future field with a similar non-native update path
// should call `notifyFieldChanged()` after updating its own state so the Files preview doesn't go
// stale.
export type FrameworkDestinationContextValue = {
  destinationType: FrameworkTemplateDestinationType;
  formRef: MutableRefObject<FormElementLike | null>;
  notifyFieldChanged: () => void;
  refreshSignal: number;
  setDestinationType: (value: FrameworkTemplateDestinationType) => void;
};

export const FrameworkDestinationContext = createContext<FrameworkDestinationContextValue | null>(null);

export function useFrameworkDestination(): FrameworkDestinationContextValue {
  const context = useContext(FrameworkDestinationContext);

  if (!context) {
    throw new Error("useFrameworkDestination must be used within a FrameworkBuilderForm");
  }

  return context;
}
