import { Fragment, type ReactNode } from "react";
import { splitQueryTerms } from "@corpus-lens/shared/query-terms";

/**
 * Marks the query's own terms inside a retrieved passage.
 *
 * The purpose is answering "why did this come back?" without opening the dashboard. A
 * passage from hybrid retrieval can arrive because the *vector* arm liked it, in which case
 * nothing is highlighted — and that absence is informative rather than a bug: it is the
 * visible difference between a lexical match and a semantic one.
 *
 * **Terms come from `splitQueryTerms`**, the same function the keyword arm tokenises with
 * (`packages/rag/src/keyword-query.ts`). Writing a second splitter here would highlight
 * words the search never looked for, which is worse than highlighting nothing: it would
 * explain the result incorrectly and confidently.
 *
 * **No `dangerouslySetInnerHTML`.** The passage is corpus text and the terms are user input;
 * building a string of `<mark>` tags and injecting it is the standard way this feature
 * becomes an XSS hole. React nodes are returned instead, so the text is escaped by the
 * renderer and the markup is ours by construction.
 */
interface HighlightTermsProps {
  text: string;
  /** The question as asked. Tokenised here so callers pass the raw query, not a term list. */
  query: string;
}

/**
 * Terms shorter than this are not highlighted at all, and the reason is not aesthetics.
 *
 * Postgres discards stop words before searching, so "how", "the", "do" and "is" are not
 * things the keyword arm matched on — highlighting them would claim a match that never
 * happened, and in a question like "How do I initialize the current Lumen SDK?" it would
 * light up most of the paragraph. The alternative is copying an English stop-word list into
 * the browser bundle, which is the same duplication mistake `query-terms.ts` exists to
 * prevent: two lists, drifting, with no test that can tell.
 *
 * A length cutoff is a coarser rule than a real stop-word list and it is *wrong* in one
 * visible way: a three-letter acronym like "CTA" or "SDK" is a genuine match and is left
 * unmarked. That is the accepted cost — a missing highlight understates, a false one lies.
 */
const MIN_TERM_LENGTH = 4;

/**
 * The regular English inflections, so a term matches the form it appears in. Not a stemmer
 * and not trying to be one: it exists to close the gap between "report" in the question and
 * "reports" in the passage, which is the common case, and it stops well short of the
 * irregular forms a real stemmer handles.
 */
const INFLECTIONS = "(?:s|es|ed|d|ing|ly)?";

export function HighlightTerms({ text, query }: HighlightTermsProps): ReactNode {
  const terms = splitQueryTerms(query).filter((term) => term.length >= MIN_TERM_LENGTH);
  if (terms.length === 0) return text;

  const pattern = buildPattern(terms);
  if (pattern === null) return text;

  // `split` with a capturing group keeps the delimiters, so the odd indices are the matches.
  const pieces = text.split(pattern);

  return pieces.map((piece, index) =>
    index % 2 === 1 ? (
      <mark
        key={`${index}-${piece}`}
        className="rounded-[3px] bg-accent-soft px-0.5 text-ink"
        // Explicit, because a <mark> that only differs by background is invisible to a
        // screen reader and to anyone reading in forced-colours mode.
        aria-label={`matched term ${piece}`}
      >
        {piece}
      </mark>
    ) : (
      <Fragment key={`${index}-${piece.length}`}>{piece}</Fragment>
    ),
  );
}

/**
 * One alternation over all terms, so the text is scanned once and overlapping terms cannot
 * produce nested marks. Longest first: without it, "sdk" would match inside a query that
 * also contains "sdk-notes" and the longer term would never win.
 */
function buildPattern(terms: string[]): RegExp | null {
  const escaped = [...new Set(terms)]
    .sort((a, b) => b.length - a.length)
    .map((term) => {
      // The hyphen is deliberately absent from this set. It is only special inside a
      // character class, and under the `u` flag `\-` is an *invalid escape* rather than a
      // harmless one — so escaping it throws when the pattern is constructed. Every query
      // containing a hyphenated term ("low-contrast", the corpus's own vocabulary) would
      // have crashed the panel at render time.
      const literal = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Followed by an optional inflection, because Postgres searches stems: a query for
      // "report" matches a passage saying "reports", and an exact highlighter would mark
      // nothing in the very passage the term retrieved.
      //
      // A bare `\p{L}*` was tried first and over-matches — it marks "ruler" for the term
      // "rule", claiming a match the index would never have made. Under-marking is the
      // acceptable failure here and over-marking is not, so the suffix set is closed.
      return `${literal}${INFLECTIONS}`;
    });

  if (escaped.length === 0) return null;

  // Word boundaries on both sides, expressed without `\b` because the terms may contain
  // `.`, `_` or `-` — `lumen.track` would otherwise break at the dot.
  return new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join("|")})(?![\\p{L}\\p{N}])`, "giu");
}
