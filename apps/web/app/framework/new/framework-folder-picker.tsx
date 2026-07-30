"use client";

import type { ChangeEvent } from "react";
import { useState } from "react";

type PickFolderResponse = {
  message?: string;
  path?: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const getInputValue = (event: ChangeEvent<HTMLInputElement>) => ((event.currentTarget as unknown) as { value: string }).value;

export function FrameworkFolderPicker({
  defaultValue,
}: {
  defaultValue: string;
}) {
  const [targetDirectory, setTargetDirectory] = useState(defaultValue);
  const [isPicking, setIsPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateTargetDirectory = (event: ChangeEvent<HTMLInputElement>) => {
    setTargetDirectory(getInputValue(event));
  };

  const chooseFolder = async () => {
    setIsPicking(true);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/frameworks/pick-folder`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as PickFolderResponse | null;

      if (!response.ok || !body?.path) {
        throw new Error(body?.message ?? "No folder was selected.");
      }

      setTargetDirectory(body.path);
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : "Unable to choose a folder.");
    } finally {
      setIsPicking(false);
    }
  };

  return (
    <fieldset className="framework-destination">
      <legend>Destination</legend>
      <input name="destinationType" type="hidden" value="local" />

      <label className="framework-destination-option selected">
        <input checked readOnly type="radio" value="local" />
        <span>
          <strong>Local folder</strong>
          <small>Create files on this machine, then commit or register the repo when ready.</small>
        </span>
      </label>

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

      {error ? <p className="framework-folder-error">{error}</p> : null}

      <label className="framework-destination-option disabled">
        <input disabled type="radio" value="github" />
        <span>
          <strong>GitHub repository</strong>
          <small>Coming later: choose or create a repository and write the framework to a branch.</small>
        </span>
      </label>
    </fieldset>
  );
}
