import type { FrameworkTemplatePreviewResponse } from "@flawferret2/job-schemas";

// Full per-file list, collapsed behind a <details> disclosure so the Files section can lead with
// a file-count/conflict-count summary instead of an always-expanded card per file. Extracted to
// its own module (rather than living inline in page.tsx) so it can be shared by both the
// server-rendered "Results & Next Steps" panel and the client-rendered live Files preview.
//
// The list itself is a dense two-column monospace block: at 12-24 files the useful information is
// the path and whether it conflicts with something already on disk, so each row carries the path
// plus a conflict flag, with the per-file category/description kept as the row's tooltip.
export function FrameworkFilePreviewDetails({
  existingCount,
  preview,
}: {
  existingCount: number;
  preview: FrameworkTemplatePreviewResponse;
}) {
  return (
    <details className="framework-command-copy framework-file-list-details">
      <summary>
        {existingCount > 0
          ? `View all ${preview.totalFiles} files (${existingCount} conflicts)`
          : `View all ${preview.totalFiles} files`}
      </summary>
      <div className="framework-files-grid">
        {preview.files.map((file) => (
          <span
            key={file.path}
            className={file.status === "exists" ? "framework-file-entry conflict" : "framework-file-entry"}
            title={`${file.category} — ${file.description}`}
          >
            {file.path}
            {file.status === "exists" ? <em className="framework-file-flag">conflict</em> : null}
          </span>
        ))}
      </div>
    </details>
  );
}
