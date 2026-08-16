import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ChatError } from "@corpus-lens/rag/chat-provider";
import { EmbeddingError } from "@corpus-lens/rag/embeddings";
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
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @Inject(RETRIEVAL_REPOSITORY) private readonly repository: RetrievalRepository,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(CHAT_PROVIDER) private readonly chat: ChatProvider | null,
    @Inject(TOKEN_COUNTER) private readonly tokenCounter: TokenCounter,
    private readonly queryLog: QueryLogService,
  ) {}

  async search(request: SearchRequest, userId: string): Promise<SearchResponse> {
    const { passages, timings } = await this.rethrowUpstream(() =>
      retrieve({
        repository: this.repository,
        embeddingProvider: this.embeddings,
        tokenCounter: this.tokenCounter,
        query: request.query,
        topK: request.topK,
        filters: request.docType === undefined ? {} : { docType: request.docType },
      }),
    );

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
    // Bound to a local before the closure: TypeScript cannot carry the null-narrowing of a
    // mutable property across a callback boundary, and a non-null assertion is exactly what
    // CLAUDE.md §7 forbids.
    const chatProvider = this.chat;
    if (chatProvider === null) {
      throw new ServiceUnavailableException("Answering is not configured.");
    }

    const result = await this.rethrowUpstream(() =>
      answerQuestion({
        repository: this.repository,
        embeddingProvider: this.embeddings,
        tokenCounter: this.tokenCounter,
        chatProvider,
        question: request.question,
        topK: request.topK,
        filters: request.docType === undefined ? {} : { docType: request.docType },
        onToken,
      }),
    );

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

  /**
   * Turns a provider failure into a 502 rather than letting it fall through as a 500.
   *
   * The error envelope has carried `UPSTREAM_UNAVAILABLE` since Step 3 and nothing had
   * ever produced it. An exhausted API balance, a rate-limited provider or a timed-out
   * embedding call are not "an internal error occurred" — the server is fine, a dependency
   * is not, and that is a materially different thing to tell a caller. `/search` continuing
   * to work while `/answer` does not is exactly the situation the distinction exists for.
   *
   * The message stays generic. The provider's own text can contain a partially masked API
   * key (found in Step 6), so it goes to the log and never to the client.
   */
  private async rethrowUpstream<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof ChatError || error instanceof EmbeddingError) {
        this.logger.warn(`upstream provider failed: ${error.message}`);
        throw new BadGatewayException(
          "The answer service is temporarily unavailable. Search is unaffected.",
        );
      }
      throw error;
    }
  }
}
