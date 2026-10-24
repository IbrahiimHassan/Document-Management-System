import Link from "next/link";
import { Calendar, ChevronRight, HardDrive, User } from "lucide-react";
import { formatDate, formatSize } from "@/lib/format";
import type { DocumentSummary } from "@/lib/types";
import { Badge } from "./Badge";
import { FileIcon } from "./FileIcon";
import { TagChips } from "./TagChips";

export function DocumentCard({ doc }: { doc: DocumentSummary }) {
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
        </div>
        {doc.description && (
          <p className="mt-0.5 line-clamp-1 text-sm text-muted">{doc.description}</p>
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