import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Enums are used only for values this system defines and controls.
 *
 * Corpus-derived values (document type, lifecycle) are deliberately plain text columns
 * instead: they come from the folder names of whatever directory ingestion is pointed
 * at, and an enum would make "point it at another corpus" a migration rather than an
 * env change (CLAUDE.md §5).
 */

export const userRole = pgEnum("user_role", ["USER", "ADMIN"]);

/** Where a document stands in the ingestion lifecycle. */
export const documentStatus = pgEnum("document_status", ["PENDING", "INDEXED", "FAILED"]);

export const ingestionRunStatus = pgEnum("ingestion_run_status", [
  "RUNNING",
  "COMPLETED",
  "FAILED",
]);

/** How a run was started. Recorded so the dashboard can tell a manual run from a watcher. */
export const ingestionTrigger = pgEnum("ingestion_trigger", ["CLI", "API", "WATCH", "SCHEDULE"]);

/** Which stage of the pipeline an event came from. */
export const ingestionPhase = pgEnum("ingestion_phase", [
  "DISCOVER",
  "PARSE",
  "CHUNK",
  "EMBED",
  "PERSIST",
]);

export const ingestionLevel = pgEnum("ingestion_level", ["INFO", "WARN", "ERROR"]);
