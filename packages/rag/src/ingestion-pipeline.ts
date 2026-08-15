import { chunkDocument, type ChunkOptions, type DocumentChunk } from "./chunker";
import { deriveDocumentAttributes } from "./document-attributes";
import { embedAll, type EmbeddingProvider } from "./embeddings";
import { parseFrontMatter } from "./front-matter";
import { deriveSourceMetadata } from "./source-metadata";
import { type TokenCounter } from "./tokenizer";

/**
 * The ingestion run, expressed only in terms of interfaces.
 *
 * Nothing here touches the filesystem or SQL. That is what CLAUDE.md §4 asks for — this
 * package receives a repository interface rather than importing `packages/db` — and the
 * practical payoff is that the whole pipeline, including the "one document fails and the
 * run carries on" behaviour, is unit-tested in memory with no Postgres and no network.
 * The real implementations are wired together in `apps/api/src/ingest`.
 */

/** Where documents are read from. A directory today; anything enumerable tomorrow. */
export interface CorpusSource {
  /** Identifier of the corpus, recorded on the run row. */
  readonly description: string;
  /** Paths relative to the corpus root, in a stable order. */
  list(): Promise<string[]>;
  read(relativePath: string): Promise<{ content: string; contentHash: string }>;
}

/** A document as it already exists in the store, for the unchanged-by-hash comparison. */
export interface StoredDocumentSummary {
  id: string;
  sourcePath: string;
  contentHash: string;
}

/** Everything one document contributes, written in a single transaction. */
export interface DocumentWrite {
  sourcePath: string;
  title: string;
  contentHash: string;
  docType: string | null;
  docDate: string | null;
  subject: string | null;
  version: string | null;
  lifecycle: string | null;
  metadata: Record<string, string>;
  tokenCount: number;
  chunks: { chunk: DocumentChunk; embedding: number[] }[];
}

export type IngestionPhase = "DISCOVER" | "PARSE" | "CHUNK" | "EMBED" | "PERSIST";
export type IngestionLevel = "INFO" | "WARN" | "ERROR";

export interface IngestionEvent {
  phase: IngestionPhase;
  level: IngestionLevel;
  message: string;
  sourcePath?: string;
}

/** Persistence, as the pipeline needs it. Implemented over Drizzle in apps/api. */
export interface IngestionStore {
  startRun(input: { corpusDir: string; trigger: string }): Promise<string>;
  listDocuments(): Promise<StoredDocumentSummary[]>;
  /** Upserts the document and replaces all of its chunks. Must be one transaction. */
  saveDocument(write: DocumentWrite): Promise<{ created: boolean }>;
  /** Records a document the run could not index, without aborting the run. */
  markDocumentFailed(sourcePath: string, message: string): Promise<void>;
  /** Deletes documents no longer present in the corpus. Chunks cascade. */
  removeDocuments(sourcePaths: string[]): Promise<void>;
  recordEvent(runId: string, event: IngestionEvent): Promise<void>;
  finishRun(
    runId: string,
    summary: IngestionCounts & { errorMessage: string | null },
  ): Promise<void>;
}

export interface IngestionCounts {
  documentsAdded: number;
  documentsUpdated: number;
  documentsRemoved: number;
  documentsFailed: number;
  documentsUnchanged: number;
  chunksWritten: number;
}

export interface IngestionSummary extends IngestionCounts {
  runId: string;
  documentsDiscovered: number;
  failures: { sourcePath: string; message: string }[];
  durationMs: number;
}

export interface RunIngestionInput {
  source: CorpusSource;
  store: IngestionStore;
  embeddingProvider: EmbeddingProvider;
  tokenCounter: TokenCounter;
  trigger: string;
  /** Re-embeds every document even when its content hash is unchanged. */
  force?: boolean;
  chunkOptions?: Partial<ChunkOptions>;
  /** Progress reporting. The pipeline never writes to the console itself. */
  onProgress?: (event: IngestionEvent) => void;
}

