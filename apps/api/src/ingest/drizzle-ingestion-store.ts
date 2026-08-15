import { type Database } from "@corpus-lens/db/client";
import { chunks } from "@corpus-lens/db/schema/chunks";
import { documents } from "@corpus-lens/db/schema/documents";
import { ingestionEvents } from "@corpus-lens/db/schema/ingestion-events";
import { ingestionRuns } from "@corpus-lens/db/schema/ingestion-runs";
import {
  type DocumentWrite,
  type IngestionCounts,
  type IngestionEvent,
  type IngestionStore,
  type StoredDocumentSummary,
} from "@corpus-lens/rag/ingestion-pipeline";
import { eq, inArray } from "drizzle-orm";

/**
 * The Drizzle implementation of the pipeline's persistence interface.
 *
 * It lives in `apps/api` rather than in either package because it is the point where the
 * two meet: `packages/rag` defines the interface and must not import `packages/db`
 * (CLAUDE.md §4), and `packages/db` has no business knowing about ingestion. The app is
 * the composition root, and Step 9's `POST /ingest` will construct this same store.
 */
export function createDrizzleIngestionStore(db: Database): IngestionStore {
  const store = rawStore(db);

  // Every method is wrapped, because every one of them can fail on a lost connection and
  // the pipeline stores whatever message it catches in `ingestion_events.message`, which
  // the admin dashboard renders. See `toStoreError` for why that matters.
  return {
    startRun: (input) => guard(() => store.startRun(input)),
    listDocuments: () => guard(() => store.listDocuments()),
    saveDocument: (write) => guard(() => store.saveDocument(write)),
    markDocumentFailed: (path, message) => guard(() => store.markDocumentFailed(path, message)),
    removeDocuments: (paths) => guard(() => store.removeDocuments(paths)),
    recordEvent: (runId, event) => guard(() => store.recordEvent(runId, event)),
    finishRun: (runId, summary) => guard(() => store.finishRun(runId, summary)),
  };
}

function guard<T>(action: () => Promise<T>): Promise<T> {
  return action().catch((error: unknown) => {
    throw toStoreError(error);
  });
}

/**
 * Replaces a driver error with one that is safe to store and show.
 *
 * Drizzle's error message is the **entire failed SQL statement plus its parameters**. The
 * ingestion pipeline records the message it catches into `ingestion_events` and
 * `documents.error_message`, both of which the admin dashboard renders — so left alone,
 * every failed insert would print our schema and the document's contents into the UI.
 * CLAUDE.md §7 forbids exactly that.
 *
 * The useful half is in `cause`: postgres.js puts the real diagnosis there
 * ("invalid input syntax for type date"), which is what an operator actually needs.
 */
function toStoreError(error: unknown): Error {
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error && cause.message.length > 0) {
    return new Error(cause.message);
  }
  // No cause to fall back on. The driver message cannot be trusted not to contain SQL, so
  // it is dropped rather than passed through.
  return new Error("database operation failed");
}

/**
 * Normalises a corpus date string for a Postgres `date` column.
 *
 * 108 of the 142 sample documents are dated by *month* (`2025-12`), which Postgres rejects
 * outright — it wants a full date. Rather than widen the column to text and lose ordering
 * and range queries, a month is pinned to its first day. The precision loss is real and
 * deliberate: the exact day of a monthly delivery report does not exist, and the
 * breadcrumb still carries the original `2025-12` string, so retrieval is unaffected.
 */
function toColumnDate(value: string | null): string | null {
  if (value === null) return null;
  return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
}

