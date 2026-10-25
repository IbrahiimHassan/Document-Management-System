import Link from "next/link";
import { BellRing, Calendar, ChevronRight, HardDrive, User } from "lucide-react";
import { formatDate, formatSize } from "@/lib/format";
import type { DocumentSummary } from "@/lib/types";
import { Badge } from "./Badge";
import { FileIcon } from "./FileIcon";
import { TagChips } from "./TagChips";

export function DocumentCard({ doc }: { doc: DocumentSummary }) {
  const changedSinceDownload =
    doc.lastDownloadedVersion !== null && doc.lastDownloadedVersion < doc.currentVersion;

  return (
    <Link
      href={`/documents/${doc.id}`}
      className="group flex items-center gap-4 rounded-xl border border-line bg-surface p-4 transition hover:border-brand hover:shadow-sm"
    >
      <FileIcon mimeType={doc.mimeType} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="truncate font-semibold">{doc.title}</h2>
          <Badge visibility={doc.visibility} />
          {changedSinceDownload && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-semibold text-warn"
              title={`You downloaded v${doc.lastDownloadedVersion}; the current version is v${doc.currentVersion}`}
            >
              <BellRing className="size-3" aria-hidden="true" />
              New version since your download
            </span>
          )}
        </div>
        {doc.snippet ? (
          // Where the search words were found inside the file. Rendered as text
          // pieces, never as HTML, so the file's contents can't inject markup.
          <p className="mt-1 line-clamp-2 text-sm text-muted">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-brand">In file:</span>
            {doc.snippet.map((part, i) =>
              part.match ? (
                <mark key={i} className="rounded bg-warn-soft px-0.5 font-semibold text-ink">
                  {part.text}
                </mark>
              ) : (
                <span key={i}>{part.text}</span>
              ),
            )}
          </p>
        ) : (
          doc.description && <p className="mt-0.5 line-clamp-1 text-sm text-muted">{doc.description}</p>
        )}
        <div className="mt-2">
          <TagChips tags={doc.tags} />
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <div className="flex items-center gap-1.5">
            <User className="size-3.5" aria-hidden="true" />
            <dt className="sr-only">Uploaded by</dt>
            <dd>{doc.uploaderName}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar className="size-3.5" aria-hidden="true" />
            <dt className="sr-only">Last updated</dt>
            <dd>{formatDate(doc.updatedAt)}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <HardDrive className="size-3.5" aria-hidden="true" />
            <dt className="sr-only">Size</dt>
            <dd>
              {formatSize(doc.sizeBytes)} · v{doc.currentVersion}
            </dd>
          </div>
        </dl>
      </div>

      <ChevronRight
        className="size-5 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand"
        aria-hidden="true"
      />
    </Link>
  );
}
