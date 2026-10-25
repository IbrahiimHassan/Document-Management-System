"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { deleteDocument } from "@/lib/api";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

interface DeleteDocumentDialogProps {
  documentId: string;
  title: string;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteDocumentDialog({ documentId, title, open, onClose, onDeleted }: DeleteDocumentDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setDeleting(true);
    setError(null);
    try {
      await deleteDocument(documentId);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete. Try again.");
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} title="Delete this document?" onClose={onClose}>
      <p className="text-sm text-muted">
        <span className="font-semibold text-ink">{title}</span> will disappear for everyone. Its versions and
        activity history are kept, and an admin can restore it.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={deleting}>
          Cancel
        </Button>
        <Button variant="danger" onClick={() => void confirm()} disabled={deleting}>
          {deleting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="size-4" aria-hidden="true" />
          )}
          {deleting ? "Deleting…" : "Delete document"}
        </Button>
      </div>
    </Dialog>
  );
}
