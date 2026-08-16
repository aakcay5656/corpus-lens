import { type Passage, type SearchTimings } from "@corpus-lens/shared/search";

import { embedAll, type EmbeddingProvider } from "./embeddings";
import { splitQueryTerms } from "./keyword-query";
import { rewriteForVectorArm, type TermDocumentCounts } from "./query-rewrite";
import { reciprocalRankFusion, type FusedEntry } from "./reciprocal-rank-fusion";
import { type TokenCounter } from "./tokenizer";

/**
 * Hybrid retrieval: vector similarity and Postgres full-text search, fused with RRF.
 *
 * The two arms fail in opposite directions, which is the entire argument for running both.
 * Vector search cannot separate the 78 delivery reports in this corpus — they are built
 * from 15 distinct sentences (docs/CORPUS.md §3.2), so their embeddings are near-identical
 * and cosine ranking between them is noise; keyword search resolves "Bubble Bakery
 * December" instantly. Conversely a question like "why are sound assets built in a
 * separate pass" shares almost no literal tokens with the document that answers it, and
 * only the vector arm finds it.
 *
 * Like the ingestion pipeline, this takes a repository interface rather than importing
 * `packages/db` (CLAUDE.md §4). The fusion, the candidate budget and the ordering are all
 * testable without Postgres; only the two SQL queries are not, and they live in the app.
 */

/** One chunk as the store returns it, before fusion. */
export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourcePath: string;
  docType: string | null;
  breadcrumb: string;
  content: string;
  ordinal: number;
  /**
   * The arm's own raw score — cosine similarity or ts_rank. Carried for diagnostics only.
   * It is deliberately *not* used in fusion: see reciprocal-rank-fusion.ts.
   */
  rawScore: number;
}

export interface RetrievalFilters {
  /** Restricts both arms to one document type. Free-form, per the shared contract. */
  docType?: string;
}

export interface RetrievalRepository {
  searchByVector(
    embedding: number[],
    limit: number,
    filters: RetrievalFilters,
  ): Promise<RetrievedChunk[]>;

  searchByKeyword(
    query: string,
    limit: number,
    filters: RetrievalFilters,
  ): Promise<RetrievedChunk[]>;

  /**
   * How many documents contain each term, and how many documents there are.
   *
   * Feeds the vector-arm rewrite in `query-rewrite.ts`. It is a repository method rather
   * than a number computed here because document frequency is a property of the indexed
   * corpus, and this package deliberately cannot read the corpus (CLAUDE.md §4).
   */
  countTermDocuments(terms: string[]): Promise<TermDocumentCounts>;
}

/**
 * Candidates fetched from each arm before fusion.
 *
 * Larger than the 6 that reach the answer, because fusion can only reorder what it was
 * given: a document ranked 12th by vectors and 3rd by keywords should win, and it cannot
 * if the vector arm only returned 6. Twenty is the value in CLAUDE.md §6 and is cheap here
 * — both arms are index-backed and the corpus is 142 chunks.
 */
export const DEFAULT_CANDIDATE_COUNT = 20;

export interface RetrieveInput {
  repository: RetrievalRepository;
  embeddingProvider: EmbeddingProvider;
  tokenCounter: TokenCounter;
  query: string;
  topK: number;
  candidateCount?: number;
  filters?: RetrievalFilters;
}

export interface RetrievalResult {
  passages: Passage[];
  timings: SearchTimings;
  /**
   * The text that was actually embedded, and the terms removed from it. Equal to the
   * question with an empty list when nothing was dropped. Reported so a surprising result
   * can be explained without re-running anything — a rewrite that fires unexpectedly is
   * otherwise invisible.
   */
  vectorQuery: { text: string; droppedTerms: string[] };
}

export async function retrieve(input: RetrieveInput): Promise<RetrievalResult> {
  const startedAt = Date.now();
  const candidateCount = input.candidateCount ?? DEFAULT_CANDIDATE_COUNT;
  const filters = input.filters ?? {};

  // One extra round trip before the embedding call, because the rewrite decides what to
  // embed. It is a single indexed aggregate over the query's own terms, and it buys the
  // vector arm the discounting that `ts_rank` gives the keyword arm for free — see
  // query-rewrite.ts. Counted in `retrieveMs` with the two arms, since all three are
  // repository work.
  const lookupStartedAt = Date.now();
  const counts = await input.repository.countTermDocuments(splitQueryTerms(input.query));
  const lookupMs = Date.now() - lookupStartedAt;

  const rewrite = rewriteForVectorArm(input.query, counts);

  const embedStartedAt = Date.now();
  const [embedding] = await embedAll(input.embeddingProvider, [rewrite.text], input.tokenCounter);
  const embedMs = Date.now() - embedStartedAt;

  if (embedding === undefined) {
    throw new Error("the embedding provider returned no vector for the query");
  }

  const retrieveStartedAt = Date.now();
  // In parallel, not in sequence: the arms are independent, they hit different indexes,
  // and running them one after the other would make every search pay both latencies.
  //
  // The arms get *different text*, deliberately: the rewritten query to the embedding, the
  // question as asked to the keyword arm, which already discounts common terms and would
  // lose a decisive proper noun if they were stripped.
  const [vectorHits, keywordHits] = await Promise.all([
    input.repository.searchByVector(embedding, candidateCount, filters),
    input.repository.searchByKeyword(input.query, candidateCount, filters),
  ]);
  const retrieveMs = Date.now() - retrieveStartedAt + lookupMs;

  const byId = new Map<string, RetrievedChunk>();
  for (const chunk of [...vectorHits, ...keywordHits]) {
    // First writer wins; both arms return identical rows for the same chunk, so this is
    // only about not allocating twice.
    if (!byId.has(chunk.chunkId)) byId.set(chunk.chunkId, chunk);
  }

  const fused = reciprocalRankFusion({
    vector: vectorHits.map((chunk) => chunk.chunkId),
    keyword: keywordHits.map((chunk) => chunk.chunkId),
  });

  const passages = fused
    .slice(0, input.topK)
    .map((entry) => toPassage(entry, byId))
    .filter((passage): passage is Passage => passage !== null);

  return {
    passages,
    timings: { embedMs, retrieveMs, totalMs: Date.now() - startedAt },
    vectorQuery: { text: rewrite.text, droppedTerms: rewrite.droppedTerms },
  };
}

function toPassage(entry: FusedEntry, byId: Map<string, RetrievedChunk>): Passage | null {
  const chunk = byId.get(entry.id);
  // Cannot happen — every fused id came from one of the two lists — but returning null
  // rather than asserting keeps a repository bug from crashing the search endpoint.
  if (chunk === undefined) return null;

  return {
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    sourcePath: chunk.sourcePath,
    docType: chunk.docType,
    breadcrumb: chunk.breadcrumb,
    content: chunk.content,
    ordinal: chunk.ordinal,
    score: entry.score,
    vectorRank: entry.vectorRank,
    keywordRank: entry.keywordRank,
  };
}
