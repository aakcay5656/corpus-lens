import { existsSync, statSync } from "node:fs";
import { parseArgs } from "node:util";

import { createDatabase } from "@corpus-lens/db/client";
import { createEmbeddingProvider } from "@corpus-lens/rag/embedding-provider-factory";
import { createFilesystemCorpusSource } from "@corpus-lens/rag/filesystem-corpus-source";
import {
  runIngestion,
  type IngestionEvent,
  type IngestionSummary,
} from "@corpus-lens/rag/ingestion-pipeline";
import { createTokenCounter } from "@corpus-lens/rag/tokenizer";

import { createDrizzleIngestionStore } from "./drizzle-ingestion-store";
import { ingestEnv, resolveCorpusDir } from "./env";

/**
 * `pnpm ingest [--dir <path>] [--force] [--quiet]`
 *
 * The composition root for ingestion: it is the only file that knows about the corpus
 * directory, the database and the embedding provider at the same time. Everything it
 * assembles is an interface the pipeline was written against, which is why the same
 * pipeline can be driven from `POST /ingest` in Step 9 without changing a line of it.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dir: { type: "string" },
      force: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
    },
    // parseArgs throws on an unknown flag by default, which is what we want: a silently
    // ignored --forse would look like a run that refused to re-embed.
    allowPositionals: false,
  });

  const corpusDir = resolveCorpusDir(values.dir ?? ingestEnv.CORPUS_DIR);
  if (!existsSync(corpusDir) || !statSync(corpusDir).isDirectory()) {
    throw new Error(
      `corpus directory not found: ${corpusDir}\n` +
        "Set CORPUS_DIR in .env or pass --dir. The sample corpus is not in the repository; " +
        "see the README for where to place it.",
    );
  }

  const provider = createEmbeddingProvider({
    kind: ingestEnv.EMBEDDING_PROVIDER,
    dimensions: ingestEnv.EMBEDDING_DIMENSIONS,
    model: ingestEnv.EMBEDDING_MODEL,
    apiKey: ingestEnv.OPENAI_API_KEY,
  });

  console.log(`corpus:    ${corpusDir}`);
  console.log(`embedding: ${provider.model} (${provider.dimensions}d)`);
  if (ingestEnv.EMBEDDING_PROVIDER === "deterministic") {
    console.log(
      "           ⚠ offline provider: matches vocabulary, not meaning. Fine for running\n" +
        "           the system, not for judging retrieval quality. Set EMBEDDING_PROVIDER=openai.",
    );
  }
  if (values.force === true) console.log("mode:      force (re-embedding everything)");

  const { db, close } = createDatabase({ url: ingestEnv.DATABASE_URL, maxConnections: 4 });

  try {
    const summary = await runIngestion({
      source: createFilesystemCorpusSource({ rootDir: corpusDir }),
      store: createDrizzleIngestionStore(db),
      embeddingProvider: provider,
      tokenCounter: createTokenCounter(),
      trigger: "CLI",
      force: values.force,
      onProgress: values.quiet === true ? undefined : printProgress,
    });

    printSummary(summary);

    // A run that completed with failed documents is still a failed *command*: a CI job or
    // a README follower should not read "done" and move on with an incomplete index.
    if (summary.documentsFailed > 0) process.exitCode = 1;
  } finally {
    // In a finally block so a thrown error still releases the pool; otherwise the process
    // hangs on an open connection instead of reporting the failure.
    await close();
  }
}

function printProgress(event: IngestionEvent): void {
  // INFO lines for individual documents are the bulk of the output and say nothing an
  // operator needs on a healthy run; the summary covers them. Warnings and errors are
  // printed because they are the reason to be watching.
  if (event.level === "INFO" && event.sourcePath !== undefined) return;

  const where = event.sourcePath === undefined ? "" : ` ${event.sourcePath}`;
  console.log(`[${event.level}] ${event.phase}${where}: ${event.message}`);
}

function printSummary(summary: IngestionSummary): void {
  const rows: [string, string][] = [
    ["discovered", String(summary.documentsDiscovered)],
    ["added", String(summary.documentsAdded)],
    ["updated", String(summary.documentsUpdated)],
    ["unchanged", String(summary.documentsUnchanged)],
    ["removed", String(summary.documentsRemoved)],
    ["failed", String(summary.documentsFailed)],
    ["chunks written", String(summary.chunksWritten)],
    ["duration", `${(summary.durationMs / 1000).toFixed(1)}s`],
  ];

  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  console.log("");
  console.log(`ingestion run ${summary.runId}`);
  console.log("─".repeat(labelWidth + 12));
  for (const [label, value] of rows) {
    console.log(`${label.padEnd(labelWidth)}  ${value.padStart(8)}`);
  }

  if (summary.failures.length > 0) {
    console.log("");
    console.log(`${summary.failures.length} document(s) failed:`);
    for (const failure of summary.failures) {
      console.log(`  ${failure.sourcePath}: ${failure.message}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
