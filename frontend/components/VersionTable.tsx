"use client";

import { useState } from "react";
import { AlertCircle, ExternalLink, Loader2 } from "lucide-react";
import { previewUrl } from "@/lib/api";
import { formatDateTime, formatSize } from "@/lib/format";
import type { VersionRecord } from "@/lib/types";

interface VersionTableProps {
  documentId: string;
  versions: VersionRecord[];
}

const head = "whitespace-nowrap px-3 py-3 align-middle";
const cell = "whitespace-nowrap px-3 py-3 align-middle";

export function VersionTable({ documentId, versions }: VersionTableProps) {
  const currentNumber = versions[0]?.versionNumber;
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPreview() {
    setError(null);
    // Opened right away, inside the click, or the browser blocks it as a pop-up.
    // The file is fetched first so a failure shows a message here, not raw JSON in the tab.
    const tab = window.open("", "_blank");
    if (tab) tab.document.title = "Loading preview…";
    setOpening(true);
    try {
      const url = await previewUrl(documentId);
      if (tab) tab.location.href = url;
      else window.location.href = url;
      // The tab has loaded it by then; free the memory
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      setError(err instanceof Error ? err.message : "Could not open the preview.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-xs font-semibold text-muted">
            <th scope="col" className={`${head} text-center`}>Version</th>
            <th scope="col" className={`${head} text-left`}>File name</th>
            <th scope="col" className={`${head} text-center`}>Uploaded by</th>
            <th scope="col" className={`${head} text-center`}>Size</th>
            <th scope="col" className={`${head} text-center`}>Date</th>
            <th scope="col" className={`${head} text-center`}>Preview</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((version) => {
            const isCurrent = version.versionNumber === currentNumber;
            return (
              <tr key={version.id} className="border-b border-line last:border-0">
                <td className={`${cell} text-center`}>
                  <span className="font-semibold">v{version.versionNumber}</span>
                  {isCurrent && (
                    <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">
                      Current
                    </span>
                  )}
                </td>
                <td className={`${cell} max-w-44 truncate text-left`} title={version.originalName}>
                  {version.originalName}
                </td>
                <td className={`${cell} text-center text-muted`}>{version.uploadedByName}</td>
                <td className={`${cell} text-center text-muted`}>{formatSize(version.sizeBytes)}</td>
                <td className={`${cell} text-center text-muted`}>{formatDateTime(version.createdAt)}</td>
                <td className={`${cell} text-center`}>
                  {isCurrent ? (
                    <button
                      type="button"
                      onClick={() => void openPreview()}
                      disabled={opening}
                      className="inline-flex items-center gap-1 font-semibold text-brand hover:underline disabled:opacity-60"
                    >
                      {opening ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      )}
                      Open
                      <span className="sr-only"> (opens in a new tab)</span>
                    </button>
                  ) : (
                    <span
                      className="text-muted"
                      title="Only the current version can be previewed"
                    >
                      –
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && (
        <p role="alert" className="flex items-center gap-2 border-t border-line px-4 py-3 text-sm text-danger">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
