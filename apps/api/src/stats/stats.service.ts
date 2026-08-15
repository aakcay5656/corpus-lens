import { Inject, Injectable } from "@nestjs/common";
import { type Database } from "@corpus-lens/db/client";
import { type StatsResponse } from "@corpus-lens/shared/stats";
import { sql } from "drizzle-orm";

import { DATABASE } from "../database/database.module";

/**
 * The dashboard's numbers, as aggregates over the operational tables.
 *
 * The window is interpolated as `${windowDays} * interval '1 day'` rather than built into
 * an interval literal with `sql.raw`. The value is already Zod-validated as a bounded
 * integer so a raw literal would in fact be safe here — but "safe because of a validator
 * three files away" is the reasoning that goes wrong when someone later relaxes the
 * validator, and a bound parameter needs no such argument.
 *
 * CLAUDE.md §6: the analytics are a read over `search_queries`, not a separate metrics
 * system. That is why these are raw SQL aggregates rather than counters incremented in
 * application code — a counter can drift from reality, a `count(*)` cannot.
 */
@Injectable()
export class StatsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async summary(windowDays: number): Promise<StatsResponse> {
    // One round trip per group rather than per number. They are independent aggregates
    // over different tables, so they run concurrently.
    const [corpus, queries, topQueries, zeroResultQueries, volumeByDay, lastRun] =
      await Promise.all([
        this.corpusStats(),
        this.queryStats(windowDays),
        this.topQueries(windowDays),
        this.zeroResultQueries(windowDays),
        this.volumeByDay(windowDays),
        this.lastRun(),
      ]);

