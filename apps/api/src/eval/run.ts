import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { createDatabase } from "@corpus-lens/db/client";
import { createDrizzleRetrievalRepository } from "@corpus-lens/db/retrieval-repository";
import { answerQuestion, minimumFusedScore } from "@corpus-lens/rag/answer";
import { createChatProvider } from "@corpus-lens/rag/chat-provider-factory";
import { createEmbeddingProvider } from "@corpus-lens/rag/embedding-provider-factory";
import { embedAll, type EmbeddingProvider } from "@corpus-lens/rag/embeddings";
import { splitQueryTerms } from "@corpus-lens/rag/keyword-query";
import { rewriteForVectorArm } from "@corpus-lens/rag/query-rewrite";
import {
  DEFAULT_CANDIDATE_COUNT,
  retrieve,
  type RetrievalRepository,
} from "@corpus-lens/rag/retriever";
import { createTokenCounter, type TokenCounter } from "@corpus-lens/rag/tokenizer";
import { parse as parseYaml } from "yaml";

import { ingestEnv, resolveRepositoryPath } from "../config/env";
import {
  abstentionAccuracy,
  firstExpectedRank,
  formatRatio,
  fullHitRate,
  meanReciprocalRank,
  recallAtK,
  type AbstentionOutcome,
  type QueryOutcome,
} from "./metrics";

/**
 * `pnpm eval [--k 6] [--answers] [--verbose]`
 *
 * Turns the design claims into numbers. Two things are measured:
 *
 * 1. **Retrieval, three ways.** The same queries run through vector-only, keyword-only and
 *    hybrid. Hybrid is the argument the whole system rests on, and an argument with no
 *    measurement behind it is a preference. The single-arm runs are not strawmen: they get
 *    the same candidate budget and the same top-k, and they are read straight off the
 *    repository so no production code grows a branch that exists only for the benchmark.
 *
 * 2. **Abstention** (`--answers`). The floor layer is deterministic and free; the full
 *    two-layer behaviour needs the model, so it is opt-in — twelve generations cost real
 *    money and take half a minute.
 */

interface EvalQuery {
  id: string;
  type: "answerable" | "unanswerable";
  question: string;
  expect?: string[];
}

interface EvalFile {
  default_k?: number;
  queries: EvalQuery[];
}

type Mode = "hybrid" | "vector" | "keyword";
const MODES: Mode[] = ["hybrid", "vector", "keyword"];

interface RetrievalContext {
  repository: RetrievalRepository;
  embeddings: EmbeddingProvider;
  tokenCounter: TokenCounter;
  topK: number;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      k: { type: "string" },
      file: { type: "string" },
      answers: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const path = resolveRepositoryPath(values.file ?? "eval/queries.yaml");
  const suite = parseYaml(readFileSync(path, "utf8")) as EvalFile;
  const topK = values.k === undefined ? (suite.default_k ?? 6) : Number.parseInt(values.k, 10);

  const embeddings = createEmbeddingProvider({
    kind: ingestEnv.EMBEDDING_PROVIDER,
    dimensions: ingestEnv.EMBEDDING_DIMENSIONS,
    model: ingestEnv.EMBEDDING_MODEL,
    apiKey: ingestEnv.OPENAI_API_KEY,
    baseUrl: ingestEnv.OPENAI_BASE_URL,
  });

  console.log(`queries:   ${path}`);
  console.log(`embedding: ${embeddings.model}`);
  console.log(`top k:     ${topK}`);
  if (ingestEnv.EMBEDDING_PROVIDER === "deterministic") {
    console.log(
      "\n⚠ These numbers came from the offline embedding provider, which matches vocabulary\n" +
        "  rather than meaning. They show retrieval is wired correctly; they are not a\n" +
        "  measurement of retrieval quality. Re-run with EMBEDDING_PROVIDER=openai.",
    );
  }

  const { db, close } = createDatabase({ url: ingestEnv.DATABASE_URL, maxConnections: 4 });
  const context: RetrievalContext = {
    repository: createDrizzleRetrievalRepository(db),
    embeddings,
    tokenCounter: createTokenCounter(),
    topK,
  };

  const outcomes: Record<Mode, QueryOutcome[]> = { hybrid: [], vector: [], keyword: [] };
  let failures = 0;

  try {
    for (const query of suite.queries) {
      const expected = query.expect ?? [];
      const perMode: Record<Mode, string[]> = { hybrid: [], vector: [], keyword: [] };

      for (const mode of MODES) {
        perMode[mode] = await retrievePaths(mode, query.question, context);
      }

      if (query.type === "answerable") {
        for (const mode of MODES) outcomes[mode].push({ expected, retrieved: perMode[mode] });

        const missing = expected.filter((document) => !perMode.hybrid.includes(document));
        if (missing.length > 0) failures += 1;
        printAnswerable(query, expected, perMode, missing);
      } else {
        printUnanswerable(query, perMode);
      }

      if (values.verbose === true) {
        for (const mode of MODES) {
          console.log(`      ${mode.padEnd(8)} ${perMode[mode].join(", ")}`);
        }
      }
    }

    printComparison(outcomes, topK);

    if (values.answers === true) await measureAbstention(suite, context);

    const plural = failures === 1 ? "y" : "ies";
    console.log(
      `\n${failures === 0 ? "PASS" : "FAIL"}: hybrid missed ${failures} answerable quer${plural}`,
    );
    if (failures > 0) process.exitCode = 1;
  } finally {
    await close();
  }
}

