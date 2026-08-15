import { Inject, Injectable, Logger } from "@nestjs/common";
import { type Database } from "@corpus-lens/db/client";
import { searchQueries } from "@corpus-lens/db/schema/search-queries";

import { DATABASE } from "../database/database.module";

export interface QueryLogEntry {
  userId: string;
  queryText: string;
  endpoint: "search" | "answer";
  topK: number;
  embedMs: number;
  retrieveMs: number;
  generateMs: number | null;
  totalMs: number;
  resultCount: number;
  topScore: number | null;
  answered: boolean;
  chunkIds: string[];
  /** Citation markers the model wrote that matched no supplied source. */
  droppedMarkers: number[];
}

/**
 * Writes one row per search or answer request.
 *
 * This table *is* the analytics system (CLAUDE.md §6) — the dashboard reads aggregates
 * over it rather than a separate metrics pipeline, so the numbers cannot drift from what
 * actually happened.
 */
@Injectable()
export class QueryLogService {
  private readonly logger = new Logger(QueryLogService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Never throws. A failure to record analytics must not fail the request that produced
   * them — the user asked a question and got an answer, and losing a log row is a much
   * smaller problem than turning a successful answer into a 500.
   */
  async record(entry: QueryLogEntry): Promise<void> {
    try {
      await this.db.insert(searchQueries).values({
        userId: entry.userId,
        queryText: entry.queryText,
        endpoint: entry.endpoint,
        topK: entry.topK,
        embedMs: entry.embedMs,
        retrieveMs: entry.retrieveMs,
        generateMs: entry.generateMs,
        totalMs: entry.totalMs,
        resultCount: entry.resultCount,
        topScore: entry.topScore,
        answered: entry.answered,
        chunkIds: entry.chunkIds,
        droppedMarkers: entry.droppedMarkers,
      });
    } catch (error) {
      this.logger.warn(
        `failed to record query log: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
}
