import { type SourceMetadata } from "./source-metadata";

/**
 * The breadcrumb prefix that is embedded together with every chunk's text.
 *
 * A chunk that reads "it must be rotated every 90 days" is unretrievable and
 * uninterpretable on its own. Prefixed with
 * `Lumen SDK v3 (current) [reference] > Credentials` it is both. This is CLAUDE.md §6's
 * rule, extended per docs/CORPUS.md §3.2 to carry `docType · date · subject` as well,
 * because on this corpus the headings are identical across 78 documents and the
 * filename metadata is the only thing that separates them.
 *
 * Format:
 *   `<title> [<docType> · <date> · <subject>] > <section> > <subsection>`
 *
 * Absent parts are omitted rather than rendered as "null", so a corpus with no folder
 * convention degrades to a plain `Title > Section` breadcrumb instead of embedding noise.
 */
export function buildBreadcrumb(
  title: string,
  metadata: SourceMetadata,
  headingPath: string[],
): string {
  const tags = [metadata.docType, metadata.date, metadata.subject].filter(
    (tag): tag is string => tag !== null && tag.length > 0,
  );

  const head = tags.length > 0 ? `${title} [${tags.join(" · ")}]` : title;
  return [head, ...headingPath].join(" > ");
}

/**
 * The exact string handed to the embedding model and stored for full-text search.
 *
 * Both retrieval arms see the breadcrumb: the vector arm gets it as embedded context,
 * and the generated tsvector column in packages/db concatenates breadcrumb and content
 * for the keyword arm. That symmetry is what makes a query naming a game and a month
 * findable by either route.
 */
export function buildEmbeddedText(breadcrumb: string, content: string): string {
  return `${breadcrumb}\n\n${content}`;
}
