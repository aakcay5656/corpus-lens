import { toKeywordQuery } from "@corpus-lens/rag/keyword-query";
import { type TermDocumentCounts } from "@corpus-lens/rag/query-rewrite";
import {
  type RetrievalFilters,
  type RetrievalRepository,
  type RetrievedChunk,
} from "@corpus-lens/rag/retriever";
import { and, cosineDistance, desc, eq, gt, isNotNull, sql, type SQL } from "drizzle-orm";

import { type Database } from "./client";
import { chunks } from "./schema/chunks";
import { documents } from "./schema/documents";

/**
 * The two SQL queries behind hybrid retrieval — the adapter for the port `packages/rag`
 * defines.
 *
 * It lives in `packages/db` rather than in an app because **both** `apps/api` and
 * `apps/mcp` construct it. That is the concrete payoff of the monorepo layout claimed in
 * CLAUDE.md §4: the MCP tool is not a reimplementation of search, it is the same
 * `retrieve()` over the same SQL, differing only in transport.
 *
 * The dependency direction is the ports-and-adapters one: the interface belongs to the
 * domain package (`rag`), the implementation to the infrastructure package (`db`), and
 * the adapter depends on the port. `rag` still imports nothing from `db`, so retrieval
 * remains testable with no database at all.
 */
export function createDrizzleRetrievalRepository(db: Database): RetrievalRepository {
  return {
    /**
     * Vector arm. Cosine distance against the HNSW index.
     *
     * `1 - distance` is reported as the raw score purely so the number reads the way a
     * human expects (higher is better); fusion never looks at it.
     */
    async searchByVector(
      embedding: number[],
      limit: number,
      filters: RetrievalFilters,
    ): Promise<RetrievedChunk[]> {
      const distance = cosineDistance(chunks.embedding, embedding);

      const rows = await db
        .select({ ...selection, rawScore: sql<number>`1 - (${distance})` })
        .from(chunks)
        .innerJoin(documents, eq(chunks.documentId, documents.id))
        // A chunk whose embedding is null was never embedded; including it would let
        // Postgres sort nulls into the result set as though they were near matches.
        .where(and(isNotNull(chunks.embedding), docTypeFilter(filters)))
        // Ordering by the distance expression, not by `1 - distance`, is what lets the
        // planner use the HNSW index — the index is built on the `<=>` operator, and
        // wrapping it in arithmetic would force a sequential scan.
        .orderBy(distance)
        .limit(limit);

      return rows;
    },

    /**
     * Keyword arm. `ts_rank` over the generated tsvector, GIN indexed.
     *
     * `websearch_to_tsquery` rather than `to_tsquery`: it accepts raw user input without
     * throwing on stray punctuation or an unbalanced quote, where `to_tsquery` raises a
     * syntax error — which would turn a malformed search into a 500.
     *
     * The query is rewritten to OR before it gets there; see `toKeywordQuery`.
     */
    async searchByKeyword(
      query: string,
      limit: number,
      filters: RetrievalFilters,
    ): Promise<RetrievedChunk[]> {
      const tsquery = sql`websearch_to_tsquery('english', ${toKeywordQuery(query)})`;
      const rank = sql<number>`ts_rank(${chunks.searchVector}, ${tsquery})`;

      const rows = await db
        .select({ ...selection, rawScore: rank })
        .from(chunks)
        .innerJoin(documents, eq(chunks.documentId, documents.id))
        .where(
          and(
            sql`${chunks.searchVector} @@ ${tsquery}`,
            // A rank of exactly zero means the match came only from a stop word position;
            // it is noise that would still occupy a fused slot.
            gt(rank, 0),
            docTypeFilter(filters),
          ),
        )
        .orderBy(desc(rank))
        .limit(limit);

      return rows;
    },

    /**
     * Document frequency for the query's own terms, in one round trip.
     *
     * `unnest` turns the term array into rows so a single statement answers for all of
     * them; the alternative is one query per term, which is the same work split into N
     * network round trips. The terms are bound as a parameter array, never interpolated.
     *
     * `plainto_tsquery` rather than the raw string, so a term is matched by its **stem** —
     * "reports" and "report" are one lexeme in the index, and counting the literal word
     * would report a frequency far below the truth.
     *
     * Stop words are dropped before the join and are simply absent from the result. The
     * caller treats a missing term as "not common", which is the right outcome: a stop word
     * is already ignored by both arms, so removing it from the embedded text would change
     * the sentence for no retrieval gain.
     */
    async countTermDocuments(terms: string[]): Promise<TermDocumentCounts> {
      const [totals] = await db.select({ total: sql<number>`count(*)::int` }).from(documents);
      const totalDocuments = totals?.total ?? 0;

      if (terms.length === 0 || totalDocuments === 0) {
        return { totalDocuments, byTerm: new Map() };
      }

      const rows = await db.execute<{ term: string; ndoc: number }>(sql`
        with candidate as materialized (
          -- sql.param, not the array directly: Drizzle expands a bare JS array into one
          -- placeholder per element, producing a row constructor cast to an array, which
          -- Postgres rejects. This binds the whole array as a single parameter.
          select t.term as term
          from unnest(${sql.param(terms)}::text[]) as t(term)
          -- Stop words are removed here, and MATERIALIZED is what makes that work: without
          -- it the planner is free to inline this into the join below, where
          -- plainto_tsquery would still be called on every stop word and emit a NOTICE per
          -- term — ten lines of console noise for an ordinary question. Dropping them is
          -- also correct on its own terms: a stop word is in the index nowhere and is no
          -- more a discriminator than a term in every document.
          where to_tsvector('english', t.term) <> ''::tsvector
        )
        select c2.term as term, count(distinct c.document_id)::int as ndoc
        from candidate c2
        left join chunks c
          on c.search_vector @@ plainto_tsquery('english', c2.term)
        group by c2.term
      `);

      const byTerm = new Map<string, number>();
      for (const row of rows) byTerm.set(row.term, Number(row.ndoc));

      return { totalDocuments, byTerm };
    },
  };
}

/** Both arms return identical columns, so the projection is written once. */
const selection = {
  chunkId: chunks.id,
  documentId: chunks.documentId,
  documentTitle: documents.title,
  sourcePath: documents.sourcePath,
  docType: documents.docType,
  breadcrumb: chunks.breadcrumb,
  content: chunks.content,
  ordinal: chunks.ordinal,
};

/**
 * The lever recorded in docs/CORPUS.md §5: if the 78 near-duplicate delivery reports
 * crowd out the root reference documents, the answer is a filter or a type prior — not a
 * change to chunk size. Applied inside both arms rather than after fusion, so a filtered
 * search still gets a full candidate budget of relevant rows.
 */
function docTypeFilter(filters: RetrievalFilters): SQL | undefined {
  return filters.docType === undefined ? undefined : eq(documents.docType, filters.docType);
}
