"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { updateDocument } from "@/lib/api";
import type { DocumentDetail } from "@/lib/types";
import { useDepartments } from "@/lib/useDepartments";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { normalizeTags } from "./SearchBar";
import { VisibilityPicker } from "./VisibilityPicker";

interface EditDocumentDialogProps {
  doc: DocumentDetail;
  open: boolean;
  onClose: () => void;
  onSaved: (doc: DocumentDetail) => void;
}

const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70 focus:border-brand";

// The form only exists while the dialog is open, so it starts from the latest values each time
function EditForm({ doc, onClose, onSaved }: Omit<EditDocumentDialogProps, "open">) {
  const { departments, error: departmentsError } = useDepartments();
  const [title, setTitle] = useState(doc.title);
  const [description, setDescription] = useState(doc.description ?? "");
  const [tags, setTags] = useState(doc.tags.join(", "));
  const [visibility, setVisibility] = useState(doc.visibility);
  const [departmentIds, setDepartmentIds] = useState(doc.allowedDepartments.map((d) => d.id));
  const [errors, setErrors] = useState<{ title?: string; departments?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleDepartment(id: string) {
    setDepartmentIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setErrors((e) => ({ ...e, departments: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const found: typeof errors = {};
    if (!title.trim()) found.title = "Enter a title.";
    if (visibility === "restricted" && departmentIds.length === 0) {
      found.departments = "Choose at least one department.";
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      // The server only records the fields that really changed
      const saved = await updateDocument(doc.id, {
        title: title.trim(),
        description: description.trim() || null,
        tags: normalizeTags(tags).split(",").filter(Boolean),
        visibility,
        ...(visibility === "restricted" ? { departmentIds } : {}),
      });
      onSaved(saved);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save. Try again.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="edit-title" className="mb-1.5 block text-sm font-semibold">
          Title <span className="text-danger">*</span>
        </label>
        <input
          id="edit-title"
          value={title}
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value);
            setErrors((er) => ({ ...er, title: undefined }));
          }}
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
        <label htmlFor="edit-description" className="mb-1.5 block text-sm font-semibold">
          Description
        </label>
        <textarea
          id="edit-description"
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${inputClass} resize-none`}
        />
      </div>

      <div>
        <label htmlFor="edit-tags" className="mb-1.5 block text-sm font-semibold">
          Tags
        </label>
        <input id="edit-tags" value={tags} onChange={(e) => setTags(e.target.value)} className={inputClass} />
        <p className="mt-1 text-xs text-muted">Separate tags with commas. Up to 10.</p>
      </div>

      <VisibilityPicker
        visibility={visibility}
        onVisibilityChange={setVisibility}
        departmentIds={departmentIds}
        onToggleDepartment={toggleDepartment}
        departments={departments}
        departmentsError={departmentsError}
        error={errors.departments}
      />

      {formError && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {formError}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

export function EditDocumentDialog({ doc, open, onClose, onSaved }: EditDocumentDialogProps) {
  return (
    <Dialog open={open} title="Edit document details" onClose={onClose} wide>
      <EditForm doc={doc} onClose={onClose} onSaved={onSaved} />
    </Dialog>
  );
}
