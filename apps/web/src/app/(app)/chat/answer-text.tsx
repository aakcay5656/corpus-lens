"use client";

import { Fragment, type ReactNode } from "react";
import { type Citation } from "@corpus-lens/shared/answer";

/**
 * Renders the answer with its `[n]` markers turned into interactive chips.
 *
 * The important detail is how a marker is resolved. Markers are **not contiguous**: the
 * server drops any that point at a source the model was not given, and the model cites
 * only the sources it used — a real answer in Step 7 cited `[1][2][6]`. So a marker is
 * matched against `citation.marker` and the chip navigates to `citation.sourceIndex`.
 * Treating the nth citation as the nth source would scroll to the wrong passage, which is
 * worse than not linking at all: the citation exists so a claim can be checked, and one
 * that points at the wrong place quietly breaks that.
 */
const MARKER_PATTERN = /\[(\d{1,3})\]/g;

interface AnswerTextProps {
  text: string;
  citations: Citation[];
  onCitationClick: (sourceIndex: number) => void;
  activeSourceIndex: number | null;
}

export function AnswerText({
  text,
  citations,
  onCitationClick,
  activeSourceIndex,
}: AnswerTextProps) {
  const byMarker = new Map(citations.map((citation) => [citation.marker, citation]));

  return (
    <div className="text-sm leading-relaxed text-ink">
      {text.split("\n\n").map((paragraph, paragraphIndex) => (
        <p key={paragraphIndex} className="mb-3 last:mb-0 whitespace-pre-wrap">
          {renderWithCitations(paragraph, byMarker, onCitationClick, activeSourceIndex)}
        </p>
      ))}
    </div>
  );
}

function renderWithCitations(
  paragraph: string,
  byMarker: Map<number, Citation>,
  onCitationClick: (sourceIndex: number) => void,
  activeSourceIndex: number | null,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of paragraph.matchAll(MARKER_PATTERN)) {
    const start = match.index;
    const marker = Number.parseInt(match[1] ?? "", 10);
    const citation = byMarker.get(marker);

    if (start > lastIndex) nodes.push(paragraph.slice(lastIndex, start));
    lastIndex = start + match[0].length;

    if (citation === undefined) {
      // A marker with no citation behind it. The server strips these before the text is
      // sent, so reaching here means the contract was broken somewhere — render the
      // literal text rather than a chip that goes nowhere.
      nodes.push(match[0]);
      continue;
    }

    nodes.push(
      <CitationChip
        key={`${start}-${marker}`}
        citation={citation}
        active={activeSourceIndex === citation.sourceIndex}
        onClick={() => onCitationClick(citation.sourceIndex)}
      />,
    );
  }

  if (lastIndex < paragraph.length) nodes.push(paragraph.slice(lastIndex));

  return nodes.map((node, index) => <Fragment key={index}>{node}</Fragment>);
}

function CitationChip({
  citation,
  active,
  onClick,
}: {
  citation: Citation;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // The accessible name says which document it points at, because "[2]" read aloud
      // tells a screen-reader user nothing about what they are being offered.
      aria-label={`Source ${citation.marker}: ${citation.documentTitle}`}
      title={citation.sourcePath}
      className={[
        "mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded px-1",
        "align-baseline text-[11px] font-medium tabular-nums transition-colors",
        active
          ? "bg-accent text-on-accent"
          : "bg-accent-soft text-accent hover:bg-accent hover:text-on-accent",
      ].join(" ")}
    >
      {citation.marker}
    </button>
  );
}
