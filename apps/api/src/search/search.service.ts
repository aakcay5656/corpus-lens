import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { answerQuestion, type AnswerResult } from "@corpus-lens/rag/answer";
import { type ChatProvider } from "@corpus-lens/rag/chat-provider";
import { type EmbeddingProvider } from "@corpus-lens/rag/embeddings";
import { retrieve, type RetrievalRepository } from "@corpus-lens/rag/retriever";
import { type TokenCounter } from "@corpus-lens/rag/tokenizer";
import { type SearchRequest, type SearchResponse } from "@corpus-lens/shared/search";
import { type AnswerRequest } from "@corpus-lens/shared/answer";

import {
  CHAT_PROVIDER,
  EMBEDDING_PROVIDER,
  RETRIEVAL_REPOSITORY,
  TOKEN_COUNTER,
} from "../rag/rag.module";
import { QueryLogService } from "./query-log.service";

/**
 * Search and answering over HTTP.
 *
 * The service does three things the retrieval package deliberately does not: it supplies
 * the concrete providers, it records every request in `search_queries`, and it turns a
 * missing chat provider into a 503 rather than a crash.
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(RETRIEVAL_REPOSITORY) private readonly repository: RetrievalRepository,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(CHAT_PROVIDER) private readonly chat: ChatProvider | null,
    @Inject(TOKEN_COUNTER) private readonly tokenCounter: TokenCounter,
    private readonly queryLog: QueryLogService,
  ) {}

  async search(request: SearchRequest, userId: string): Promise<SearchResponse> {
    const { passages, timings } = await retrieve({
      repository: this.repository,
      embeddingProvider: this.embeddings,
      tokenCounter: this.tokenCounter,
      query: request.query,
      topK: request.topK,
      filters: request.docType === undefined ? {} : { docType: request.docType },
    });

    await this.queryLog.record({
      userId,
      queryText: request.query,
      endpoint: "search",
      topK: request.topK,
      embedMs: timings.embedMs,
      retrieveMs: timings.retrieveMs,
      generateMs: null,
      totalMs: timings.totalMs,
      resultCount: passages.length,
      topScore: passages[0]?.score ?? null,
      // Search does not abstain; it either finds passages or does not. Recorded as true
      // so the abstain rate stays a statement about answering, which is what it measures.
      answered: true,
      chunkIds: passages.map((passage) => passage.chunkId),
      droppedMarkers: [],
    });

    return { query: request.query, passages, timings };
  }

  /**
   * Called before the SSE headers are flushed.
   *
   * Once a stream has begun the status line is already 200 and the exception filter can
   * no longer turn a failure into a proper HTTP error, so anything knowable up front has
   * to be checked up front.
   */
  assertAnswerAvailable(): void {
    if (this.chat === null) {
      // 503, not 500: the server is working, this one capability is unconfigured. The
      // message says what is missing without naming a variable's value.
      throw new ServiceUnavailableException(
        "Answering is not configured on this server. Search is available.",
      );
    }
  }

  async answer(
    request: AnswerRequest,
    userId: string,
    onToken?: (token: string) => void,
  ): Promise<AnswerResult> {
    this.assertAnswerAvailable();
    if (this.chat === null) throw new ServiceUnavailableException("Answering is not configured.");

    const result = await answerQuestion({
      repository: this.repository,
      embeddingProvider: this.embeddings,
      tokenCounter: this.tokenCounter,
      chatProvider: this.chat,
      question: request.question,
      topK: request.topK,
      filters: request.docType === undefined ? {} : { docType: request.docType },
      onToken,
    });

    await this.queryLog.record({
      userId,
      queryText: request.question,
      endpoint: "answer",
      topK: request.topK,
      embedMs: result.timings.embedMs,
      retrieveMs: result.timings.retrieveMs,
      generateMs: result.timings.generateMs,
      totalMs: result.timings.totalMs,
      resultCount: result.sources.length,
      topScore: result.sources[0]?.score ?? null,
      answered: result.answered,
      chunkIds: result.sources.map((source) => source.chunkId),
      droppedMarkers: result.droppedMarkers,
    });

    return result;
  }
}
