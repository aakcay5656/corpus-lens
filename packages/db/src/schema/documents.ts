import { date, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { documentStatus } from "./enums";

/**
 * One row per source file.
 *
 * The metadata columns come from the Step 0 corpus analysis (docs/CORPUS.md §4). The
 * provided corpus has no front-matter, so everything below is derived from the path and
 * the first lines of the file. All of it is nullable: a corpus without these patterns
 * simply gets nulls and falls back to title-only breadcrumbs.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Path relative to the ingestion root. The natural key, so it carries the unique index. */
    sourcePath: text("source_path").notNull().unique(),

    /** The single `#` heading, falling back to the filename. */
    title: text("title").notNull(),

    /**
     * SHA-256 of the raw file bytes. This is what makes re-ingestion idempotent: an
     * unchanged hash means the document is skipped without re-embedding it (Step 5).
     */
    contentHash: text("content_hash").notNull(),

    /** Parent folder: delivery-report, meeting-note, guide, ... "reference" at the root. */
    docType: text("doc_type"),

    /** Leading YYYY-MM(-DD) in the filename. Present in 108 of 142 files in the sample corpus. */
    docDate: date("doc_date"),

    /** Filename remainder: bubble-bakery, production-sync. Distinguishes near-duplicate reports. */
    subject: text("subject"),

    /** lumen-build 4.2 → "4.2", sdk-notes-v3 → "3". Orders superseded documents. */
    version: text("version"),

    /**
     * "current" | "deprecated", read from the opening lines. Feeds the prompt rule that
     * makes the answer prefer the current document and name the supersession
     * (docs/CORPUS.md §3.3).
     */
    lifecycle: text("lifecycle"),

    /** Anything else a future corpus carries, e.g. YAML front-matter this one does not have. */
    metadata: jsonb("metadata").notNull().default({}),

    status: documentStatus("status").notNull().default("PENDING"),

    /** Populated when status is FAILED, so a bad document is visible instead of silent. */
    errorMessage: text("error_message"),

    tokenCount: integer("token_count"),

    /** Last successful index. Null until the first successful run. */
    indexedAt: timestamp("indexed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The dashboard lists documents filtered by status and grouped by type.
    index("documents_status_idx").on(table.status),
    index("documents_doc_type_idx").on(table.docType),
  ],
);
