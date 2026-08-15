import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { createDatabase } from "@corpus-lens/db/client";
import { createEmbeddingProvider } from "@corpus-lens/rag/embedding-provider-factory";
import { retrieve } from "@corpus-lens/rag/retriever";
import { createTokenCounter } from "@corpus-lens/rag/tokenizer";
import { parse as parseYaml } from "yaml";

import { ingestEnv, resolveRepositoryPath } from "../config/env";
import { createDrizzleRetrievalRepository } from "@corpus-lens/db/retrieval-repository";

/**
 * `pnpm eval` — runs `eval/queries.yaml` against live retrieval and prints, per query,
 * where the expected document landed.
 *
 * This exists because Step 6's acceptance criterion is a number, not an opinion: every
 * answerable query must surface its expected document in the top k. Step 16 extends this
 * same script with recall@k, MRR and a vector-only / keyword-only / hybrid comparison; for
 * now it answers the one question that decides whether retrieval is finished.
 *
 * Unanswerable queries are listed with their top score but not graded here — abstention is
 * Step 7's mechanism, and the useful thing to see now is how close the corpus gets to a
 * question it cannot answer.
 */

interface EvalQuery {
  id: string;
  type: "answerable" | "unanswerable";
  question: string;
  expect?: string[];
  also_useful?: string[];
}

interface EvalFile {
  default_k?: number;
  queries: EvalQuery[];
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      k: { type: "string" },
      file: { type: "string" },
      verbose: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const path = resolveRepositoryPath(values.file ?? "eval/queries.yaml");
  const suite = parseYaml(readFileSync(path, "utf8")) as EvalFile;
  const topK = values.k === undefined ? (suite.default_k ?? 6) : Number.parseInt(values.k, 10);

  const provider = createEmbeddingProvider({
    kind: ingestEnv.EMBEDDING_PROVIDER,
    dimensions: ingestEnv.EMBEDDING_DIMENSIONS,
    model: ingestEnv.EMBEDDING_MODEL,
    apiKey: ingestEnv.OPENAI_API_KEY,
    baseUrl: ingestEnv.OPENAI_BASE_URL,
  });

  console.log(`queries:   ${path}`);
  console.log(`embedding: ${provider.model}`);
  console.log(`top k:     ${topK}`);
  if (ingestEnv.EMBEDDING_PROVIDER === "deterministic") {
    console.log(
      "\n⚠ These numbers were produced by the offline embedding provider, which matches\n" +
        "  vocabulary rather than meaning. They show that retrieval is wired correctly; they\n" +
        "  are not a measurement of retrieval quality. Re-run with EMBEDDING_PROVIDER=openai.",
    );
  }

  const { db, close } = createDatabase({ url: ingestEnv.DATABASE_URL, maxConnections: 4 });
  const repository = createDrizzleRetrievalRepository(db);
  const tokenCounter = createTokenCounter();

  let answerable = 0;
  let passed = 0;

  try {
    for (const query of suite.queries) {
      const { passages, timings } = await retrieve({
        repository,
        embeddingProvider: provider,
        tokenCounter,
        query: query.question,
        topK,
      });

      const paths = passages.map((passage) => passage.sourcePath);
      const expected = query.expect ?? [];

      if (query.type === "answerable") {
        answerable += 1;
        const missing = expected.filter((document) => !paths.includes(document));
        const ok = missing.length === 0;
        if (ok) passed += 1;

        const rank = expected.length === 0 ? -1 : paths.indexOf(expected[0] ?? "") + 1;
        console.log(
          `\n${ok ? "PASS" : "FAIL"}  ${query.id}  (${timings.totalMs}ms)` +
            (ok && rank > 0 ? `  expected document at rank ${rank}` : ""),
        );
        if (!ok) console.log(`      missing: ${missing.join(", ")}`);
      } else {
        console.log(
          `\n----  ${query.id}  (${timings.totalMs}ms)  top score ` +
            `${passages[0]?.score.toFixed(4) ?? "none"}  — must abstain (Step 7)`,
        );
      }

      console.log(`      "${query.question}"`);
      for (const [index, passage] of passages.entries()) {
        const marks = [
          expected.includes(passage.sourcePath) ? "*" : " ",
          (query.also_useful ?? []).includes(passage.sourcePath) ? "+" : " ",
        ].join("");
        console.log(
          `      ${marks} ${String(index + 1).padStart(2)}. ${passage.score.toFixed(4)}  ` +
            `v=${formatRank(passage.vectorRank)} k=${formatRank(passage.keywordRank)}  ` +
            passage.sourcePath,
        );
        if (values.verbose === true) console.log(`            ${passage.breadcrumb}`);
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`answerable queries: ${passed}/${answerable} found every expected document`);
    if (passed < answerable) process.exitCode = 1;
  } finally {
    await close();
  }
}

/** `v=—` reads better than `v=null` in a column of numbers. */
function formatRank(rank: number | null): string {
  return rank === null ? " —" : String(rank).padStart(2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
