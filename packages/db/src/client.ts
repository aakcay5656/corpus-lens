import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { chunks } from "./schema/chunks";
import { documents } from "./schema/documents";
import { ingestionEvents } from "./schema/ingestion-events";
import { ingestionRuns } from "./schema/ingestion-runs";
import { refreshTokens } from "./schema/refresh-tokens";
import { searchQueries } from "./schema/search-queries";
import { users } from "./schema/users";

/**
 * The one place the table set is assembled. Drizzle's query builder needs a single schema
 * object, which is why this exists — it is not a barrel for import convenience, and
 * nothing else in the repository re-exports the tables (CLAUDE.md §7).
 */
export const schema = {
  users,
  documents,
  chunks,
  ingestionRuns,
  ingestionEvents,
  searchQueries,
  refreshTokens,
};

export type Schema = typeof schema;
export type Database = ReturnType<typeof createDatabase>["db"];

export interface DatabaseOptions {
  /** Postgres connection string. Passed in rather than read from env so tests can point elsewhere. */
  url: string;
  /**
   * Migration and seed scripts open one connection and exit; the API keeps a pool. A
   * script that leaves ten idle connections behind is the usual cause of "too many
   * clients" against a default local Postgres.
   */
  maxConnections?: number;
}

/**
 * Postgres notices raised by `IF NOT EXISTS` statements that found the object already
 * there. The migrator emits these on every run after the first, and postgres.js prints
 * the whole notice object to stderr — which reads exactly like a crash to someone
 * following the README. Everything else still gets through.
 */
const BENIGN_NOTICE_CODES = new Set([
  "42P06", // duplicate_schema
  "42P07", // duplicate_table
  "42710", // duplicate_object
]);

export function createDatabase({ url, maxConnections = 10 }: DatabaseOptions) {
  const client = postgres(url, {
    max: maxConnections,
    onnotice: (notice) => {
      if (notice.code !== undefined && BENIGN_NOTICE_CODES.has(notice.code)) return;
      console.warn(`postgres notice: ${notice.message}`);
    },
  });
  const db = drizzle(client, { schema });

  return {
    db,
    /** Callers own the connection lifetime; there is no hidden global to leak. */
    close: async (): Promise<void> => {
      await client.end();
    },
  };
}