    return { corpus, queries, topQueries, zeroResultQueries, volumeByDay, lastRun, windowDays };
  }

  private async corpusStats(): Promise<StatsResponse["corpus"]> {
    const result = await this.db.execute<{
      documents: number;
      documents_indexed: number;
      documents_failed: number;
      chunks: number;
      chunks_missing_embedding: number;
      total_tokens: number;
      last_indexed_at: unknown;
    }>(sql`
      select
        (select count(*)::int from documents)                                   as documents,
        (select count(*)::int from documents where status = 'INDEXED')          as documents_indexed,
        (select count(*)::int from documents where status = 'FAILED')           as documents_failed,
        (select count(*)::int from chunks)                                      as chunks,
        -- Non-zero means retrieval is silently incomplete: the vector arm cannot return
        -- what was never embedded, and nothing else would reveal it.
        (select count(*)::int from chunks where embedding is null)              as chunks_missing_embedding,
        (select coalesce(sum(token_count), 0)::int from chunks)                 as total_tokens,
        (select max(indexed_at) from documents)                                 as last_indexed_at
    `);

    const row = result[0];
    return {
      documents: row?.documents ?? 0,
      documentsIndexed: row?.documents_indexed ?? 0,
      documentsFailed: row?.documents_failed ?? 0,
      chunks: row?.chunks ?? 0,
      chunksMissingEmbedding: row?.chunks_missing_embedding ?? 0,
      totalTokens: row?.total_tokens ?? 0,
      lastIndexedAt: toIsoString(row?.last_indexed_at),
    };
  }

  private async queryStats(windowDays: number): Promise<StatsResponse["queries"]> {
    const result = await this.db.execute<{
      total: number;
      searches: number;
      answers: number;
      p50: number | null;
      p95: number | null;
      abstained: number;
      answer_total: number;
      zero_results: number;
    }>(sql`
      select
        count(*)::int                                                     as total,
        count(*) filter (where endpoint = 'search')::int                  as searches,
        count(*) filter (where endpoint = 'answer')::int                  as answers,
        -- Percentiles in the database rather than by sorting rows in Node: the point of
        -- p95 is the tail, and the tail is exactly what a LIMIT would discard.
        percentile_cont(0.5) within group (order by total_ms)::int        as p50,
        percentile_cont(0.95) within group (order by total_ms)::int       as p95,
        count(*) filter (where endpoint = 'answer' and not answered)::int as abstained,
        count(*) filter (where endpoint = 'answer')::int                  as answer_total,
        count(*) filter (where result_count = 0)::int                     as zero_results
      from search_queries
      where created_at >= now() - (${windowDays} * interval '1 day')
    `);

    const row = result[0];
    const answerTotal = row?.answer_total ?? 0;

    return {
      total: row?.total ?? 0,
      searches: row?.searches ?? 0,
      answers: row?.answers ?? 0,
      p50TotalMs: row?.p50 ?? null,
      p95TotalMs: row?.p95 ?? null,
      // Null rather than 0 when nothing was asked: "0% abstain rate" and "no data" are
      // different states and the UI must be able to tell them apart.
      abstainRate: answerTotal === 0 ? null : (row?.abstained ?? 0) / answerTotal,
      zeroResultCount: row?.zero_results ?? 0,
    };
  }

  private async topQueries(windowDays: number): Promise<StatsResponse["topQueries"]> {
    const result = await this.db.execute<{
      query_text: string;
      count: number;
      average_top_score: number | null;
    }>(sql`
      select query_text, count(*)::int as count, avg(top_score)::float8 as average_top_score
      from search_queries
      where created_at >= now() - (${windowDays} * interval '1 day')
      group by query_text
      order by count desc, query_text asc
      limit 10
    `);

    return result.map((row) => ({
      queryText: row.query_text,
      count: row.count,
      averageTopScore: row.average_top_score,
    }));
  }

  /**
   * Queries that retrieved nothing at all. Together with the abstain rate this is the
   * signal CLAUDE.md §6 calls out: it tells an operator the corpus has a gap, which is
   * something no amount of latency monitoring would reveal.
   */
  private async zeroResultQueries(windowDays: number): Promise<StatsResponse["zeroResultQueries"]> {
    const result = await this.db.execute<{ query_text: string; count: number }>(sql`
      select query_text, count(*)::int as count
      from search_queries
      where result_count = 0
        and created_at >= now() - (${windowDays} * interval '1 day')
      group by query_text
      order by count desc, query_text asc
      limit 10
    `);

    return result.map((row) => ({
      queryText: row.query_text,
      count: row.count,
      averageTopScore: null,
    }));
  }

  private async volumeByDay(windowDays: number): Promise<StatsResponse["volumeByDay"]> {
    const result = await this.db.execute<{ day: string; count: number }>(sql`
      select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as count
      from search_queries
      where created_at >= now() - (${windowDays} * interval '1 day')
      group by 1
      order by 1 asc
    `);

    return result.map((row) => ({ day: row.day, count: row.count }));
  }

  private async lastRun(): Promise<StatsResponse["lastRun"]> {
    const result = await this.db.execute<{
      id: string;
      status: "RUNNING" | "COMPLETED" | "FAILED";
      started_at: unknown;
      finished_at: unknown;
      documents_added: number;
      documents_updated: number;
      documents_failed: number;
    }>(sql`
      select id, status, started_at, finished_at,
             documents_added, documents_updated, documents_failed
      from ingestion_runs
      order by started_at desc
      limit 1
    `);

    const row = result[0];
    if (row === undefined) return null;

    return {
      id: row.id,
      status: row.status,
      startedAt: toIsoString(row.started_at) ?? new Date(0).toISOString(),
      finishedAt: toIsoString(row.finished_at),
      documentsAdded: row.documents_added,
      documentsUpdated: row.documents_updated,
      documentsFailed: row.documents_failed,
    };
  }
}

/**
 * Normalises a timestamp coming back from a raw `db.execute` query.
 *
 * The generic on `db.execute<T>()` is an *assertion*, not a check — the driver returns
 * whatever Postgres sends and TypeScript believes the annotation. Declaring
 * `last_indexed_at: Date` compiled cleanly and then threw
 * `row.last_indexed_at.toISOString is not a function` on the first real request, because
 * a raw query does not go through the column-type decoding that the query builder applies.
 *
 * So the field is typed `unknown` and narrowed here. Accepting both shapes is not
 * defensive padding: it is the honest description of what a raw query can return.
 */
function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}
