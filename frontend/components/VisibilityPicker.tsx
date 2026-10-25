"use client";

import { useEffect, useState } from "react";
import { Globe, Lock, Users } from "lucide-react";
import { countAudience } from "@/lib/api";
import type { Department } from "@/lib/types";

type Visibility = "public" | "restricted";

interface VisibilityPickerProps {
  visibility: Visibility;
  onVisibilityChange: (value: Visibility) => void;
  departmentIds: string[];
  onToggleDepartment: (id: string) => void;
  departments: Department[] | null;
  departmentsError: string | null;
  error?: string;
  // Shows "N people can open it". Counts the current user as the uploader.
  showAudience?: boolean;
}

const options = [
  { value: "public", label: "Everyone", hint: "All users", Icon: Globe },
  { value: "restricted", label: "Selected departments", hint: "Choose below", Icon: Lock },
] as const;

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function AudienceSummary({
  visibility,
  departmentIds,
  departments,
}: {
  visibility: Visibility;
  departmentIds: string[];
  departments: Department[] | null;
}) {
  const key = `${visibility}:${[...departmentIds].sort().join(",")}`;
  const [result, setResult] = useState<{ key: string; count: number | null } | null>(null);

  useEffect(() => {
    let active = true;
    // Short pause so ticking several boxes sends one request
    const timer = setTimeout(() => {
      countAudience(visibility, visibility === "restricted" ? departmentIds : [])
        .then((count) => active && setResult({ key, count }))
        .catch(() => active && setResult({ key, count: null }));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // `key` captures visibility and the chosen departments
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const count = result?.key === key ? result.count : undefined;
  if (count === null) return null;

  const names = (departments ?? []).filter((d) => departmentIds.includes(d.id)).map((d) => d.name);
  const people = count === undefined ? "…" : `${count} ${count === 1 ? "person" : "people"}`;
  const who =
    visibility === "public"
      ? "everyone in the company"
      : names.length > 0
        ? `members of ${listNames(names)}, admins and you`
        : "only admins and you";

  return (
    <p className="mt-2 flex items-start gap-2 rounded-lg bg-page px-3 py-2 text-xs text-muted" aria-live="polite">
      <Users className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden="true" />
      <span>
        <span className="font-semibold text-ink">{people}</span> can open it: {who}.
      </span>
    </p>
  );
}

export function VisibilityPicker({
  visibility,
  onVisibilityChange,
  departmentIds,
  onToggleDepartment,
  departments,
  departmentsError,
  error,
  showAudience = false,
}: VisibilityPickerProps) {
  return (
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
              onChange={() => onVisibilityChange(value)}
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
                    onChange={() => onToggleDepartment(dep.id)}
                    className="accent-[#0f6b57]"
                  />
                  {dep.name}
                </label>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-muted">The uploader and admins can always see it.</p>
          {error && (
            <p role="alert" className="mt-1 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}

      {showAudience && (
        <AudienceSummary visibility={visibility} departmentIds={departmentIds} departments={departments} />
      )}
    </fieldset>
  );
}
