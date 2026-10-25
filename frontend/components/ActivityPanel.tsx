"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Download, Eye, FileSearch, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { getAuditLog } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { AuditAction, AuditEvent } from "@/lib/types";

const actions: Record<AuditAction, { verb: string; Icon: typeof Eye }> = {
  view: { verb: "opened this page", Icon: Eye },
  preview: { verb: "previewed", Icon: FileSearch },
  download: { verb: "downloaded", Icon: Download },
  edit: { verb: "edited", Icon: Pencil },
  delete: { verb: "deleted this document", Icon: Trash2 },
  restore: { verb: "restored this document", Icon: RotateCcw },
};

function describe(event: AuditEvent): string {
  const { verb } = actions[event.action];
  if (event.action === "edit" && event.details?.changes?.length) {
    return `${verb} ${event.details.changes.join(", ")}`;
  }
  if (event.versionNumber !== null) return `${verb} v${event.versionNumber}`;
  return verb;
}

interface ActivityPanelProps {
  documentId: string;
  // Changes when the page reloads the document, so the list refreshes too
  refreshKey: number;
}

// Mounted only while the panel is open, so nothing is fetched until it's expanded
function ActivityList({ documentId, refreshKey }: ActivityPanelProps) {
  const [result, setResult] = useState<{ key: string; events?: AuditEvent[]; error?: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const key = `${documentId}:${refreshKey}`;

  useEffect(() => {
    let active = true;
    getAuditLog(documentId)
      .then((events) => active && setResult({ key, events }))
      .catch((err: unknown) =>
        active && setResult({ key, error: err instanceof Error ? err.message : "Could not load activity." }),
      );
    return () => {
      active = false;
    };
    // `key` captures documentId and refreshKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = result?.key === key ? result : null;
  const events = current?.events ?? [];
  const visible = showAll ? events : events.slice(0, 8);

  return (
    <div id="activity-list" className="border-t border-line">
      {!current ? (
        <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading activity">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-4 animate-pulse rounded bg-page" />
          ))}
        </div>
      ) : current.error ? (
        <p role="alert" className="p-4 text-sm text-danger">
          {current.error}
        </p>
      ) : events.length === 0 ? (
        <p className="p-4 text-sm text-muted">No activity yet.</p>
      ) : (
        <>
          <ol className="divide-y divide-line">
            {visible.map((event) => {
              const { Icon } = actions[event.action];
              return (
                <li key={event.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                    <Icon className="size-3.5" aria-hidden="true" />
                  </span>
                  <p className="min-w-0 flex-1">
                    <span className="font-semibold">{event.userName}</span> {describe(event)}
                  </p>
                  <time
                    dateTime={event.createdAt}
                    title={formatDateTime(event.createdAt)}
                    className="shrink-0 text-xs text-muted"
                  >
                    {formatRelative(event.createdAt)}
                  </time>
                </li>
              );
            })}
          </ol>
          {events.length > 8 && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="w-full border-t border-line px-4 py-2.5 text-sm font-semibold text-brand hover:bg-page"
            >
              {showAll ? "Show less" : `Show all ${events.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Only shown to the uploader and admins (the API refuses everyone else)
export function ActivityPanel({ documentId, refreshKey }: ActivityPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-xl border border-line bg-surface">
      <h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="activity-list"
          className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left font-semibold hover:bg-page"
        >
          Activity
          <ChevronDown
            className={`size-5 text-muted transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </h2>
      {open && <ActivityList documentId={documentId} refreshKey={refreshKey} />}
    </section>
  );
}
