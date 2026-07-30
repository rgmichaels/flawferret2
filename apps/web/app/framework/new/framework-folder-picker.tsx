"use client";

import type { ChangeEvent } from "react";
import { useState } from "react";
import type { FrameworkTemplateRequest } from "@flawferret2/job-schemas";

type FileSystemWritableFileStreamLike = {
  close: () => Promise<void>;
  write: (content: string) => Promise<void>;
};

type FileSystemFileHandleLike = {
  createWritable: () => Promise<FileSystemWritableFileStreamLike>;
};

type FileSystemDirectoryHandleLike = {
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemDirectoryHandleLike>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemFileHandleLike>;
  name: string;
};

type BrowserTemplateResponse = {
  files: Array<{
    content: string;
    path: string;
  }>;
  totalFiles: number;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const getDirectoryPicker = () =>
  ((globalThis as unknown) as {
    showDirectoryPicker?: (options?: { mode?: "readwrite" }) => Promise<FileSystemDirectoryHandleLike>;
  }).showDirectoryPicker;

const getInputValue = (event: ChangeEvent<HTMLInputElement>) => ((event.currentTarget as unknown) as { value: string }).value;

const getCheckedValue = (event: ChangeEvent<HTMLInputElement>) =>
  ((event.currentTarget as unknown) as { checked: boolean }).checked;

const getWritableDirectory = async (root: FileSystemDirectoryHandleLike, folderName: string) => {
  const trimmedName = folderName.trim();

  if (!trimmedName) {
    return root;
  }

  return root.getDirectoryHandle(trimmedName, {
    create: true,
  });
};

const fileExists = async (directory: FileSystemDirectoryHandleLike, fileName: string) => {
  try {
    await directory.getFileHandle(fileName);

    return true;
  } catch {
    return false;
  }
};

const writeTemplateFile = async (
  root: FileSystemDirectoryHandleLike,
  path: string,
  content: string,
  overwriteExisting: boolean,
) => {
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.at(-1);

  if (!fileName) {
    return "skipped";
  }

  let directory = root;
  for (const part of parts.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(part, {
      create: true,
    });
  }

  if (!overwriteExisting && (await fileExists(directory, fileName))) {
    return "skipped";
  }

  const file = await directory.getFileHandle(fileName, {
    create: true,
  });
  const writable = await file.createWritable();
  await writable.write(content);
  await writable.close();

  return "written";
};

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
  const [selectedFolder, setSelectedFolder] = useState<FileSystemDirectoryHandleLike | null>(null);
  const [folderName, setFolderName] = useState("");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pickerAvailable = Boolean(getDirectoryPicker());
  const updateTargetDirectory = (event: ChangeEvent<HTMLInputElement>) => {
    setTargetDirectory(getInputValue(event));
  };

  const chooseFolder = async () => {
    const picker = getDirectoryPicker();

    if (!picker) {
      setError("Native folder selection is not available in this browser. Type a server path instead.");
      return;
    }

    setError(null);
    setMessage(null);
    const handle = await picker({
      mode: "readwrite",
    });

    setSelectedFolder(handle);
  };

  const createInSelectedFolder = async () => {
    if (!selectedFolder) {
      return;
    }

    setIsWriting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`${apiUrl}/frameworks/browser-template`, {
        body: JSON.stringify(request),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error((await response.text()) || "Unable to load framework files.");
      }

      const template = (await response.json()) as BrowserTemplateResponse;
      const target = await getWritableDirectory(selectedFolder, folderName);
      let written = 0;
      let skipped = 0;

      for (const file of template.files) {
        const result = await writeTemplateFile(target, file.path, file.content, overwriteExisting);

        if (result === "written") {
          written += 1;
        } else {
          skipped += 1;
        }
      }

      setMessage(`${written} files written to ${folderName.trim() || selectedFolder.name}. ${skipped} skipped.`);
    } catch (writeError) {
      setError(writeError instanceof Error ? writeError.message : "Unable to write framework files.");
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
        <button onClick={chooseFolder} type="button">
          Choose Folder
        </button>
      </div>
      <small>
        {selectedFolder
          ? `Using browser folder: ${selectedFolder.name}`
          : "Type a server path, or choose a local folder with the browser picker."}
      </small>

      {selectedFolder ? (
        <div className="framework-folder-create-row">
          <label>
            New Folder
            <input
              onChange={(event) => setFolderName(getInputValue(event))}
              placeholder="Optional folder to create inside selected folder"
              value={folderName}
            />
          </label>
          <label className="framework-overwrite-option">
            <input checked={overwriteExisting} onChange={(event) => setOverwriteExisting(getCheckedValue(event))} type="checkbox" />
            <span>
              <strong>Overwrite existing files</strong>
              <small>Leave unchecked to skip files that already exist.</small>
            </span>
          </label>
        </div>
      ) : null}

      {showCreateControls ? (
        <div className="framework-folder-create-actions">
          <button disabled={!pickerAvailable || !selectedFolder || isWriting} onClick={createInSelectedFolder} type="button">
            {isWriting ? "Creating..." : "Create in Chosen Folder"}
          </button>
          {!pickerAvailable ? (
            <p className="framework-folder-muted">Native folder writing is available in Chromium browsers on localhost.</p>
          ) : null}
          {message ? <p className="framework-folder-success">{message}</p> : null}
          {error ? <p className="framework-folder-error">{error}</p> : null}
        </div>
      ) : error ? (
        <p className="framework-folder-error">{error}</p>
      ) : null}
    </div>
  );
}
