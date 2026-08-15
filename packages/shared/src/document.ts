import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

export const documentStatusSchema = z.enum(["PENDING", "INDEXED", "FAILED"]);

/** A row in the dashboard's document table. */
export const documentSummarySchema = z.object({
  id: z.uuid(),
  sourcePath: z.string(),
  title: z.string(),

  // Corpus-derived metadata (docs/CORPUS.md §4). All nullable: a corpus without these
  // patterns in its paths simply gets nulls.
  docType: z.string().nullable(),
  docDate: z.iso.date().nullable(),
  subject: z.string().nullable(),
  version: z.string().nullable(),
  lifecycle: z.string().nullable(),

  status: documentStatusSchema,
  chunkCount: z.number().int(),
  tokenCount: z.number().int().nullable(),
  indexedAt: z.iso.datetime().nullable(),

  /** Populated when status is FAILED, so a bad document is visible rather than silent. */
  errorMessage: z.string().nullable(),
});

/** One chunk as shown on the document detail page. */
export const documentChunkSchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int(),
  breadcrumb: z.string(),
  content: z.string(),
  tokenCount: z.number().int(),
  /** The embedding itself is never sent — 1536 floats no client can use. */
  hasEmbedding: z.boolean(),
});

export const documentDetailSchema = documentSummarySchema.extend({
  chunks: z.array(documentChunkSchema),
});

export const documentListQuerySchema = paginationQuerySchema.extend({
  /** Substring match against title and source path. */
  search: z.string().trim().max(200).optional(),
  status: documentStatusSchema.optional(),
  docType: z.string().trim().min(1).max(64).optional(),
});

export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export type DocumentSummary = z.infer<typeof documentSummarySchema>;
export type DocumentChunk = z.infer<typeof documentChunkSchema>;
export type DocumentDetail = z.infer<typeof documentDetailSchema>;
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;