export async function runIngestion(input: RunIngestionInput): Promise<IngestionSummary> {
  const startedAt = Date.now();
  const runId = await input.store.startRun({
    corpusDir: input.source.description,
    trigger: input.trigger,
  });

  const counts: IngestionCounts = {
    documentsAdded: 0,
    documentsUpdated: 0,
    documentsRemoved: 0,
    documentsFailed: 0,
    documentsUnchanged: 0,
    chunksWritten: 0,
  };
  const failures: { sourcePath: string; message: string }[] = [];

  const report = async (event: IngestionEvent): Promise<void> => {
    input.onProgress?.(event);
    await input.store.recordEvent(runId, event);
  };

  try {
    const discovered = await input.source.list();
    const existing = await input.store.listDocuments();
    const existingByPath = new Map(existing.map((doc) => [doc.sourcePath, doc]));

    await report({
      phase: "DISCOVER",
      level: "INFO",
      message: `discovered ${discovered.length} documents in ${input.source.description}`,
    });

    for (const sourcePath of discovered) {
      // Each document is its own unit of failure. CLAUDE.md §7: one bad file is recorded
      // and the run continues, because aborting a 142-document run over one unreadable
      // file leaves the index in a worse state than a partial success does.
      try {
        const outcome = await ingestOneDocument(input, sourcePath, existingByPath, report);
        if (outcome === "unchanged") counts.documentsUnchanged += 1;
        else if (outcome.created) counts.documentsAdded += 1;
        else counts.documentsUpdated += 1;
        if (outcome !== "unchanged") counts.chunksWritten += outcome.chunksWritten;
      } catch (error) {
        const message = describeError(error);
        counts.documentsFailed += 1;
        failures.push({ sourcePath, message });
        await input.store.markDocumentFailed(sourcePath, message);
        await report({
          phase: phaseOf(error),
          level: "ERROR",
          message,
          sourcePath,
        });
      }
    }

    const discoveredSet = new Set(discovered);
    const removed = existing
      .filter((doc) => !discoveredSet.has(doc.sourcePath))
      .map((doc) => doc.sourcePath);

    if (removed.length > 0) {
      await input.store.removeDocuments(removed);
      counts.documentsRemoved = removed.length;
      await report({
        phase: "PERSIST",
        level: "INFO",
        message: `removed ${removed.length} documents no longer in the corpus`,
      });
    }

    await input.store.finishRun(runId, { ...counts, errorMessage: null });
  } catch (error) {
    // A failure out here is the run itself failing — the corpus directory is unreadable,
    // or the database went away. Recorded on the run row so a half-finished run is never
    // left looking like a successful one.
    const message = describeError(error);
    await input.store.finishRun(runId, { ...counts, errorMessage: message });
    throw error;
  }

  return {
    runId,
    documentsDiscovered:
      counts.documentsAdded +
      counts.documentsUpdated +
      counts.documentsUnchanged +
      counts.documentsFailed,
    failures,
    durationMs: Date.now() - startedAt,
    ...counts,
  };
}

/**
 * Carries the pipeline stage on an error so a failure is recorded against the phase that
 * produced it — "EMBED" and "PARSE" send an operator to completely different places.
 */
class PhaseError extends Error {
  constructor(
    readonly phase: IngestionPhase,
    cause: unknown,
  ) {
    super(describeError(cause));
    this.name = "PhaseError";
  }
}

async function ingestOneDocument(
  input: RunIngestionInput,
  sourcePath: string,
  existingByPath: Map<string, StoredDocumentSummary>,
  report: (event: IngestionEvent) => Promise<void>,
): Promise<"unchanged" | { created: boolean; chunksWritten: number }> {
  const raw = await attempt("PARSE", () => input.source.read(sourcePath));

  const existing = existingByPath.get(sourcePath);
  if (input.force !== true && existing?.contentHash === raw.contentHash) {
    return "unchanged";
  }

  const frontMatter = parseFrontMatter(raw.content);
  if (frontMatter.unsupportedLines.length > 0) {
    // Warn rather than fail: the document is still perfectly indexable, but its metadata
    // is incomplete and that should be visible in the dashboard, not inferred later.
    await report({
      phase: "PARSE",
      level: "WARN",
      sourcePath,
      message: `${frontMatter.unsupportedLines.length} front-matter lines were not flat key: value pairs and were skipped`,
    });
  }

  const chunked = await attempt("CHUNK", () =>
    Promise.resolve(
      chunkDocument({
        relativePath: sourcePath,
        source: frontMatter.body,
        tokenCounter: input.tokenCounter,
        options: input.chunkOptions,
      }),
    ),
  );

  if (chunked.chunks.length === 0) {
    // An empty file is not an error, but it must not silently become an indexed document
    // with nothing to retrieve.
    await report({
      phase: "CHUNK",
      level: "WARN",
      sourcePath,
      message: "document produced no chunks and was skipped",
    });
    return "unchanged";
  }

  const embeddings = await attempt("EMBED", () =>
    embedAll(
      input.embeddingProvider,
      chunked.chunks.map((chunk) => chunk.embeddedText),
      input.tokenCounter,
    ),
  );

  const metadata = deriveSourceMetadata(sourcePath);
  const attributes = deriveDocumentAttributes(metadata.subject, frontMatter.body);

  const result = await attempt("PERSIST", () =>
    input.store.saveDocument({
      sourcePath,
      title: chunked.title,
      contentHash: raw.contentHash,
      docType: metadata.docType,
      docDate: metadata.date,
      subject: metadata.subject,
      version: attributes.version,
      lifecycle: attributes.lifecycle,
      metadata: frontMatter.data,
      tokenCount: chunked.chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
      chunks: chunked.chunks.map((chunk, index) => ({
        chunk,
        embedding: embeddings[index] ?? [],
      })),
    }),
  );

  await report({
    phase: "PERSIST",
    level: "INFO",
    sourcePath,
    message: `${result.created ? "added" : "updated"} with ${chunked.chunks.length} chunks`,
  });

  return { created: result.created, chunksWritten: chunked.chunks.length };
}

async function attempt<T>(phase: IngestionPhase, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new PhaseError(phase, error);
  }
}

function phaseOf(error: unknown): IngestionPhase {
  return error instanceof PhaseError ? error.phase : "DISCOVER";
}

/**
 * Errors are turned into a message here rather than at the point they are caught, so
 * every recorded failure has the same shape. Deliberately does not include a stack — the
 * message is stored in the database and rendered in the admin dashboard (CLAUDE.md §7).
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unknown error";
}
