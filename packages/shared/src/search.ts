import { z } from "zod";
import { QUERY_MAX_LENGTH, QUERY_MIN_LENGTH, TOP_K_DEFAULT, TOP_K_MAX, TOP_K_MIN } from "./limits";

export const searchRequestSchema = z.object({
  query: z.string().trim().min(QUERY_MIN_LENGTH).max(QUERY_MAX_LENGTH),
  topK: z.number().int().min(TOP_K_MIN).max(TOP_K_MAX).default(TOP_K_DEFAULT),
  /**
   * Optional corpus filter, e.g. only delivery reports. Free-form text rather than an
   * enum because document types come from the folder names of whatever directory
   * ingestion was pointed at (docs/CORPUS.md §4).
   */
  docType: z.string().trim().min(1).max(64).optional(),
});

/**
 * One retrieved chunk, with enough context to be read on its own and enough provenance to
 * be verified against its source.
 */
export const passageSchema = z.object({
  chunkId: z.uuid(),
  documentId: z.uuid(),
  documentTitle: z.string(),
  sourcePath: z.string(),
  docType: z.string().nullable(),
  /** "Delivery Report: Merge Marina, 2025-12 > QA findings and fixes" */
  breadcrumb: z.string(),
  content: z.string(),
  /** Position in the document, so passages from one file can be shown in reading order. */
  ordinal: z.number().int(),

  /**
   * Reciprocal Rank Fusion score. Not comparable to a cosine similarity and not a
   * probability — it only orders results within one query, which is exactly why RRF needs
   * no normalisation between the two retrieval arms.
   */
  score: z.number(),

  /**
   * 1-based rank in each arm, null when that arm did not return the chunk at all. Exposed
   * because "vector found it, keyword did not" is the single most useful thing to see
   * when retrieval misbehaves, and the dashboard should not have to guess it.
   */
  vectorRank: z.number().int().nullable(),
  keywordRank: z.number().int().nullable(),
});

/** Milliseconds per stage. Mirrors the columns in the search_queries table. */
export const searchTimingsSchema = z.object({
  embedMs: z.number().int(),
  retrieveMs: z.number().int(),
  totalMs: z.number().int(),
});

export const searchResponseSchema = z.object({
  query: z.string(),
  passages: z.array(passageSchema),
  timings: searchTimingsSchema,
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type Passage = z.infer<typeof passageSchema>;
export type SearchTimings = z.infer<typeof searchTimingsSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
