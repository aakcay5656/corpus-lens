import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "./client";
import { env } from "./env";

/**
 * Applies every pending migration, then exits.
 *
 * A single connection: the migrator runs statements in sequence and holds an advisory
 * lock, so a pool would only leave idle connections behind.
 */
async function main(): Promise<void> {
  const { db, close } = createDatabase({ url: env.DATABASE_URL, maxConnections: 1 });

  try {
    const migrationsFolder = resolve(__dirname, "..", "migrations");
    console.log(`Applying migrations from ${migrationsFolder}`);

    await migrate(db, { migrationsFolder });

    console.log("Migrations applied.");
  } finally {
    // Runs on the error path too, so a failed migration does not hang the process.
    await close();
  }
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
