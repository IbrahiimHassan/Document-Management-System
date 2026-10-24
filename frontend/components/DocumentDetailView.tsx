"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Download } from "lucide-react";
import { ApiError, downloadUrl, getDocument, getVersions } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatSize } from "@/lib/format";
import type { DocumentDetail, VersionRecord } from "@/lib/types";
import { Badge } from "./Badge";
import { Button } from "./Button";
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

export function DocumentDetailView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user } = useAuth();

  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

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
  const canAddVersion = user.role === "admin" || user.id === doc.uploaderId;

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

      <section className="flex items-start gap-4 rounded-xl border border-line bg-surface p-5">
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
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="min-w-0 rounded-xl border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-3 font-semibold">Version history</h2>
          <VersionTable versions={versions} />
        </section>

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

          <a
            href={downloadUrl(doc.id)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            <Download className="size-4" aria-hidden="true" />
            Download current version
          </a>

          <div className="border-t border-line pt-5">
            {canAddVersion ? (
              <NewVersionForm documentId={doc.id} onUploaded={reload} />
            ) : (
              <p className="text-sm text-muted">
                Only the uploader or an admin can add a new version.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}