import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const ingestionRunStatusSchema = z.enum(["RUNNING", "COMPLETED", "FAILED"]);
export const ingestionTriggerSchema = z.enum(["CLI", "API", "WATCH", "SCHEDULE"]);
export const ingestionPhaseSchema = z.enum(["DISCOVER", "PARSE", "CHUNK", "EMBED", "PERSIST"]);
export const ingestionLevelSchema = z.enum(["INFO", "WARN", "ERROR"]);

/**
 * Body of the admin-only POST /ingest.
 *
 * `corpusDir` is intentionally NOT accepted from the client. It would let an
 * authenticated admin walk any directory the API process can read, which is a path
 * traversal and information disclosure hole dressed up as a feature. The directory comes
 * from CORPUS_DIR in the server environment (CLAUDE.md §5).
 */
export const ingestRequestSchema = z.object({
  /** Re-embed everything instead of skipping documents whose content hash is unchanged. */
  force: z.boolean().default(false),
});

export const ingestionRunSchema = z.object({
  id: z.uuid(),
  corpusDir: z.string(),
  trigger: ingestionTriggerSchema,
  status: ingestionRunStatusSchema,
  startedAt: z.iso.datetime(),
  /** Null while the run is in flight, which is how the dashboard shows live status. */
  finishedAt: z.iso.datetime().nullable(),

  documentsAdded: z.number().int(),
  documentsUpdated: z.number().int(),
  documentsRemoved: z.number().int(),
  documentsFailed: z.number().int(),
  documentsUnchanged: z.number().int(),
  chunksWritten: z.number().int(),

  /** Set only when the run itself failed, as opposed to individual documents failing. */
  errorMessage: z.string().nullable(),
});

export const ingestionEventSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  /** Kept even when the document has no row — a file that failed to parse never got one. */
  sourcePath: z.string().nullable(),
  documentId: z.uuid().nullable(),
  phase: ingestionPhaseSchema,
  level: ingestionLevelSchema,
  message: z.string(),
  createdAt: z.iso.datetime(),
});

export const ingestionRunDetailSchema = ingestionRunSchema.extend({
  events: z.array(ingestionEventSchema),
});

export const ingestionRunListQuerySchema = paginationQuerySchema.extend({
  status: ingestionRunStatusSchema.optional(),
});

export type IngestionRunStatus = z.infer<typeof ingestionRunStatusSchema>;
export type IngestionTrigger = z.infer<typeof ingestionTriggerSchema>;
export type IngestionPhase = z.infer<typeof ingestionPhaseSchema>;
export type IngestionLevel = z.infer<typeof ingestionLevelSchema>;
export type IngestRequest = z.infer<typeof ingestRequestSchema>;
export type IngestionRun = z.infer<typeof ingestionRunSchema>;
export type IngestionEvent = z.infer<typeof ingestionEventSchema>;
export type IngestionRunDetail = z.infer<typeof ingestionRunDetailSchema>;
export type IngestionRunListQuery = z.infer<typeof ingestionRunListQuerySchema>;
