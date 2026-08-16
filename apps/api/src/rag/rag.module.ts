import { Global, Logger, Module } from "@nestjs/common";
import { type Database } from "@corpus-lens/db/client";
import { createChatProvider } from "@corpus-lens/rag/chat-provider-factory";
import { type ChatProvider } from "@corpus-lens/rag/chat-provider";
import { createEmbeddingProvider } from "@corpus-lens/rag/embedding-provider-factory";
import { type EmbeddingProvider } from "@corpus-lens/rag/embeddings";
import { type RetrievalRepository } from "@corpus-lens/rag/retriever";
import { createTokenCounter, type TokenCounter } from "@corpus-lens/rag/tokenizer";

import { apiEnv } from "../config/env";
import { DATABASE } from "../database/database.module";
import { createDrizzleRetrievalRepository } from "@corpus-lens/db/retrieval-repository";

/**
 * The retrieval package, wired as injectable providers.
 *
 * This is the composition root the whole monorepo layout exists for: the same
 * `packages/rag` code that the ingest CLI and (in Step 13) the MCP server construct is
 * assembled here for HTTP. Nothing in the feature modules below knows which embedding
 * model or chat gateway is behind these tokens.
 */
export const EMBEDDING_PROVIDER = Symbol("EMBEDDING_PROVIDER");
export const CHAT_PROVIDER = Symbol("CHAT_PROVIDER");
export const TOKEN_COUNTER = Symbol("TOKEN_COUNTER");
export const RETRIEVAL_REPOSITORY = Symbol("RETRIEVAL_REPOSITORY");

@Global()
@Module({
  providers: [
    {
      provide: EMBEDDING_PROVIDER,
      useFactory: (): EmbeddingProvider =>
        createEmbeddingProvider({
          kind: apiEnv.EMBEDDING_PROVIDER,
          dimensions: apiEnv.EMBEDDING_DIMENSIONS,
          model: apiEnv.EMBEDDING_MODEL,
          apiKey: apiEnv.OPENAI_API_KEY,
          baseUrl: apiEnv.OPENAI_BASE_URL,
        }),
    },
    {
      provide: CHAT_PROVIDER,
      /**
       * Lazily constructed, and allowed to be absent. Only `POST /answer` needs a chat
       * model; search, documents, ingestion and the dashboard all work without one. The
       * factory would throw on a missing key, so a deployment that never intends to
       * answer questions would otherwise fail to boot over a feature it does not use.
       */
      useFactory: (): ChatProvider | null => {
        // The extractive provider needs no credential, so the key check applies only to
        // the hosted one — otherwise a deployment running offline could never answer.
        // `extractive` and `auto` both work without a credential — auto simply resolves to
        // the offline answerer when there is no key. Only the pinned hosted mode needs one.
        if (
          apiEnv.CHAT_PROVIDER === "openai" &&
          (apiEnv.CHAT_API_KEY === undefined || apiEnv.CHAT_API_KEY.length === 0)
        ) {
          return null;
        }
        return createChatProvider({
          onFallback: (reason) =>
            new Logger("ChatProvider").warn(
              `hosted model unavailable, answering offline until the cooldown expires: ${reason}`,
            ),
          kind: apiEnv.CHAT_PROVIDER,
          model: apiEnv.CHAT_MODEL,
          apiKey: apiEnv.CHAT_API_KEY,
          baseUrl: apiEnv.CHAT_BASE_URL,
        });
      },
    },
    { provide: TOKEN_COUNTER, useFactory: (): TokenCounter => createTokenCounter() },
    {
      provide: RETRIEVAL_REPOSITORY,
      useFactory: (db: Database): RetrievalRepository => createDrizzleRetrievalRepository(db),
      inject: [DATABASE],
    },
  ],
  exports: [EMBEDDING_PROVIDER, CHAT_PROVIDER, TOKEN_COUNTER, RETRIEVAL_REPOSITORY],
})
export class RagModule {}
