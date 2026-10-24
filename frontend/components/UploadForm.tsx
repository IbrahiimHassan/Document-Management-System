"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileText, Globe, Loader2, Lock, UploadCloud, X } from "lucide-react";
import { createDocument, listDepartments } from "@/lib/api";
import { formatSize } from "@/lib/format";
import type { Department } from "@/lib/types";
import { Button } from "./Button";

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
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    listDepartments()
      .then((items) => {
        if (active) setDepartments(items);
      })
      .catch((err: unknown) => {
        if (active) {
          setDepartmentsError(err instanceof Error ? err.message : "Could not load departments.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function pickFile(picked: File | undefined) {
    if (!picked) return;
    const problem = checkFile(picked);
    setErrors((e) => ({ ...e, file: problem ?? undefined }));
    setFile(problem ? null : picked);
    if (!problem && !title.trim()) {
      setTitle(picked.name.replace(/\.[^.]+$/, ""));
    }
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

  const options = [
    { value: "public", label: "Everyone", hint: "All users", Icon: Globe },
    { value: "restricted", label: "Selected departments", hint: "Choose below", Icon: Lock },
  ] as const;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="grid max-w-5xl gap-6 rounded-xl border border-line bg-surface p-5 lg:grid-cols-2"
    >
      {/* Left: the document */}
      <div className="flex flex-col">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex min-h-64 flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
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
                  if (fileInput.current) fileInput.current.value = "";
                }}
                className="rounded-md p-1.5 text-muted hover:bg-page hover:text-ink"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <>
              <UploadCloud className="size-10 text-brand" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold">Drag and drop a file here</p>
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
              <p className="mt-3 text-xs text-muted">PDF, DOCX or XLSX, up to 10 MB</p>
            </>
          )}
        </div>
        {errors.file && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {errors.file}
          </p>
        )}
      </div>

      {/* Right: the details */}
      <div className="space-y-4">
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

        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">Who can see it?</legend>
          <div className="grid grid-cols-2 gap-2">
            {options.map(({ value, label, hint, Icon }) => (
              <label
                key={value}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                  visibility === value ? "border-brand bg-brand-soft" : "border-line hover:bg-page"
                }`}
              >
                <input
                  type="radio"
                  name="visibility"
                  value={value}
                  checked={visibility === value}
                  onChange={() => setVisibility(value)}
                  className="accent-[#0f6b57]"
                />
                <Icon className="size-4 shrink-0 text-brand" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight">{label}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </div>

          {visibility === "restricted" && (
            <div className="mt-2 rounded-lg border border-line p-3">
              {departmentsError ? (
                <p role="alert" className="text-sm text-danger">
                  {departmentsError}
                </p>
              ) : !departments ? (
                <p className="text-sm text-muted">Loading departments…</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {departments.map((dep) => (
                    <label
                      key={dep.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${
                        departmentIds.includes(dep.id)
                          ? "border-brand bg-brand-soft text-brand"
                          : "border-line text-muted hover:bg-page"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={departmentIds.includes(dep.id)}
                        onChange={() => toggleDepartment(dep.id)}
                        className="accent-[#0f6b57]"
                      />
                      {dep.name}
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-muted">You and admins can always see it.</p>
              {errors.departments && (
                <p role="alert" className="mt-1 text-sm text-danger">
                  {errors.departments}
                </p>
              )}
            </div>
          )}
        </fieldset>

        {formError && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}

        <Button type="submit" fullWidth disabled={submitting} className="py-2.5">
          {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {submitting ? "Uploading…" : "Upload document"}
        </Button>
      </div>
    </form>
  );
}