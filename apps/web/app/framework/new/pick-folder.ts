// Split out of framework-folder-picker.tsx so the fetch/response-shape handling for the "Choose
// Folder" button is directly unit-testable, independent of React state/hooks — mirrors the split of
// fetch-framework-preview.ts out of framework-files-preview.tsx.
export type PickFolderResult =
  | { kind: "success"; path: string }
  | { kind: "error"; message: string };

type PickFolderResponseBody = {
  message?: string;
  path?: string;
};

export async function pickFolder({ apiUrl }: { apiUrl: string }): Promise<PickFolderResult> {
  try {
    const response = await fetch(`${apiUrl}/frameworks/pick-folder`, {
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as PickFolderResponseBody | null;

    if (!response.ok || !body?.path) {
      return { kind: "error", message: body?.message ?? "No folder was selected." };
    }

    return { kind: "success", path: body.path };
  } catch (pickError) {
    return {
      kind: "error",
      message: pickError instanceof Error ? pickError.message : "Unable to choose a folder.",
    };
  }
}
