"use client";

import { useState } from "react";
import { type Passage } from "@corpus-lens/shared/search";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";

/**
 * One retrieved passage, as the user's means of checking a claim.
 *
 * It shows the breadcrumb rather than just the filename because the breadcrumb is what
 * distinguishes near-identical documents in this corpus — `Delivery Report: Merge Marina,
 * 2025-12` against six other Merge Marina reports (docs/CORPUS.md §3.2). The per-arm
 * ranks are shown for the same reason they are on the DTO: "the keyword arm found this
 * and the vector arm did not" is the single most useful thing to see when a result looks
 * wrong.
 */
interface SourceCardProps {
  passage: Passage;
  index: number;
  /** True when a citation chip pointing here was clicked. */
  highlighted: boolean;
  /** True when the answer actually cited this passage, as opposed to merely retrieving it. */
  cited: boolean;
}

const COLLAPSED_LENGTH = 260;

export function SourceCard({ passage, index, highlighted, cited }: SourceCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = passage.content.length > COLLAPSED_LENGTH;
  const shown =
    expanded || !isLong ? passage.content : `${passage.content.slice(0, COLLAPSED_LENGTH)}…`;

  return (
    <li
      id={`source-${index}`}
      // `scroll-mt` clears the sticky header when a citation chip scrolls this into view.
      className={cn(
        "scroll-mt-20 rounded-lg border p-3 transition-colors",
        highlighted ? "border-accent bg-accent-soft" : "border-border bg-surface",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-medium tabular-nums",
            cited ? "bg-accent text-on-accent" : "bg-surface-raised text-muted",
          )}
        >
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
          {passage.documentTitle}
        </span>
        {passage.docType !== null ? <Badge>{passage.docType}</Badge> : null}
      </div>

      <p className="mt-1.5 break-words font-mono text-[11px] text-faint">{passage.breadcrumb}</p>

      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted">{shown}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
        <span title="Reciprocal Rank Fusion score — orders results within one query only">
          score {passage.score.toFixed(4)}
        </span>
        <span title="Rank in the vector arm, then the keyword arm. — means that arm did not return it">
          v{passage.vectorRank ?? "—"} · k{passage.keywordRank ?? "—"}
        </span>
        <span className="truncate">{passage.sourcePath}</span>
        {isLong ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="ml-auto text-accent hover:underline"
          >
            {expanded ? "Show less" : "Show full passage"}
          </button>
        ) : null}
      </div>
    </li>
  );
}
