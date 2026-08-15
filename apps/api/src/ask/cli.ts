import { parseArgs } from "node:util";

import { createDatabase } from "@corpus-lens/db/client";
import { answerQuestion, minimumFusedScore } from "@corpus-lens/rag/answer";
import { createChatProvider } from "@corpus-lens/rag/chat-provider-factory";
import { createEmbeddingProvider } from "@corpus-lens/rag/embedding-provider-factory";
import { createTokenCounter } from "@corpus-lens/rag/tokenizer";
import { TOP_K_DEFAULT, TOP_K_MAX, TOP_K_MIN } from "@corpus-lens/shared/limits";

import { ingestEnv } from "../config/env";
import { createDrizzleRetrievalRepository } from "../retrieval/drizzle-retrieval-repository";

/**
 * `pnpm ask "question"` — the grounded answer path from a terminal.
 *
 * It exists so the answering pipeline can be demonstrated and debugged before any HTTP
 * layer exists, and it is the same composition Step 9's `POST /answer` will perform. The
 * `--sources` flag prints what the model was actually shown, which is the only way to
 * tell a retrieval failure from a generation failure.
 */
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      k: { type: "string" },
      sources: { type: "boolean", default: false },
      // Inverted, because node:util parseArgs has no --flag=false form for a boolean:
      // a `stream` option defaulting to true could never be turned off.
      "no-stream": { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const question = positionals.join(" ").trim();
  if (question.length === 0) {
    throw new Error('usage: pnpm ask "your question" [--k 6] [--sources]');
  }

  const topK = values.k === undefined ? TOP_K_DEFAULT : Number.parseInt(values.k, 10);
  if (!Number.isInteger(topK) || topK < TOP_K_MIN || topK > TOP_K_MAX) {
    // The same bound the API enforces, from the same constant: an unbounded topK is a
    // denial-of-service vector against the LLM bill (CLAUDE.md §9).
    throw new Error(`--k must be an integer between ${TOP_K_MIN} and ${TOP_K_MAX}`);
  }

  const embeddingProvider = createEmbeddingProvider({
    kind: ingestEnv.EMBEDDING_PROVIDER,
    dimensions: ingestEnv.EMBEDDING_DIMENSIONS,
    model: ingestEnv.EMBEDDING_MODEL,
    apiKey: ingestEnv.OPENAI_API_KEY,
    baseUrl: ingestEnv.OPENAI_BASE_URL,
  });

  const chatProvider = createChatProvider({
    kind: "openai",
    model: ingestEnv.CHAT_MODEL,
    apiKey: ingestEnv.CHAT_API_KEY,
    baseUrl: ingestEnv.CHAT_BASE_URL,
  });

  console.log(`embedding: ${embeddingProvider.model}`);
  console.log(`chat:      ${chatProvider.model}`);
  console.log(`score floor: ${minimumFusedScore().toFixed(4)}\n`);

  const { db, close } = createDatabase({ url: ingestEnv.DATABASE_URL, maxConnections: 4 });

  try {
    let streamed = false;
    const result = await answerQuestion({
      repository: createDrizzleRetrievalRepository(db),
      embeddingProvider,
      tokenCounter: createTokenCounter(),
      chatProvider,
      question,
      topK,
      onToken:
        values["no-stream"] === true
          ? undefined
          : (token) => {
              // Proves tokens arrive incrementally rather than in one lump at the end,
              // which is what Step 11's typing effect depends on.
              if (!streamed) {
                process.stdout.write("streaming: ");
                streamed = true;
              }
              process.stdout.write(token);
            },
    });
    if (streamed) process.stdout.write("\n");

    console.log(`\nanswered:  ${String(result.answered)}`);
    if (result.abstainReason !== null) console.log(`reason:    ${result.abstainReason}`);
    console.log(`top score: ${result.sources[0]?.score.toFixed(4) ?? "none"}`);
    console.log(
      `timings:   embed ${result.timings.embedMs}ms · retrieve ${result.timings.retrieveMs}ms · ` +
        `generate ${result.timings.generateMs ?? "—"}ms · total ${result.timings.totalMs}ms`,
    );

    console.log(`\n${result.text}\n`);

    if (result.citations.length > 0) {
      console.log("citations");
      for (const citation of result.citations) {
        console.log(`  [${citation.marker}] ${citation.sourcePath} — ${citation.breadcrumb}`);
      }
    }
    if (result.droppedMarkers.length > 0) {
      console.log(`dropped markers (pointed at no source): ${result.droppedMarkers.join(", ")}`);
    }

    if (values.sources === true) {
      console.log("\nsources shown to the model");
      for (const [index, source] of result.sources.entries()) {
        console.log(
          `  [${index + 1}] ${source.score.toFixed(4)} v=${source.vectorRank ?? "—"} ` +
            `k=${source.keywordRank ?? "—"}  ${source.sourcePath}`,
        );
      }
    }
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
