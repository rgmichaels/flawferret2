"use client";

import type { ChangeEvent } from "react";
import { useState } from "react";
import type { CreateFrameworkResponse, FrameworkTemplateRequest } from "@flawferret2/job-schemas";

type PickFolderResponse = {
  message?: string;
  path?: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const getInputValue = (event: ChangeEvent<HTMLInputElement>) => ((event.currentTarget as unknown) as { value: string }).value;

const getCheckedValue = (event: ChangeEvent<HTMLInputElement>) =>
  ((event.currentTarget as unknown) as { checked: boolean }).checked;

export function FrameworkFolderPicker({
  defaultValue,
  request,
  showCreateControls = false,
}: {
  defaultValue: string;
  request: FrameworkTemplateRequest;
  showCreateControls?: boolean;
}) {
  const [targetDirectory, setTargetDirectory] = useState(defaultValue);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateTargetDirectory = (event: ChangeEvent<HTMLInputElement>) => {
    setTargetDirectory(getInputValue(event));
  };

  const chooseFolder = async () => {
    setIsPicking(true);
    setError(null);
    setMessage(null);

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

  const createInTargetDirectory = async () => {
    setIsWriting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`${apiUrl}/frameworks/create`, {
        body: JSON.stringify({
          ...request,
          overwriteExisting,
          targetDirectory,
        }),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error((await response.text()) || "Unable to create framework files.");
      }

      const result = (await response.json()) as CreateFrameworkResponse;
      setMessage(
        `${result.createdFiles.length} files created in ${targetDirectory}. ${result.overwrittenFiles.length} overwritten, ${result.skippedFiles.length} skipped.`,
      );
    } catch (writeError) {
      setError(writeError instanceof Error ? writeError.message : "Unable to create framework files.");
    } finally {
      setIsWriting(false);
    }
  };

  return (
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

      {showCreateControls ? (
        <div className="framework-folder-create-actions">
          <label className="framework-overwrite-option">
            <input checked={overwriteExisting} onChange={(event) => setOverwriteExisting(getCheckedValue(event))} type="checkbox" />
            <span>
              <strong>Overwrite existing files</strong>
              <small>Leave unchecked to skip files that already exist.</small>
            </span>
          </label>
          <button disabled={!targetDirectory.trim() || isWriting} onClick={createInTargetDirectory} type="button">
            {isWriting ? "Creating..." : "Create in Target Directory"}
          </button>
          {message ? <p className="framework-folder-success">{message}</p> : null}
          {error ? <p className="framework-folder-error">{error}</p> : null}
        </div>
      ) : error ? (
        <p className="framework-folder-error">{error}</p>
      ) : null}
    </div>
  );
}
