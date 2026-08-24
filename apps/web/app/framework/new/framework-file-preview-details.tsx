import type { FrameworkTemplatePreviewResponse } from "@flawferret2/job-schemas";

// Full per-file list, collapsed behind a <details> disclosure so the Files section can lead with
// a file-count/conflict-count summary instead of an always-expanded card per file. Extracted to
// its own module (rather than living inline in page.tsx) so it can be shared by both the
// server-rendered "Results & Next Steps" panel and the client-rendered live Files preview.
//
// Rendered as a dense two-column monospace list rather than a card per file: at 12–24 files the
// per-file cards were the tallest thing on the page for the least-important information at build
// time. Paths stay mono (the app's signal for literal system output) and each file's longer
// description is kept as the row's title rather than dropped. Conflicts are still flagged inline —
// that's the one file-level fact that matters before a potentially destructive overwrite.
export function FrameworkFilePreviewDetails({
  existingCount,
  preview,
}: {
  existingCount: number;
  preview: FrameworkTemplatePreviewResponse;
}) {
  return (
    <details className="framework-files-list">
      <summary>
        {existingCount > 0
          ? `View all ${preview.totalFiles} files (${existingCount} conflicts)`
          : `View all ${preview.totalFiles} files`}
      </summary>
      <div className="framework-files-grid">
        {preview.files.map((file) => (
          <span
            className={file.status === "exists" ? "framework-file-entry conflict" : "framework-file-entry"}
            key={file.path}
            title={file.description}
          >
            {file.path}
            {file.status === "exists" ? <em>conflict</em> : null}
          </span>
        ))}
      </div>
    </details>
  );
}
