import { z } from "zod";

/**
 * The admin dashboard's numbers, read straight from the operational tables.
 *
 * CLAUDE.md §6: "the dashboard analytics are a read over this table, not a separate
 * metrics system". Everything here is a SQL aggregate over `documents`, `chunks`,
 * `ingestion_runs` and `search_queries` — there is no metrics pipeline to keep in sync,
 * and the numbers cannot drift from what actually happened.
 */

export const corpusStatsSchema = z.object({
  documents: z.number().int(),
  documentsIndexed: z.number().int(),
  documentsFailed: z.number().int(),
  chunks: z.number().int(),
  /**
   * Chunks with no embedding. Non-zero means retrieval is silently incomplete — the
   * vector arm cannot return what was never embedded — so it is surfaced as its own
   * number rather than inferred from a chunk count.
   */
  chunksMissingEmbedding: z.number().int(),
  totalTokens: z.number().int(),
  lastIndexedAt: z.iso.datetime().nullable(),
});

export const queryStatsSchema = z.object({
  /** Requests in the window, and the same split the latency columns are stored in. */
  total: z.number().int(),
  searches: z.number().int(),
  answers: z.number().int(),

  p50TotalMs: z.number().int().nullable(),
  p95TotalMs: z.number().int().nullable(),

  /**
   * Share of answer requests that declined, 0–1. A first-class metric rather than a
   * string search over answer text, which is why `search_queries.answered` is a column.
   * A rising rate is the signal that the corpus has a gap.
   */
  abstainRate: z.number().nullable(),

  /** Requests that retrieved nothing at all — the corpus has no vocabulary for them. */
  zeroResultCount: z.number().int(),
});

export const topQuerySchema = z.object({
  queryText: z.string(),
  count: z.number().int(),
  /** Null when every occurrence retrieved nothing. */
  averageTopScore: z.number().nullable(),
});

export const dailyQueryCountSchema = z.object({
  day: z.iso.date(),
  count: z.number().int(),
});

/** Enough of the last run to render a status card without a second request. */
export const lastRunSummarySchema = z.object({
  id: z.uuid(),
  status: z.enum(["RUNNING", "COMPLETED", "FAILED"]),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  documentsAdded: z.number().int(),
  documentsUpdated: z.number().int(),
  documentsFailed: z.number().int(),
});

export const statsResponseSchema = z.object({
  corpus: corpusStatsSchema,
  queries: queryStatsSchema,
  topQueries: z.array(topQuerySchema),
  zeroResultQueries: z.array(topQuerySchema),
  volumeByDay: z.array(dailyQueryCountSchema),
  lastRun: lastRunSummarySchema.nullable(),
  /** Window the query statistics cover, so the UI can label them honestly. */
  windowDays: z.number().int(),
});

export type CorpusStats = z.infer<typeof corpusStatsSchema>;
export type QueryStats = z.infer<typeof queryStatsSchema>;
export type TopQuery = z.infer<typeof topQuerySchema>;
export type DailyQueryCount = z.infer<typeof dailyQueryCountSchema>;
export type LastRunSummary = z.infer<typeof lastRunSummarySchema>;
export type StatsResponse = z.infer<typeof statsResponseSchema>;
