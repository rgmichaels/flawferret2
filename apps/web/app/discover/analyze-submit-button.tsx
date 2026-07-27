"use client";

import { useFormStatus } from "react-dom";

export function AnalyzeSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={disabled || pending}>
      {pending ? "Analyzing..." : "Analyze Page"}
    </button>
  );
}
