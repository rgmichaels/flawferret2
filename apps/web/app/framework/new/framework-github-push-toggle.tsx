"use client";

import type { ChangeEvent } from "react";
import { useState } from "react";
import { useFrameworkDestination } from "./framework-destination-context";

// Matches the narrow-`unknown`-cast pattern already used in framework-folder-picker.tsx's
// getInputValue (this tsconfig doesn't include the "dom" lib — see framework-destination-context.tsx).
const getInputValue = (event: ChangeEvent<HTMLInputElement>) => ((event.currentTarget as unknown) as { value: string }).value;
const getCheckedValue = (event: ChangeEvent<HTMLInputElement>) => ((event.currentTarget as unknown) as { checked: boolean }).checked;

// The "After building" GitHub-push disclosure. This must react to the same live destinationType
// as the "Where" section's FrameworkFolderPicker (via FrameworkDestinationProvider) rather than the
// server-rendered searchParams snapshot: FrameworkFolderPicker already renders its own
// githubOwner/githubRepository/githubBranch inputs whenever the destination is "github", so this
// component must stay hidden in that case or the form ends up with two sets of identically-named
// inputs.
//
// The fields below are controlled (state lives in this component, seeded once from props) rather
// than defaultValue/defaultChecked uncontrolled inputs. When destinationType flips away from
// "local" and back, this component itself never unmounts (it's the same function component
// instance at the same position in the tree for the life of the page) — only the <details> subtree
// it returns changes — so this component-level state, unlike the DOM's own uncontrolled-input
// value, survives the round trip instead of resetting to the original props each time the subtree
// remounts.
export function FrameworkGithubPushToggle({
  githubBranch,
  githubOwner,
  githubRepository,
  packageName,
  shouldCreateGithubRepository,
}: {
  githubBranch: string;
  githubOwner: string;
  githubRepository: string;
  packageName: string;
  shouldCreateGithubRepository: boolean;
}) {
  const { destinationType } = useFrameworkDestination();
  const [createGithubRepository, setCreateGithubRepository] = useState(shouldCreateGithubRepository);
  const [githubOwnerValue, setGithubOwnerValue] = useState(githubOwner);
  const [githubRepositoryValue, setGithubRepositoryValue] = useState(githubRepository);
  const [githubBranchValue, setGithubBranchValue] = useState(githubBranch);

  if (destinationType !== "local") {
    // GitHub destination: FrameworkFolderPicker above already renders editable
    // githubOwner/githubRepository/githubBranch inputs for the PR target, so only the (here,
    // inapplicable) "push to GitHub" toggle needs a fallback value.
    return <input name="createGithubRepository" type="hidden" value="false" />;
  }

  return (
    <details className="framework-command-copy framework-github-push-toggle" open={createGithubRepository}>
      <summary>
        <label className="framework-overwrite-option">
          <input name="createGithubRepository" type="hidden" value="false" />
          <input
            checked={createGithubRepository}
            name="createGithubRepository"
            onChange={(event) => setCreateGithubRepository(getCheckedValue(event))}
            type="checkbox"
            value="true"
          />
          <span>
            <strong>Create GitHub repository</strong>
            <small>Create a private remote, add origin, and push the initial branch.</small>
          </span>
        </label>
      </summary>
      <div className="framework-basics-grid">
        <label>
          Owner
          <input
            name="githubOwner"
            onChange={(event) => setGithubOwnerValue(getInputValue(event))}
            placeholder="rgmichaels"
            value={githubOwnerValue}
          />
        </label>
        <label>
          Repository
          <input
            name="githubRepository"
            onChange={(event) => setGithubRepositoryValue(getInputValue(event))}
            placeholder={packageName.replace(/^@[^/]+\//, "")}
            value={githubRepositoryValue}
          />
        </label>
        <label>
          Initial Branch
          <input
            name="githubBranch"
            onChange={(event) => setGithubBranchValue(getInputValue(event))}
            placeholder="main"
            value={githubBranchValue}
          />
        </label>
      </div>
    </details>
  );
}
