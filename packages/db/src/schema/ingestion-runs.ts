import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ingestionRunStatus, ingestionTrigger } from "./enums";

/**
 * One row per ingestion invocation. The dashboard reads this table directly — there is no
 * separate metrics system (CLAUDE.md §6).
 */
export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** The directory that was walked. Recorded because it is configurable per run. */
    corpusDir: text("corpus_dir").notNull(),

    trigger: ingestionTrigger("trigger").notNull(),
    status: ingestionRunStatus("status").notNull().default("RUNNING"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),

    /** Null while the run is in flight; the dashboard uses this to show live status. */
    finishedAt: timestamp("finished_at", { withTimezone: true }),

    // Counts, not a jsonb blob, so the dashboard can aggregate them in SQL.
    documentsAdded: integer("documents_added").notNull().default(0),
    documentsUpdated: integer("documents_updated").notNull().default(0),
    documentsRemoved: integer("documents_removed").notNull().default(0),
    documentsFailed: integer("documents_failed").notNull().default(0),

    /** Skipped because the content hash was unchanged — the point of incremental runs. */
    documentsUnchanged: integer("documents_unchanged").notNull().default(0),

    chunksWritten: integer("chunks_written").notNull().default(0),

    /** Set only when the run itself failed, as opposed to individual documents failing. */
    errorMessage: text("error_message"),
  },
  (table) => [
    // "Most recent runs first" is the only way this table is ever listed.
    index("ingestion_runs_started_at_idx").on(table.startedAt.desc()),
  ],
);
