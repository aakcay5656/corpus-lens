import { type Database } from "@corpus-lens/db/client";
import { chunks } from "@corpus-lens/db/schema/chunks";
import { documents } from "@corpus-lens/db/schema/documents";
import { toKeywordQuery } from "@corpus-lens/rag/keyword-query";
import {
  type RetrievalFilters,
  type RetrievalRepository,
  type RetrievedChunk,
} from "@corpus-lens/rag/retriever";
import { and, cosineDistance, desc, eq, gt, isNotNull, sql, type SQL } from "drizzle-orm";

/**
 * The two SQL queries behind hybrid retrieval, and the only part of it that needs a
 * database. Everything above this — candidate budgets, fusion, ordering — lives in
 * `packages/rag` and is tested without Postgres.
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
