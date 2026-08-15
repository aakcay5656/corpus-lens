/**
 * Metadata recovered from a document's path.
 *
 * Why this exists at all: docs/CORPUS.md §3.2 measured 546 bullet lines across the 78
 * delivery reports and found only **15 distinct** ones. Those documents are near-identical
 * as prose, so their embeddings are near-identical too and cosine ranking between them is
 * noise. What actually distinguishes `2025-05-bubble-bakery.md` from
 * `2025-12-merge-marina.md` is the date and the game — and both live in the filename, not
 * in the body.
 *
 * So the filename is treated as data. It goes into the breadcrumb, which goes into the
 * embedded text, which is what makes "Bubble Bakery December delivery" resolvable.
 *
 * Nothing here is specific to this corpus: the patterns are conventions (folder = kind,
 * leading date = date, remainder = subject), and a corpus that does not follow them gets
 * nulls and falls back to a title-only breadcrumb. Pointing ingestion at another folder
 * stays a one-line change (CLAUDE.md §5).
 */

export interface SourceMetadata {
  /** Kind of document, from the containing folder. Null for files at the corpus root. */
  docType: string | null;
  /** ISO date or year-month found at the start of the filename. */
  date: string | null;
  /** Filename remainder after the date — the game or topic key. Never null. */
  subject: string;
}

/** `2026-03-30-` or `2026-03-` at the start of a filename. */
const LEADING_DATE_PATTERN = /^(\d{4}-\d{2}(?:-\d{2})?)(?:[-_]|$)/;

/**
 * @param relativePath Path relative to the corpus root, POSIX separators,
 *   e.g. `delivery-reports/2025-05-bubble-bakery.md`.
 */
export function deriveSourceMetadata(relativePath: string): SourceMetadata {
  const segments = relativePath.split("/").filter((segment) => segment.length > 0);
  const filename = segments.at(-1) ?? "";
  const folder = segments.length >= 2 ? (segments.at(-2) ?? null) : null;

  const basename = filename.replace(/\.[^.]+$/, "");
  const dateMatch = LEADING_DATE_PATTERN.exec(basename);
  const date = dateMatch?.[1] ?? null;

  const subject = date === null ? basename : basename.slice(date.length).replace(/^[-_]/, "");

  return {
    docType: folder === null ? null : singularise(folder),
    date,
    // A file that is nothing but a date keeps the date as its subject rather than
    // becoming an empty string, which would read as missing data downstream.
    subject: subject.length > 0 ? subject : basename,
  };
}

/**
 * Folder names are plural by convention (`delivery-reports`), the type of a single
 * document is singular. Naive on purpose — dropping a trailing "s" is right for every
 * folder any corpus is likely to use, and an irregular-plural table would be a lot of
 * code defending against a problem nobody has.
 */
function singularise(folder: string): string {
  return folder.endsWith("s") ? folder.slice(0, -1) : folder;
}
