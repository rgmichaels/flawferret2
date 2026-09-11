"use client";

import { useFormStatus } from "react-dom";

export function CreateTestSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={disabled || pending}>
      {pending ? "Creating..." : "Create Test"}
    </button>
  );
}
