"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, BellRing, Download, Loader2, Pencil, Trash2 } from "lucide-react";
import { ApiError, downloadDocument, getDocument, getVersions } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatSize } from "@/lib/format";
import type { DocumentDetail, VersionRecord } from "@/lib/types";
import { ActivityPanel } from "./ActivityPanel";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { DeleteDocumentDialog } from "./DeleteDocumentDialog";
import { EditDocumentDialog } from "./EditDocumentDialog";
import { FileIcon } from "./FileIcon";
import { NewVersionForm } from "./NewVersionForm";
import { StatusScreen } from "./StatusScreen";
import { TagChips } from "./TagChips";
import { VersionTable } from "./VersionTable";

type State =
  | { status: "loading" }
  | { status: "ready"; doc: DocumentDetail; versions: VersionRecord[] }
  | { status: "not-found" }
  | { status: "forbidden" }
  | { status: "error"; message: string };

function DownloadButton({ doc, onDownloaded }: { doc: DocumentDetail; onDownloaded: () => void }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      await downloadDocument(doc.id, doc.originalName);
      onDownloaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The download failed. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button fullWidth onClick={() => void download()} disabled={downloading}>
        {downloading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="size-4" aria-hidden="true" />
        )}
        {downloading ? "Downloading…" : `Download v${doc.currentVersion}`}
      </Button>
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

export function DocumentDetailView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { user } = useAuth();

  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getDocument(id), getVersions(id)])
      .then(([doc, versions]) => {
        if (active) setState({ status: "ready", doc, versions });
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError) {
          // A 401 already redirected to /login inside the API helper
          if (err.status === 401) return;
          // An invalid id and a hidden document look the same as a missing one
          if (err.status === 404 || err.status === 400) return setState({ status: "not-found" });
          if (err.status === 403) return setState({ status: "forbidden" });
        }
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Could not load this document.",
        });
      });
    return () => {
      active = false;
    };
  }, [id, attempt]);

  function reload() {
    setAttempt((n) => n + 1);
  }

  if (state.status === "not-found") return <StatusScreen kind="not-found" />;
  if (state.status === "forbidden") return <StatusScreen kind="forbidden" />;

  if (state.status === "error") {
    return (
      <div role="alert" className="mx-auto max-w-md rounded-xl border border-line bg-surface p-8 text-center">
        <AlertCircle className="mx-auto size-8 text-danger" aria-hidden="true" />
        <h1 className="mt-3 font-semibold">Could not load this document</h1>
        <p className="mt-1 text-sm text-muted">{state.message}</p>
        <div className="mt-4 flex justify-center">
          <Button
            onClick={() => {
              setState({ status: "loading" });
              reload();
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading document">
        <div className="h-4 w-40 animate-pulse rounded bg-line" />
        <div className="h-28 animate-pulse rounded-xl border border-line bg-surface" />
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="h-64 animate-pulse rounded-xl border border-line bg-surface" />
          <div className="h-64 animate-pulse rounded-xl border border-line bg-surface" />
        </div>
      </div>
    );
  }

  const { doc, versions } = state;
  const canManage = user.role === "admin" || user.id === doc.uploaderId;
  const changedSinceDownload =
    doc.lastDownloadedVersion !== null && doc.lastDownloadedVersion < doc.currentVersion;

  const details: { label: string; value: React.ReactNode }[] = [
    { label: "Uploaded by", value: doc.uploaderName },
    { label: "Created", value: formatDateTime(doc.createdAt) },
    { label: "Last updated", value: formatDateTime(doc.updatedAt) },
    { label: "Current size", value: formatSize(doc.sizeBytes) },
    { label: "Access", value: <Badge visibility={doc.visibility} /> },
  ];
  if (doc.visibility === "restricted") {
    details.push({
      label: "Departments",
      value:
        doc.allowedDepartments.length > 0
          ? doc.allowedDepartments.map((d) => d.name).join(", ")
          : "Uploader and admins only",
    });
  }

  return (
    <div className="space-y-5">
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to documents
      </Link>

      <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <FileIcon mimeType={doc.mimeType} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-xl font-bold tracking-tight">{doc.title}</h1>
              <Badge visibility={doc.visibility} />
            </div>
            {doc.description && <p className="mt-1 text-sm text-muted">{doc.description}</p>}
            <div className="mt-3">
              <TagChips tags={doc.tags} />
            </div>
          </div>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" onClick={() => setDialog("edit")}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
            <Button variant="secondary" onClick={() => setDialog("delete")} className="text-danger">
              <Trash2 className="size-4" aria-hidden="true" />
              Delete
            </Button>
          </div>
        )}
      </section>

      {changedSinceDownload && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          <BellRing className="size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">Updated since your download.</span> You downloaded v
            {doc.lastDownloadedVersion}; the current version is v{doc.currentVersion}.
          </span>
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-xl border border-line bg-surface">
            <h2 className="border-b border-line px-4 py-3 font-semibold">Version history</h2>
            <VersionTable documentId={doc.id} versions={versions} />
          </section>

          {canManage && <ActivityPanel documentId={doc.id} refreshKey={attempt} />}
        </div>

        <aside className="space-y-5 rounded-xl border border-line bg-surface p-4">
          <div>
            <h2 className="font-semibold">Document details</h2>
            <dl className="mt-3 space-y-3 text-sm">
              {details.map(({ label, value }) => (
                <div key={label} className="flex items-start justify-between gap-4">
                  <dt className="text-muted">{label}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Reloading after a download clears the "updated since" banner and refreshes the activity */}
          <DownloadButton doc={doc} onDownloaded={reload} />

          <div className="border-t border-line pt-5">
            {canManage ? (
              <NewVersionForm documentId={doc.id} onUploaded={reload} />
            ) : (
              <p className="text-sm text-muted">
                Only the uploader or an admin can add a new version.
              </p>
            )}
          </div>
        </aside>
      </div>

      {canManage && (
        <>
          <EditDocumentDialog
            doc={doc}
            open={dialog === "edit"}
            onClose={() => setDialog(null)}
            onSaved={() => {
              setDialog(null);
              reload();
            }}
          />
          <DeleteDocumentDialog
            documentId={doc.id}
            title={doc.title}
            open={dialog === "delete"}
            onClose={() => setDialog(null)}
            onDeleted={() => router.push("/")}
          />
        </>
      )}
    </div>
  );
}
