/**
 * How a query is split into searchable terms.
 *
 * This lives in the contract package rather than beside the SQL because three places have
 * to agree on it and a disagreement between any two is a silent bug:
 *
 * - the **keyword arm** searches for these terms (`packages/rag/src/keyword-query.ts`),
 * - the **vector-arm rewrite** asks the database how common each of them is
 *   (`packages/rag/src/query-rewrite.ts`) — a different split there would drop a term the
 *   keyword arm never had,
 * - the **UI** highlights them inside a retrieved passage
 *   (`apps/web/src/components/ui/highlight-terms.tsx`) — a different split there would
 *   explain the result incorrectly, and confidently.
 *
 * It is also the reason this is in `shared` specifically: the third consumer is a browser
 * bundle, and `packages/shared` is the only package built for both CommonJS and ESM.
 */

/**
 * `or`, `and` and `not` are Postgres websearch operators. A user typing them as ordinary
 * words would otherwise produce a dangling operator — harmless, since websearch never
 * throws, but it silently changes the query's meaning.
 */
const OPERATOR_WORDS = new Set(["or", "and", "not"]);

/** The query's searchable terms, lower-cased, in the order they were written. */
export function splitQueryTerms(query: string): string[] {
  return (
    query
      .toLowerCase()
      // Split on anything that is not a letter, digit, or an intra-word `.`, `_` or `-`, so
      // "low-contrast", "lumen.track" and "4.5" survive as single searchable terms.
      .split(/[^\p{L}\p{N}._-]+/u)
      .map((term) => term.replace(/^[-._]+|[-._]+$/g, ""))
      .filter((term) => term.length > 0 && !OPERATOR_WORDS.has(term))
  );
}
