"use client";

import type { ChangeEvent } from "react";
import { useState } from "react";
import type { RepositoryResponse } from "@flawferret2/job-schemas";
import { useFrameworkDestination } from "./framework-destination-context";
import { pickFolder } from "./pick-folder";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const getInputValue = (event: ChangeEvent<HTMLInputElement>) => ((event.currentTarget as unknown) as { value: string }).value;

const getSelectValue = (event: ChangeEvent<HTMLSelectElement>) => ((event.currentTarget as unknown) as { value: string }).value;

const repositoryLabel = (repository: RepositoryResponse) => `${repository.owner}/${repository.name}`;

export function FrameworkFolderPicker({
  defaultGithubBranch,
  defaultGithubOwner,
  defaultGithubRepositoryId,
  defaultGithubRepository,
  defaultValue,
  repositories,
}: {
  defaultGithubBranch: string;
  defaultGithubOwner: string;
  defaultGithubRepositoryId: string;
  defaultGithubRepository: string;
  defaultValue: string;
  repositories: RepositoryResponse[];
}) {
  const { destinationType, notifyFieldChanged, setDestinationType } = useFrameworkDestination();
  const [githubBranch, setGithubBranch] = useState(defaultGithubBranch);
  const [githubOwner, setGithubOwner] = useState(defaultGithubOwner);
  const [githubRepository, setGithubRepository] = useState(defaultGithubRepository);
  const [githubRepositoryId, setGithubRepositoryId] = useState(defaultGithubRepositoryId);
  const [targetDirectory, setTargetDirectory] = useState(defaultValue);
  const [isPicking, setIsPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateTargetDirectory = (event: ChangeEvent<HTMLInputElement>) => {
    setTargetDirectory(getInputValue(event));
  };

  const chooseFolder = async () => {
    setIsPicking(true);
    setError(null);

    const result = await pickFolder({ apiUrl });

    if (result.kind === "error") {
      setError(result.message);
    } else {
      setTargetDirectory(result.path);
      // setTargetDirectory above is a plain React setState, not a native DOM input/change event, so
      // the Files preview's form-level event listeners never see this update on their own —
      // notifyFieldChanged bumps the shared refreshSignal so the preview refetches anyway. See the
      // FrameworkDestinationContextValue comment for the general pattern this covers.
      notifyFieldChanged();
    }

    setIsPicking(false);
  };

  const selectDestination = (event: ChangeEvent<HTMLInputElement>) => {
    const value = getInputValue(event);
    setDestinationType(value === "github" ? "github" : "local");
    if (value === "github" && targetDirectory === "qa/e2e") {
      setTargetDirectory(".");
    }
    setError(null);
  };

  const selectRepository = (event: ChangeEvent<HTMLSelectElement>) => {
    const selectedRepositoryId = getSelectValue(event);
    const repository = repositories.find((candidate) => candidate.id === selectedRepositoryId);

    setGithubRepositoryId(selectedRepositoryId);

    if (!repository) {
      return;
    }

    setGithubOwner(repository.owner);
    setGithubRepository(repository.name);
    setGithubBranch(repository.defaultBranch);
  };

  return (
    <fieldset className="framework-destination">
      <legend>Destination</legend>

      <label className={`framework-destination-option ${destinationType === "local" ? "selected" : ""}`}>
        <input
          checked={destinationType === "local"}
          name="destinationType"
          onChange={selectDestination}
          type="radio"
          value="local"
        />
        <span>
          <strong>Local folder</strong>
          <small>Create files on this machine, then commit or register the repo when ready.</small>
        </span>
      </label>

      {destinationType === "local" ? (
        <div className="framework-folder-picker">
          <label htmlFor="targetDirectory">Target Directory</label>
          <div className="framework-folder-input-row">
            <input
              id="targetDirectory"
              name="targetDirectory"
              onChange={updateTargetDirectory}
              required
              value={targetDirectory}
            />
            <button disabled={isPicking} onClick={chooseFolder} type="button">
              {isPicking ? "Choosing..." : "Choose Folder"}
            </button>
          </div>
          <small>Choose a local folder or type the full path where the framework should be created.</small>
        </div>
      ) : null}

      {error ? <p className="framework-folder-error">{error}</p> : null}

      <label className={`framework-destination-option ${destinationType === "github" ? "selected" : ""}`}>
        <input
          checked={destinationType === "github"}
          name="destinationType"
          onChange={selectDestination}
          type="radio"
          value="github"
        />
        <span>
          <strong>GitHub repository</strong>
          <small>Preview the target repository and branch now. Writing to GitHub comes in the next slice.</small>
        </span>
      </label>

      {destinationType === "github" ? (
        <div className="framework-github-destination">
          <label className="framework-github-repository-picker">
            Choose Registered Repository
            <select name="githubRepositoryId" onChange={selectRepository} value={githubRepositoryId}>
              <option value="">Manual repository</option>
              {repositories.map((repository) => (
                <option key={repository.id} value={repository.id}>
                  {repositoryLabel(repository)} on {repository.defaultBranch}
                </option>
              ))}
            </select>
            <small>Registered repos prefill the GitHub target. New GitHub repo creation comes later.</small>
          </label>
          <label>
            Owner
            <input
              name="githubOwner"
              onChange={(event) => setGithubOwner(getInputValue(event))}
              placeholder="rgmichaels"
              required
              value={githubOwner}
            />
          </label>
          <label>
            Repository
            <input
              name="githubRepository"
              onChange={(event) => setGithubRepository(getInputValue(event))}
              placeholder="playwright-cucumber-tests"
              required
              value={githubRepository}
            />
          </label>
          <label>
            Branch
            <input
              name="githubBranch"
              onChange={(event) => setGithubBranch(getInputValue(event))}
              placeholder="main"
              required
              value={githubBranch}
            />
          </label>
          <label>
            Repository Path
            <input
              name="targetDirectory"
              onChange={updateTargetDirectory}
              placeholder="."
              required
              value={targetDirectory}
            />
            <small>Use <code>.</code> for the repository root, or a folder like <code>qa/e2e</code>.</small>
          </label>
        </div>
      ) : null}
    </fieldset>
  );
}
