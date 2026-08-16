import { splitQueryTerms } from "@corpus-lens/shared/query-terms";

/**
 * Rewrites a natural-language question into an OR keyword query.
 *
 * **This is the single most consequential line in the keyword arm, and getting it wrong
 * made hybrid retrieval quietly behave as vector-only.** Every Postgres text-search
 * constructor — `websearch_to_tsquery`, `plainto_tsquery`, `phraseto_tsquery` — joins the
 * terms it finds with AND. Passing a question straight through therefore demands that
 * *every* term appear in one chunk:
 *
 *     websearch_to_tsquery('english', 'How many vacation days do Lumen employees get?')
 *       → 'mani' & 'vacat' & 'day' & 'lumen' & 'employe' & 'get'
 *
 * Against 200-token chunks that matches nothing, which is exactly what happened: the
 * keyword arm returned zero rows for most of the evaluation set and RRF spent its time
 * fusing one list with an empty one.
 *
 * OR is the right semantics here, because recall is the keyword arm's job and precision is
 * `ts_rank`'s: ts_rank weights by how many distinct query lexemes a chunk covers and how
 * densely, so a chunk matching "applovin" *and* "size" still outranks one matching only
 * "size". AND behaviour is not lost — it is demoted from a hard filter to a ranking signal.
 *
 * This lives in the retrieval package rather than beside the SQL because it is a retrieval
 * *policy* decision (recall over precision), not a storage detail. The output happens to
 * be Postgres websearch syntax, which is the one thing the repository adds.
 *
 * The tokenizer itself moved to `packages/shared` once three consumers needed it — see
 * `query-terms.ts` for why a second splitter anywhere would be a silent bug.
 *
 * Terms are joined with the literal word `or`, which `websearch_to_tsquery` reads as its
 * OR operator. Going through that function rather than assembling a `to_tsquery` string is
 * deliberate: it is the only constructor that cannot be made to raise on hostile input, so
 * there is no query-injection surface even though the terms come from a user.
 */
export function toKeywordQuery(query: string): string {
  return splitQueryTerms(query).join(" or ");
}
