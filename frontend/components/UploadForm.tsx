"use client";

import { useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, FileText, Loader2, UploadCloud, X } from "lucide-react";
import { createDocument, findDuplicates } from "@/lib/api";
import { formatSize } from "@/lib/format";
import type { DuplicateMatch } from "@/lib/types";
import { useDepartments } from "@/lib/useDepartments";
import { Button } from "./Button";
import { VisibilityPicker } from "./VisibilityPicker";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = [".pdf", ".docx", ".xlsx"];

// Quick feedback only: the server checks the real file type again
function checkFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ALLOWED.some((ext) => name.endsWith(ext))) return "Choose a PDF, DOCX or XLSX file.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_BYTES) return `That file is ${formatSize(file.size)}. The limit is 10 MB.`;
  return null;
}

// SHA-256 of the file, computed in the browser. null where the browser can't
// (Web Crypto needs https or localhost); the duplicate check is then skipped.
async function sha256(file: File): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

interface FieldErrors {
  file?: string;
  title?: string;
  departments?: string;
}

export function UploadForm() {
  const router = useRouter();

  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState<"public" | "restricted">("public");
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const { departments, error: departmentsError } = useDepartments();
  // Documents you can see that already have this exact file
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // The file being checked, so a slow check for an earlier file can't show its result
  const checking = useRef<File | null>(null);

  async function checkDuplicates(picked: File) {
    checking.current = picked;
    setDuplicates([]);
    try {
      const checksum = await sha256(picked);
      if (!checksum) return;
      const matches = await findDuplicates(checksum);
      if (checking.current === picked) setDuplicates(matches);
    } catch {
      // Only a hint: never block the upload because the check failed
    }
  }

  function pickFile(picked: File | undefined) {
    if (!picked) return;
    const problem = checkFile(picked);
    setErrors((e) => ({ ...e, file: problem ?? undefined }));
    setFile(problem ? null : picked);
    if (problem) {
      checking.current = null;
      setDuplicates([]);
      return;
    }
    if (!title.trim()) {
      setTitle(picked.name.replace(/\.[^.]+$/, ""));
    }
    void checkDuplicates(picked);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    pickFile(event.dataTransfer.files[0]);
  }

  function toggleDepartment(id: string) {
    setDepartmentIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setErrors((e) => ({ ...e, departments: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const found: FieldErrors = {};
    if (!file) found.file = "Choose a file to upload.";
    if (!title.trim()) found.title = "Enter a title.";
    if (visibility === "restricted" && departmentIds.length === 0) {
      found.departments = "Choose at least one department.";
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || !file) return;

    const form = new FormData();
    form.append("file", file);
    form.append("title", title.trim());
    if (description.trim()) form.append("description", description.trim());
    if (tags.trim()) form.append("tags", tags);
    form.append("visibility", visibility);
    if (visibility === "restricted") form.append("departmentIds", departmentIds.join(","));

    setSubmitting(true);
    try {
      const created = await createDocument(form);
      router.push(`/documents/${created.documentId}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Upload failed. Try again.");
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70 focus:border-brand";

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="grid max-w-5xl gap-6 rounded-xl border border-line bg-surface p-5 lg:grid-cols-2"
    >
      {/* Left: the file, and who can see it */}
      <div className="space-y-4">
        <div>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex h-36 flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
              dragging ? "border-brand bg-brand-soft" : errors.file ? "border-danger" : "border-line"
            }`}
          >
            <input
              ref={fileInput}
              id="file"
              type="file"
              accept=".pdf,.docx,.xlsx"
              className="sr-only"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            {file ? (
              <div className="flex max-w-full items-center justify-center gap-3">
                <FileText className="size-8 shrink-0 text-brand" aria-hidden="true" />
                <div className="min-w-0 text-left">
                  <p className="truncate text-sm font-semibold">{file.name}</p>
                  <p className="text-xs text-muted">{formatSize(file.size)}</p>
                </div>
                <button
                  type="button"
                  aria-label="Remove file"
                  onClick={() => {
                    setFile(null);
                    checking.current = null;
                    setDuplicates([]);
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                  className="rounded-md p-1.5 text-muted hover:bg-page hover:text-ink"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <>
                <UploadCloud className="size-8 text-brand" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold">Drag and drop a file here</p>
                <p className="mt-1 text-xs text-muted">
                  or{" "}
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="font-semibold text-brand hover:underline"
                  >
                    browse your computer
                  </button>
                </p>
                <p className="mt-2 text-xs text-muted">PDF, DOCX or XLSX, up to 10 MB</p>
              </>
            )}
          </div>
          {errors.file && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {errors.file}
            </p>
          )}
          {duplicates.length > 0 && (
            <p role="status" className="mt-2 flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
              <Copy className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-semibold">Already uploaded as </span>
                {duplicates.map((match, i) => (
                  <span key={match.id}>
                    {i > 0 && ", "}
                    <Link href={`/documents/${match.id}`} className="font-semibold underline">
                      {match.title}
                    </Link>
                  </span>
                ))}
                . To update it, add a new version there instead.
              </span>
            </p>
          )}
        </div>

        <VisibilityPicker
          visibility={visibility}
          onVisibilityChange={setVisibility}
          departmentIds={departmentIds}
          onToggleDepartment={toggleDepartment}
          departments={departments}
          departmentsError={departmentsError}
          error={errors.departments}
          showAudience
        />
      </div>

      {/* Right: the details */}
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="title" className="mb-1.5 block text-sm font-semibold">
            Title <span className="text-danger">*</span>
          </label>
          <input
            id="title"
            value={title}
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value);
              setErrors((er) => ({ ...er, title: undefined }));
            }}
            placeholder="Enter a document title"
            aria-invalid={Boolean(errors.title)}
            className={inputClass}
          />
          {errors.title && (
            <p role="alert" className="mt-1.5 text-sm text-danger">
              {errors.title}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="description" className="mb-1.5 block text-sm font-semibold">
            Description <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="description"
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this document about?"
            className={`${inputClass} resize-none`}
          />
        </div>

        <div>
          <label htmlFor="tags" className="mb-1.5 block text-sm font-semibold">
            Tags <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="e.g. finance, policy, internal"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted">Separate tags with commas. Up to 10.</p>
        </div>

        {formError && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}

        {/* mt-auto keeps the button at the bottom, level with the end of the left column */}
        <Button type="submit" fullWidth disabled={submitting} className="mt-auto py-2.5">
          {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {submitting ? "Uploading…" : "Upload document"}
        </Button>
      </div>
    </form>
  );
}