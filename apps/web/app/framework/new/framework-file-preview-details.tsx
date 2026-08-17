import type { FrameworkTemplatePreviewResponse } from "@flawferret2/job-schemas";

// Full per-file list, collapsed behind a <details> disclosure so the Files section can lead with
// a file-count/conflict-count summary instead of an always-expanded card per file. Extracted to
// its own module (rather than living inline in page.tsx) so it can be shared by both the
// server-rendered "Results & Next Steps" panel and the client-rendered live Files preview.
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
      <div className="framework-file-list">
        {preview.files.map((file) => (
          <article key={file.path} className="framework-file-card">
            <div>
              <span>{file.category}</span>
              <strong>{file.path}</strong>
              <p>{file.description}</p>
            </div>
            {file.status ? <mark className={`framework-file-status ${file.status}`}>{file.status}</mark> : null}
            <code>{file.contentPreview}</code>
          </article>
        ))}
      </div>
    </details>
  );
}
