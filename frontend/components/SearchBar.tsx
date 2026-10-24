"use client";

import { useEffect, useRef, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Button } from "./Button";

export interface SearchValues {
  q: string;
  tags: string;
  uploader: string;
}

export function normalizeTags(raw: string): string {
  return [
    ...new Set(
      raw
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].join(",");
}

interface SearchBarProps {
  initial: SearchValues;
  onSearch: (values: SearchValues) => void;
}

const DEBOUNCE_MS = 300;

function same(a: SearchValues, b: SearchValues): boolean {
  return a.q === b.q && a.tags === b.tags && a.uploader === b.uploader;
}

export function SearchBar({ initial, onSearch }: SearchBarProps) {
  const [q, setQ] = useState(initial.q);
  const [tags, setTags] = useState(initial.tags);
  const [uploader, setUploader] = useState(initial.uploader);
  const [filtersOpen, setFiltersOpen] = useState(Boolean(initial.tags || initial.uploader));

  // The last values we sent to the URL: used to tell our own updates apart from outside changes
  const lastSent = useRef<SearchValues>({
    q: initial.q,
    tags: normalizeTags(initial.tags),
    uploader: initial.uploader,
  });
  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  });

  // Typing: wait for a short pause, then update the URL
  useEffect(() => {
    const next = { q: q.trim(), tags: normalizeTags(tags), uploader: uploader.trim() };
    if (same(next, lastSent.current)) return;

    const timer = setTimeout(() => {
      lastSent.current = next;
      onSearchRef.current(next);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, tags, uploader]);

  // Outside changes (Clear all, removing a chip, the Back button): copy them into the inputs
  useEffect(() => {
    const incoming = {
      q: initial.q,
      tags: normalizeTags(initial.tags),
      uploader: initial.uploader,
    };
    if (same(incoming, lastSent.current)) return;
    lastSent.current = incoming;
    setQ(initial.q);
    setTags(initial.tags);
    setUploader(initial.uploader);
  }, [initial.q, initial.tags, initial.uploader]);

  const inputClass =
    "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm placeholder:text-muted/70 focus:border-brand";

  return (
    <form role="search" onSubmit={(e) => e.preventDefault()} className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <label htmlFor="q" className="sr-only">
            Search by title
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            id="q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search documents by title…"
            className={`${inputClass} pl-10`}
          />
        </div>
        <Button
          variant="secondary"
          aria-expanded={filtersOpen}
          aria-controls="filter-panel"
          onClick={() => setFiltersOpen((open) => !open)}
          className="py-2.5"
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Filters
        </Button>
      </div>

      {filtersOpen && (
        <div
          id="filter-panel"
          className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:max-w-2xl sm:grid-cols-2"
        >
          <div>
            <label htmlFor="tags" className="mb-1.5 block text-sm font-semibold">
              Tags
            </label>
            <input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="finance, report"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-muted">Separate with commas. Documents must have all of them.</p>
          </div>
          <div>
            <label htmlFor="uploader" className="mb-1.5 block text-sm font-semibold">
              Uploaded by
            </label>
            <input
              id="uploader"
              value={uploader}
              onChange={(e) => setUploader(e.target.value)}
              placeholder="Part of a name"
              className={inputClass}
            />
          </div>
        </div>
      )}
    </form>
  );
}