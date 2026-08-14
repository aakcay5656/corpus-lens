import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { documents } from "./documents";
import { ingestionLevel, ingestionPhase } from "./enums";
import { ingestionRuns } from "./ingestion-runs";

/**
 * Per-document log lines for a run. This is what makes a failed ingestion diagnosable
 * from the dashboard instead of from a scrollback buffer: one document failing is
 * recorded here and the run carries on (CLAUDE.md §7).
 */
export const ingestionEvents = pgTable(
  "ingestion_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    runId: uuid("run_id")
      .notNull()
      .references(() => ingestionRuns.id, { onDelete: "cascade" }),

    /** Null for run-level events, and set null if the document is later removed. */
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),

    /**
     * Kept alongside documentId on purpose. A document that failed to parse never got a
     * row in `documents`, and a removed document loses its id — but the path is what a
     * human needs to know which file to look at.
     */
    sourcePath: text("source_path"),

    phase: ingestionPhase("phase").notNull(),
    level: ingestionLevel("level").notNull().default("INFO"),

    message: text("message").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The run detail view reads one run's events in order.
    index("ingestion_events_run_id_created_at_idx").on(table.runId, table.createdAt),

    // "Show me what failed" across all runs.
    index("ingestion_events_level_idx").on(table.level),
  ],
);
