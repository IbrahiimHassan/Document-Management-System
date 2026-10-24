"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, FileSearch, X } from "lucide-react";
import { ApiError, listDocuments } from "@/lib/api";
import type { DocumentList } from "@/lib/types";
import { Button } from "./Button";
import { DocumentCard } from "./DocumentCard";
import { Pagination } from "./Pagination";
import { SearchBar, normalizeTags } from "./SearchBar";
import type { SearchValues } from "./SearchBar";

interface Params extends SearchValues {
  page: number;
  limit: number;
}

function toInt(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

type Result = { key: string; data?: DocumentList; error?: string };

export function DocumentsView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const params: Params = {
    q: searchParams.get("q") ?? "",
    tags: searchParams.get("tags") ?? "",
    uploader: searchParams.get("uploader") ?? "",
    page: toInt(searchParams.get("page"), 1, 1, 100000),
    limit: toInt(searchParams.get("limit"), 10, 1, 50),
  };

  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);

  const key = JSON.stringify([params, attempt]);
  const loading = result?.key !== key;

  useEffect(() => {
    let active = true;
    listDocuments(params)
      .then((data) => {
        if (active) setResult({ key, data });
      })
      .catch((err: unknown) => {
        // A 401 already redirected to /login inside the API helper
        if (active && !(err instanceof ApiError && err.status === 401)) {
          setResult({
            key,
            error: err instanceof Error ? err.message : "Could not load documents.",
          });
        }
      });
    return () => {
      active = false;
    };
    // `key` already captures every value in `params`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function update(next: Partial<Params>, mode: "push" | "replace" = "push") {
    const merged = { ...params, ...next };
    const query = new URLSearchParams();
    if (merged.q) query.set("q", merged.q);
    if (merged.tags) query.set("tags", normalizeTags(merged.tags));
    if (merged.uploader) query.set("uploader", merged.uploader);
    if (merged.page > 1) query.set("page", String(merged.page));
    if (merged.limit !== 10) query.set("limit", String(merged.limit));
    const text = query.toString();
    const url = text ? `/?${text}` : "/";
    if (mode === "replace") router.replace(url);
    else router.push(url);
  }

  const activeTags = params.tags ? normalizeTags(params.tags).split(",").filter(Boolean) : [];
  const hasFilters = Boolean(params.q || activeTags.length || params.uploader);
  const sizes = [...new Set([10, 20, 50, params.limit])].sort((a, b) => a - b);
 const data = result?.data;
  const error = result?.key === key ? result.error : undefined;

  return (
    <div className="space-y-5">
      <SearchBar
        initial={{ q: params.q, tags: params.tags, uploader: params.uploader }}
        onSearch={(values) => update({ ...values, page: 1 }, "replace")}
      />

      {(activeTags.length > 0 || params.uploader) && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          {activeTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => update({ tags: activeTags.filter((t) => t !== tag).join(","), page: 1 })}
              aria-label={`Remove tag ${tag}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand hover:bg-brand/15"
            >
              {tag}
              <X className="size-3" aria-hidden="true" />
            </button>
          ))}
          {params.uploader && (
            <button
              type="button"
              onClick={() => update({ uploader: "", page: 1 })}
              aria-label="Remove uploader filter"
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand hover:bg-brand/15"
            >
              By {params.uploader}
              <X className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {hasFilters && (
        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-sm font-semibold text-brand hover:underline"
        >
          Clear all
        </button>
      )}

      {error ? (
        <div role="alert" className="rounded-xl border border-line bg-surface p-8 text-center">
          <AlertCircle className="mx-auto size-8 text-danger" aria-hidden="true" />
          <h2 className="mt-3 font-semibold">Could not load documents</h2>
          <p className="mt-1 text-sm text-muted">{error}</p>
          <div className="mt-4 flex justify-center">
            <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
          </div>
        </div>
      ) : !data ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading documents">
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="flex animate-pulse items-center gap-4 rounded-xl border border-line bg-surface p-4">
              <div className="size-11 rounded-lg bg-page" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 rounded bg-page" />
                <div className="h-3 w-2/3 rounded bg-page" />
                <div className="h-3 w-1/4 rounded bg-page" />
              </div>
            </div>
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface p-10 text-center">
          <FileSearch className="mx-auto size-9 text-muted" aria-hidden="true" />
          <h2 className="mt-3 font-semibold">No documents found</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            {hasFilters
              ? "Try a shorter title or remove a filter."
              : "Nothing has been shared with you yet. Upload the first document."}
          </p>
          {hasFilters && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" onClick={() => router.push("/")}>
                Clear all filters
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <p aria-live="polite">
              Showing {(data.page - 1) * data.limit + 1}–
              {(data.page - 1) * data.limit + data.items.length} of {data.total} documents
            </p>
            <label className="flex items-center gap-2">
              Per page
              <select
                value={params.limit}
                onChange={(e) => update({ limit: Number(e.target.value), page: 1 })}
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              >
                {sizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ul className="space-y-3">
            {data.items.map((doc) => (
              <li key={doc.id}>
                <DocumentCard doc={doc} />
              </li>
            ))}
          </ul>

          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            onChange={(page) => update({ page })}
          />
        </>
      )}
    </div>
  );
}