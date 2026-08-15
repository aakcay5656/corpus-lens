"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

const STATUSES = ["", "INDEXED", "FAILED", "PENDING"] as const;

/**
 * Filters as a form that navigates.
 *
 * Submitting builds a URL and pushes it, so the filtered view is a real address: it can
 * be linked, bookmarked and reloaded, and the table itself stays server-rendered. The
 * alternative — fetching in the browser and holding the results in state — would move the
 * whole document list into client memory for no gain.
 */
export function DocumentFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "");

  function apply(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next = new URLSearchParams();
    if (search.trim() !== "") next.set("search", search.trim());
    if (status !== "") next.set("status", status);
    // Always back to page 1. Staying on page 7 of a narrower result set usually lands on
    // an empty page, which reads as "no matches" when there are plenty.
    router.push(`/dashboard/documents?${next.toString()}`);
  }

  return (
    <form onSubmit={apply} className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
      <label htmlFor="doc-search" className="sr-only">
        Search documents
      </label>
      <input
        id="doc-search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search title or path…"
        className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-ink placeholder:text-faint focus:border-accent"
      />
      <label htmlFor="doc-status" className="sr-only">
        Filter by status
      </label>
      <select
        id="doc-status"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
        className="h-9 rounded-lg border border-border bg-surface px-2 text-sm text-ink"
      >
        {STATUSES.map((value) => (
          <option key={value} value={value}>
            {value === "" ? "Any status" : value}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="secondary">
        Filter
      </Button>
    </form>
  );
}