/**
 * Runs one retrieval mode and returns source paths, best first.
 *
 * The single-arm modes read the repository directly rather than going through a
 * "disable one arm" switch inside `retrieve()`. That keeps the shipped path free of a
 * branch that exists only to be benchmarked, and it is the same SQL either way. Both get
 * the same candidate budget as hybrid, so the comparison is between ranking strategies
 * rather than between how much each was allowed to look at.
 */
async function retrievePaths(
  mode: Mode,
  question: string,
  context: RetrievalContext,
): Promise<string[]> {
  if (mode === "hybrid") {
    const { passages } = await retrieve({
      repository: context.repository,
      embeddingProvider: context.embeddings,
      tokenCounter: context.tokenCounter,
      query: question,
      topK: context.topK,
    });
    return passages.map((passage) => passage.sourcePath);
  }

  if (mode === "vector") {
    // Gets the same rewrite the hybrid path gives this arm. Without it the single-arm
    // column would measure a *different* vector arm from the one hybrid uses, and the
    // comparison would credit fusion with an improvement that came from the rewrite.
    const counts = await context.repository.countTermDocuments(splitQueryTerms(question));
    const { text } = rewriteForVectorArm(question, counts);

    const [embedding] = await embedAll(context.embeddings, [text], context.tokenCounter);
    if (embedding === undefined) return [];
    const chunks = await context.repository.searchByVector(embedding, DEFAULT_CANDIDATE_COUNT, {});
    return chunks.slice(0, context.topK).map((chunk) => chunk.sourcePath);
  }

  const chunks = await context.repository.searchByKeyword(question, DEFAULT_CANDIDATE_COUNT, {});
  return chunks.slice(0, context.topK).map((chunk) => chunk.sourcePath);
}

function printAnswerable(
  query: EvalQuery,
  expected: string[],
  perMode: Record<Mode, string[]>,
  missing: string[],
): void {
  const rank = (mode: Mode): string => {
    const found = firstExpectedRank({ expected, retrieved: perMode[mode] });
    return found === null ? " —" : String(found).padStart(2);
  };

  console.log(
    `\n${missing.length === 0 ? "PASS" : "FAIL"}  ${query.id}` +
      `   hybrid ${rank("hybrid")} · vector ${rank("vector")} · keyword ${rank("keyword")}`,
  );
  console.log(`      "${query.question}"`);
  if (missing.length > 0) console.log(`      hybrid missed: ${missing.join(", ")}`);
}

function printUnanswerable(query: EvalQuery, perMode: Record<Mode, string[]>): void {
  console.log(`\n----  ${query.id}   (out of corpus — must abstain)`);
  console.log(`      "${query.question}"`);
  console.log(`      hybrid top hit: ${perMode.hybrid[0] ?? "nothing"}`);
}

/** The table the design argument stands or falls on. */
function printComparison(outcomes: Record<Mode, QueryOutcome[]>, topK: number): void {
  console.log(`\n${"=".repeat(64)}`);
  console.log(
    `retrieval comparison over ${outcomes.hybrid.length} answerable queries, k=${topK}\n`,
  );
  console.log("  mode        recall@k      MRR   all-expected-found");
  console.log(`  ${"-".repeat(50)}`);

  for (const mode of MODES) {
    const rows = outcomes[mode];
    console.log(
      `  ${mode.padEnd(10)} ${formatRatio(recallAtK(rows)).padStart(7)}  ` +
        `${formatRatio(meanReciprocalRank(rows)).padStart(7)}  ` +
        `${formatRatio(fullHitRate(rows)).padStart(7)}`,
    );
  }
}

/**
 * Abstention, behind `--answers` because it calls the model.
 *
 * Both directions are measured, not only the flattering one: a system that refuses
 * everything scores perfectly on out-of-corpus questions, so wrongly-refused answerable
 * questions are counted alongside. The pair is the result; either number alone is not.
 */
async function measureAbstention(suite: EvalFile, context: RetrievalContext): Promise<void> {
  const chatProvider = createChatProvider({
    kind: ingestEnv.CHAT_PROVIDER,
    model: ingestEnv.CHAT_MODEL,
    apiKey: ingestEnv.CHAT_API_KEY,
    baseUrl: ingestEnv.CHAT_BASE_URL,
  });

  console.log(`\n${"=".repeat(64)}`);
  console.log(`abstention, both layers, via ${chatProvider.model}\n`);

  const outcomes: AbstentionOutcome[] = [];

  for (const query of suite.queries) {
    const result = await answerQuestion({
      repository: context.repository,
      embeddingProvider: context.embeddings,
      tokenCounter: context.tokenCounter,
      chatProvider,
      question: query.question,
      topK: context.topK,
    });

    const shouldAbstain = query.type === "unanswerable";
    const didAbstain = !result.answered;
    outcomes.push({ shouldAbstain, didAbstain });

    console.log(
      `  ${shouldAbstain === didAbstain ? "ok   " : "WRONG"} ${query.id.padEnd(30)} ` +
        `answered=${String(result.answered).padEnd(5)} ${result.abstainReason ?? ""}`,
    );
  }

  const accuracy = abstentionAccuracy(outcomes);
  console.log(
    `\n  correctly refused   ${accuracy.correctRefusals}/${accuracy.unanswerable} out-of-corpus questions`,
  );
  console.log(
    `  wrongly refused     ${accuracy.falseRefusals}/${accuracy.answerable} answerable questions`,
  );
  console.log(
    `  answered anyway     ${accuracy.hallucinationRisk}/${accuracy.unanswerable} out-of-corpus questions  ` +
      (accuracy.hallucinationRisk === 0
        ? "(none — the one that matters)"
        : "← the expensive failure"),
  );
  console.log(`\n  score floor: ${minimumFusedScore().toFixed(4)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