function rawStore(db: Database): IngestionStore {
  return {
    async startRun(input): Promise<string> {
      const [run] = await db
        .insert(ingestionRuns)
        .values({
          corpusDir: input.corpusDir,
          // The pipeline is provider-agnostic about the trigger; the enum lives here.
          trigger: input.trigger === "API" ? "API" : "CLI",
        })
        .returning({ id: ingestionRuns.id });

      if (run === undefined) throw new Error("failed to create the ingestion run row");
      return run.id;
    },

    listDocuments(): Promise<StoredDocumentSummary[]> {
      return db
        .select({
          id: documents.id,
          sourcePath: documents.sourcePath,
          contentHash: documents.contentHash,
        })
        .from(documents);
    },

    /**
     * One transaction per document: the document row and its complete chunk set land
     * together or not at all. Without this a crash between the two leaves a document
     * marked INDEXED with no chunks — invisible in the dashboard and unretrievable, which
     * is the worst of both.
     */
    saveDocument(write: DocumentWrite): Promise<{ created: boolean }> {
      return db.transaction(async (tx) => {
        const [document] = await tx
          .insert(documents)
          .values({
            sourcePath: write.sourcePath,
            title: write.title,
            contentHash: write.contentHash,
            docType: write.docType,
            docDate: toColumnDate(write.docDate),
            subject: write.subject,
            version: write.version,
            lifecycle: write.lifecycle,
            metadata: write.metadata,
            status: "INDEXED",
            errorMessage: null,
            tokenCount: write.tokenCount,
            indexedAt: new Date(),
            // `updatedAt` is deliberately NOT set here. Both timestamps then come from the
            // same `defaultNow()` clock and are identical, which is what the created/updated
            // test at the bottom of this transaction relies on. Setting it to `new Date()`
            // compares a JavaScript clock against a Postgres one, and they are never equal —
            // which made a first run over an empty table report 142 updates and 0 inserts.
          })
          .onConflictDoUpdate({
            target: documents.sourcePath,
            set: {
              title: write.title,
              contentHash: write.contentHash,
              docType: write.docType,
              docDate: toColumnDate(write.docDate),
              subject: write.subject,
              version: write.version,
              lifecycle: write.lifecycle,
              metadata: write.metadata,
              status: "INDEXED",
              // Cleared explicitly: a document that previously failed and now succeeds
              // must not keep its old error text.
              errorMessage: null,
              tokenCount: write.tokenCount,
              indexedAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning({
            id: documents.id,
            createdAt: documents.createdAt,
            updatedAt: documents.updatedAt,
          });

        if (document === undefined) throw new Error("document upsert returned no row");

        // Replace rather than merge. Re-chunking can produce a different number of chunks,
        // so updating in place would leave orphans at the tail of the old ordinal range.
        await tx.delete(chunks).where(eq(chunks.documentId, document.id));

        await tx.insert(chunks).values(
          write.chunks.map(({ chunk, embedding }) => ({
            documentId: document.id,
            ordinal: chunk.ordinal,
            breadcrumb: chunk.breadcrumb,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            embedding,
          })),
        );

        // An upsert cannot report which branch it took, so it is inferred from the
        // timestamps: only an insert leaves createdAt and updatedAt identical.
        return { created: document.createdAt.getTime() === document.updatedAt.getTime() };
      });
    },

    async markDocumentFailed(sourcePath: string, message: string): Promise<void> {
      // Upsert, not update: a document that failed on its very first ingestion has no row
      // yet, and that is exactly the case an operator most needs to see.
      await db
        .insert(documents)
        .values({
          sourcePath,
          title: sourcePath,
          contentHash: "",
          status: "FAILED",
          errorMessage: message,
        })
        .onConflictDoUpdate({
          target: documents.sourcePath,
          set: { status: "FAILED", errorMessage: message, updatedAt: new Date() },
        });
    },

    async removeDocuments(sourcePaths: string[]): Promise<void> {
      if (sourcePaths.length === 0) return;
      // Chunks go with them: chunks.document_id is ON DELETE CASCADE.
      await db.delete(documents).where(inArray(documents.sourcePath, sourcePaths));
    },

    async recordEvent(runId: string, event: IngestionEvent): Promise<void> {
      await db.insert(ingestionEvents).values({
        runId,
        sourcePath: event.sourcePath ?? null,
        phase: event.phase,
        level: event.level,
        message: event.message,
      });
    },

    async finishRun(
      runId: string,
      summary: IngestionCounts & { errorMessage: string | null },
    ): Promise<void> {
      await db
        .update(ingestionRuns)
        .set({
          // A run with failed documents still COMPLETED: it did everything it could, and
          // the failures are counted on the row. FAILED is reserved for the run itself
          // dying, which is a different thing for an operator to react to.
          status: summary.errorMessage === null ? "COMPLETED" : "FAILED",
          finishedAt: new Date(),
          documentsAdded: summary.documentsAdded,
          documentsUpdated: summary.documentsUpdated,
          documentsRemoved: summary.documentsRemoved,
          documentsFailed: summary.documentsFailed,
          documentsUnchanged: summary.documentsUnchanged,
          chunksWritten: summary.chunksWritten,
          errorMessage: summary.errorMessage,
        })
        .where(eq(ingestionRuns.id, runId));
    },
  };
}
