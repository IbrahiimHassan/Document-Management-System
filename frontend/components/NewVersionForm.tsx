"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { addVersion } from "@/lib/api";
import { formatSize } from "@/lib/format";
import { Button } from "./Button";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = [".pdf", ".docx", ".xlsx"];

interface NewVersionFormProps {
  documentId: string;
  onUploaded: () => void;
}

export function NewVersionForm({ documentId, onUploaded }: NewVersionFormProps) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function pick(picked: File | undefined) {
    setError(null);
    if (!picked) {
      setFile(null);
      return;
    }
    const name = picked.name.toLowerCase();
    if (!ALLOWED.some((ext) => name.endsWith(ext))) {
      setError("Choose a PDF, DOCX or XLSX file.");
      setFile(null);
    } else if (picked.size === 0) {
      setError("That file is empty.");
      setFile(null);
    } else if (picked.size > MAX_BYTES) {
      setError(`That file is ${formatSize(picked.size)}. The limit is 10 MB.`);
      setFile(null);
    } else {
      setFile(picked);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }

    const form = new FormData();
    form.append("file", file);

    setSubmitting(true);
    setError(null);
    try {
      await addVersion(documentId, form);
      setFile(null);
      if (input.current) input.current.value = "";
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3">
      <h3 className="text-sm font-semibold">Upload new version</h3>
      <input
        ref={input}
        id="new-version-file"
        type="file"
        accept=".pdf,.docx,.xlsx"
        className="sr-only"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <label
        htmlFor="new-version-file"
        className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line bg-surface px-3 py-2.5 text-sm text-muted transition-colors hover:border-brand hover:text-ink"
      >
        <FileUp className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{file ? file.name : "Choose a file (PDF, DOCX or XLSX)"}</span>
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <Button type="submit" fullWidth disabled={submitting}>
        {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {submitting ? "Uploading…" : "Upload new version"}
      </Button>
    </form>
  );
}