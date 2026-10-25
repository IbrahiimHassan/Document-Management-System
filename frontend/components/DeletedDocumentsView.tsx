"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { listDeleted, restoreDocument } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { DeletedDocument } from "@/lib/types";
import { Button } from "./Button";
import { StatusScreen } from "./StatusScreen";

export function DeletedDocumentsView() {
  const { user } = useAuth();
  const [items, setItems] = useState<DeletedDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restored, setRestored] = useState<{ id: string; title: string } | null>(null);
  const isAdmin = user.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    listDeleted()
      .then((list) => active && setItems(list))
      .catch((err: unknown) => active && setError(err instanceof Error ? err.message : "Could not load the list."));
    return () => {
      active = false;
    };
  }, [isAdmin]);

  // The API refuses non-admins too; this just explains it nicely
  if (!isAdmin) return <StatusScreen kind="forbidden" />;

  async function restore(doc: DeletedDocument) {
    setRestoring(doc.id);
    setError(null);
    try {
      await restoreDocument(doc.id);
      setItems((list) => list?.filter((d) => d.id !== doc.id) ?? null);
      setRestored({ id: doc.id, title: doc.title });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore. Try again.");
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="space-y-4">
      {restored && (
        <p role="status" className="rounded-lg bg-brand-soft px-4 py-3 text-sm text-brand">
          Restored{" "}
          <Link href={`/documents/${restored.id}`} className="font-semibold underline">
            {restored.title}
          </Link>
          .
        </p>
      )}
      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {!items ? (
        !error && (
          <div className="space-y-3" aria-busy="true" aria-label="Loading deleted documents">
            {[0, 1].map((n) => (
              <div key={n} className="h-16 animate-pulse rounded-xl border border-line bg-surface" />
            ))}
          </div>
        )
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface p-10 text-center">
          <Trash2 className="mx-auto size-9 text-muted" aria-hidden="true" />
          <h2 className="mt-3 font-semibold">Nothing has been deleted</h2>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((doc) => (
            <li
              key={doc.id}
              className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{doc.title}</p>
                <p className="mt-0.5 text-xs text-muted">
                  Uploaded by {doc.uploaderName} · v{doc.currentVersion} · deleted by {doc.deletedByName} on{" "}
                  {formatDateTime(doc.deletedAt)}
                </p>
              </div>
              <Button variant="secondary" onClick={() => void restore(doc)} disabled={restoring !== null}>
                {restoring === doc.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCcw className="size-4" aria-hidden="true" />
                )}
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
