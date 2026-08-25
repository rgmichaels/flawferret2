"use client";

import type { ChangeEvent } from "react";
import { useState } from "react";
import { useFrameworkDestination } from "./framework-destination-context";

// Matches the narrow-`unknown`-cast pattern already used in framework-github-push-toggle.tsx
// (this tsconfig doesn't include the "dom" lib — see framework-destination-context.tsx).
const getCheckedValue = (event: ChangeEvent<HTMLInputElement>) => ((event.currentTarget as unknown) as { checked: boolean }).checked;

// The "After building" auto-run toggle: chains dependency install and smoke validation onto
// framework creation. Like FrameworkGithubPushToggle it reads the live destinationType from
// FrameworkDestinationProvider rather than the server-rendered searchParams snapshot, because
// install/smoke only ever run against a local checkout — for a github-destination build the
// control is replaced by a "false" hidden input so the submitted form still carries a value.
export function FrameworkAutoRunToggle({ shouldAutoRun }: { shouldAutoRun: boolean }) {
  const { destinationType } = useFrameworkDestination();
  const [autoRun, setAutoRun] = useState(shouldAutoRun);

  if (destinationType !== "local") {
    return <input name="autoRunDependenciesAndSmoke" type="hidden" value="false" />;
  }

  return (
    <label className="framework-overwrite-option">
      <input name="autoRunDependenciesAndSmoke" type="hidden" value="false" />
      <input
        checked={autoRun}
        name="autoRunDependenciesAndSmoke"
        onChange={(event) => setAutoRun(getCheckedValue(event))}
        type="checkbox"
        value="true"
      />
      <span>
        <strong>
          Install dependencies &amp; run smoke test
          <em className="framework-toggle-timing">adds ~30s&ndash;2min</em>
        </strong>
        <small>
          Runs <code>pnpm install</code>, installs Chromium, and executes the generated smoke test right after the framework
          files are created — no extra clicks. Turn this off to install and validate manually from the results checklist
          instead.
        </small>
      </span>
    </label>
  );
}
