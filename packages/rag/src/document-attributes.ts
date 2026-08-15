/**
 * Document attributes read from the body and the filename, for the columns the breadcrumb
 * does not need.
 *
 * Kept separate from `source-metadata.ts` on purpose: that module answers "what does the
 * breadcrumb need", this one answers "what do the `documents` columns need". The two have
 * different consumers and different failure modes — a wrong breadcrumb hurts retrieval,
 * a wrong lifecycle hurts the answer.
 *
 * Both fields feed docs/CORPUS.md §3.3: the corpus deliberately contains a deprecated
 * document (`sdk-notes-v2.md`) alongside its replacement, and the shipped question set
 * grades whether the answer says so. Storing the supersession as data rather than hoping
 * the model notices it in the prose is what makes that a prompt rule Step 7 can rely on.
 */

export interface DocumentAttributes {
  /** "4.2" from lumen-build-4.2, "3" from sdk-notes-v3. Null when the name carries none. */
  version: string | null;
  /** "deprecated" | "current", or null when the document says nothing either way. */
  lifecycle: string | null;
}

/** `lumen-build-4.2` → 4.2. A dotted number at the end of the name. */
const DOTTED_VERSION = /-(\d+(?:\.\d+)+)$/;

/** `sdk-notes-v3` → 3. A `v` followed by digits at the end of the name. */
const V_VERSION = /-v(\d+)$/i;

/**
 * Only the opening lines are examined. A document that mentions "deprecated" halfway down
 * is discussing something else; a document that *is* deprecated says so at the top, which
 * is the convention this corpus follows (`Status: deprecated since January 2026`).
 */
const LIFECYCLE_SCAN_LINES = 3;

export function deriveDocumentAttributes(subject: string, body: string): DocumentAttributes {
  return { version: deriveVersion(subject), lifecycle: deriveLifecycle(body) };
}

function deriveVersion(subject: string): string | null {
  return DOTTED_VERSION.exec(subject)?.[1] ?? V_VERSION.exec(subject)?.[1] ?? null;
}

function deriveLifecycle(body: string): string | null {
  const opening = body
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, LIFECYCLE_SCAN_LINES)
    .join(" ")
    .toLowerCase();

  if (opening.includes("deprecated") || opening.includes("superseded")) return "deprecated";
  if (opening.includes("current")) return "current";
  return null;
}
