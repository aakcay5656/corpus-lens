import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { type Database } from "@corpus-lens/db/client";
import { ingestionEvents } from "@corpus-lens/db/schema/ingestion-events";
import { ingestionRuns } from "@corpus-lens/db/schema/ingestion-runs";
import { runIngestion } from "@corpus-lens/rag/ingestion-pipeline";
import { createFilesystemCorpusSource } from "@corpus-lens/rag/filesystem-corpus-source";
import { type EmbeddingProvider } from "@corpus-lens/rag/embeddings";
import { type TokenCounter } from "@corpus-lens/rag/tokenizer";
import {
  type IngestionRun,
  type IngestionRunDetail,
  type IngestionRunListQuery,
} from "@corpus-lens/shared/ingestion";
import { type Paginated } from "@corpus-lens/shared/pagination";
import { and, asc, count, desc, eq, type SQL } from "drizzle-orm";

import { apiEnv, resolveCorpusDir } from "../config/env";
import { DATABASE } from "../database/database.module";
import { EMBEDDING_PROVIDER, TOKEN_COUNTER } from "../rag/rag.module";
import { createDrizzleIngestionStore } from "./drizzle-ingestion-store";

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  /**
   * Guards against two runs at once. Ingestion replaces a document's chunks wholesale, so
   * two concurrent runs over the same corpus would interleave deletes and inserts on the
   * same rows. In-process only, which is honest for a single-instance deployment and is
   * recorded in the README's limitations rather than pretended to be a distributed lock.
   */
  private running: Promise<void> | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(TOKEN_COUNTER) private readonly tokenCounter: TokenCounter,
  ) {}

  /**
   * Starts a run and returns as soon as its row exists.
   *
   * Deliberately not awaited. A full run over this corpus takes about a minute with a
   * hosted embedding model — 142 documents, each a network call — and holding an HTTP
   * request open for that would hit every proxy and browser timeout between here and the
   * dashboard. The run row is the handle: the client polls `GET /ingest/runs/:id`, which
   * is also what makes the dashboard's live status possible.
   */
  async start(force: boolean): Promise<IngestionRun> {
    if (this.running !== null) {
      // Not an error: the caller wanted a run and one is already happening. Returning the
      // in-flight run is more useful than a 409 the dashboard would have to special-case.
      const [current] = await this.db
        .select()
        .from(ingestionRuns)
        .where(eq(ingestionRuns.status, "RUNNING"))
        .orderBy(desc(ingestionRuns.startedAt))
        .limit(1);
      if (current !== undefined) return toRun(current);
    }

    const corpusDir = resolveCorpusDir(apiEnv.CORPUS_DIR);
    const store = createDrizzleIngestionStore(this.db);

    // The run row is created by the pipeline, so it has to exist before we can return it.
    // `startRun` is awaited; everything after it is not.
    const runId = await store.startRun({ corpusDir, trigger: "API" });

    this.running = this.execute(runId, corpusDir, force).finally(() => {
      this.running = null;
    });

    const [row] = await this.db.select().from(ingestionRuns).where(eq(ingestionRuns.id, runId));
    if (row === undefined) throw new Error("ingestion run row disappeared");
    return toRun(row);
  }

  /**
   * The pipeline creates its own run row, so this one reuses the id already handed to the
   * caller by adopting a store whose `startRun` returns it instead of inserting again.
   */
  private async execute(runId: string, corpusDir: string, force: boolean): Promise<void> {
    const store = createDrizzleIngestionStore(this.db);

    try {
      await runIngestion({
        source: createFilesystemCorpusSource({ rootDir: corpusDir }),
        store: { ...store, startRun: () => Promise.resolve(runId) },
        embeddingProvider: this.embeddings,
        tokenCounter: this.tokenCounter,
        trigger: "API",
        force,
      });
    } catch (error) {
      // The pipeline already records the failure on the run row before rethrowing; this
      // is a background task with no caller to receive the rejection, so it is logged and
      // swallowed here rather than becoming an unhandled rejection that kills the process.
      this.logger.error(
        `ingestion run ${runId} failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  async listRuns(query: IngestionRunListQuery): Promise<Paginated<IngestionRun>> {
    const filters: SQL[] = [];
    if (query.status !== undefined) filters.push(eq(ingestionRuns.status, query.status));
    const where = filters.length > 0 ? and(...filters) : undefined;

    const [totals] = await this.db.select({ total: count() }).from(ingestionRuns).where(where);

    const rows = await this.db
      .select()
      .from(ingestionRuns)
      .where(where)
      .orderBy(desc(ingestionRuns.startedAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return {
      items: rows.map(toRun),
      page: query.page,
      pageSize: query.pageSize,
      total: totals?.total ?? 0,
    };
  }

  async findRun(id: string): Promise<IngestionRunDetail> {
    const [row] = await this.db.select().from(ingestionRuns).where(eq(ingestionRuns.id, id));
    if (row === undefined) throw new NotFoundException("Ingestion run not found.");

    const events = await this.db
      .select()
      .from(ingestionEvents)
      .where(eq(ingestionEvents.runId, id))
      .orderBy(asc(ingestionEvents.createdAt))
      // Bounded: a run over a large corpus can emit thousands of events, and an unbounded
      // response would be the largest payload this API can produce.
      .limit(500);

    return {
      ...toRun(row),
      events: events.map((event) => ({
        id: event.id,
        runId: event.runId,
        sourcePath: event.sourcePath,
        documentId: event.documentId,
        phase: event.phase,
        level: event.level,
        message: event.message,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }
}

type IngestionRunRow = typeof ingestionRuns.$inferSelect;

function toRun(row: IngestionRunRow): IngestionRun {
  return {
    ...row,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
