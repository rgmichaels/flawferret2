"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type { FrameworkTemplateDestinationType } from "@flawferret2/job-schemas";
import { FrameworkDestinationContext, type FormElementLike } from "./framework-destination-context";

// Renders the framework-builder <form> itself (rather than page.tsx rendering the <form> tag
// directly) so a ref to the live form element can be shared, via FrameworkDestinationContext, with
// descendants that need to read the form's current values without a page reload — the "After
// building" GitHub-push toggle (keyed off the shared destinationType) and the live Files preview
// (which rebuilds a preview request from FormData on relevant field changes).
export function FrameworkBuilderForm({
  action,
  children,
  className,
  initialDestinationType,
}: {
  action: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
  className: string;
  initialDestinationType: FrameworkTemplateDestinationType;
}) {
  const [destinationType, setDestinationTypeState] = useState<FrameworkTemplateDestinationType>(initialDestinationType);
  // Bumped by notifyFieldChanged whenever a tracked field is updated programmatically (not via a
  // native DOM event) — see the FrameworkDestinationContextValue comment for why this is needed
  // alongside the native "input"/"change" listeners in framework-files-preview.tsx.
  const [refreshSignal, setRefreshSignal] = useState(0);
  const formRef = useRef<FormElementLike | null>(null);

  const notifyFieldChanged = useCallback(() => {
    setRefreshSignal((signal) => signal + 1);
  }, []);

  const setDestinationType = useCallback(
    (nextDestinationType: FrameworkTemplateDestinationType) => {
      setDestinationTypeState(nextDestinationType);
      notifyFieldChanged();
    },
    [notifyFieldChanged],
  );

  const value = useMemo(
    () => ({ destinationType, formRef, notifyFieldChanged, refreshSignal, setDestinationType }),
    [destinationType, notifyFieldChanged, refreshSignal, setDestinationType],
  );

  return (
    <form
      action={action}
      className={className}
      ref={(node) => {
        formRef.current = (node as unknown as FormElementLike | null);
      }}
    >
      <FrameworkDestinationContext.Provider value={value}>{children}</FrameworkDestinationContext.Provider>
    </form>
  );
}
