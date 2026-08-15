import { type Citation } from "@corpus-lens/shared/answer";
import { type Passage } from "@corpus-lens/shared/search";

/**
 * Server-side validation of the `[n]` markers the model wrote.
 *
 * CLAUDE.md §6: "Never let a citation point at a document that was not in the retrieved
 * set. Validate the returned markers against the context server-side and drop unknown
 * ones." That is not defensive coding for its own sake — a citation is the user's means
 * of verifying a claim, so a marker resolving to the wrong document, or to nothing, is
 * worse than no citation at all. It converts an unverifiable claim into a claim that
 * *looks* verified.
 *
 * The prompt asks the model not to invent numbers. This assumes it will anyway.
 */

/** `[1]`, `[12]`. Adjacent markers like `[1][2]` match separately, which is intended. */
const MARKER_PATTERN = /\[(\d{1,3})\]/g;

export interface CitationValidation {
  /** Resolved markers, in first-appearance order, deduplicated. */
  citations: Citation[];
  /** Markers the model wrote that matched no supplied source. Kept for observability. */
  droppedMarkers: number[];
  /** The answer text with unresolvable markers removed. */
  text: string;
}

export function validateCitations(text: string, passages: Passage[]): CitationValidation {
  const citations: Citation[] = [];
  const seen = new Set<number>();
  const dropped = new Set<number>();

  for (const match of text.matchAll(MARKER_PATTERN)) {
    const raw = match[1];
    if (raw === undefined) continue;

    const marker = Number.parseInt(raw, 10);
    // Markers are 1-based in the prompt, so source i is at index i - 1.
    const passage = passages[marker - 1];

    if (passage === undefined) {
      dropped.add(marker);
      continue;
    }
    if (seen.has(marker)) continue;

    seen.add(marker);
    citations.push({
      marker,
      sourceIndex: marker - 1,
      chunkId: passage.chunkId,
      documentId: passage.documentId,
      documentTitle: passage.documentTitle,
      sourcePath: passage.sourcePath,
      breadcrumb: passage.breadcrumb,
    });
  }

  return {
    citations,
    droppedMarkers: [...dropped].sort((a, b) => a - b),
    text: dropped.size === 0 ? text : stripMarkers(text, dropped),
  };
}

/**
 * Removes dropped markers from the prose.
 *
 * Leaving them in would show the user a `[7]` with nothing behind it — a dead reference
 * reads as a broken product, and worse, it still lends the sentence an air of having been
 * sourced. Surrounding whitespace is tidied so removing a marker does not leave a gap
 * before the full stop.
 */
function stripMarkers(text: string, dropped: Set<number>): string {
  return text
    .replace(MARKER_PATTERN, (marker, digits: string) =>
      dropped.has(Number.parseInt(digits, 10)) ? "" : marker,
    )
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trimEnd();
}
