import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { documents } from "./documents";

/**
 * Drizzle has no built-in tsvector type. The column is generated and never written from
 * application code, so `data: string` is only there to satisfy the type parameter.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

/** Embedding width of OpenAI text-embedding-3-small. Changing the model needs a migration. */
export const EMBEDDING_DIMENSIONS = 1536;

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),

    /** Position within the document, so retrieved fragments can be shown in order. */
    ordinal: integer("ordinal").notNull(),

    /**
     * "Delivery Report: Merge Marina, 2025-12 [delivery-report · 2025-12 · merge-marina]
     *  > QA findings and fixes"
     *
     * Stored separately from the content because it is prepended to the embedded text but
     * is not part of the document body. In this corpus 78 delivery reports are built from
     * 15 distinct sentences, so the breadcrumb is what makes them distinguishable at all
     * (docs/CORPUS.md §3.2).
     */
    breadcrumb: text("breadcrumb").notNull(),

    content: text("content").notNull(),

    tokenCount: integer("token_count").notNull(),

    /** Null between the chunk being written and the embedding call returning. */
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),

    /**
     * The keyword half of hybrid retrieval, maintained by Postgres rather than by the
     * application so it can never drift from the content.
     *
     * The 'english' argument is required, not cosmetic: the two-argument to_tsvector is
     * IMMUTABLE and so may be used in a generated column, while the one-argument form
     * depends on a session setting and Postgres rejects it here.
     */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(breadcrumb, '') || ' ' || coalesce(content, ''))`,
    ),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Re-ingesting a document replaces its chunks; the pair must stay unique.
    uniqueIndex("chunks_document_ordinal_unique").on(table.documentId, table.ordinal),

    // Fetching or deleting every chunk of one document is the hottest access pattern.
    index("chunks_document_id_idx").on(table.documentId),

    // Vector half of hybrid retrieval. Cosine, because embeddings are compared by angle
    // and text-embedding-3-small returns normalised vectors.
    //
    // HNSW rather than IVFFlat: it needs no training pass and stays correct as rows are
    // added one ingestion at a time. Defaults (m=16, ef_construction=64) are kept — with
    // 142 chunks the index barely matters for latency, and tuning numbers we cannot
    // measure at this scale would be theatre.
    index("chunks_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),

    // Keyword half. GIN is the standard index for tsvector containment queries.
    index("chunks_search_vector_gin_idx").using("gin", table.searchVector),
  ],
);
