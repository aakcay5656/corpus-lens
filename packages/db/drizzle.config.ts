import { defineConfig } from "drizzle-kit";
import { env } from "./src/env";

/**
 * Lives in the db package, not the repo root, so every piece of database tooling —
 * driver, schema, migrations, CLI config — sits in the workspace that owns it. Root
 * scripts delegate here with `pnpm --filter`.
 */
export default defineConfig({
  dialect: "postgresql",
  // A glob, not a barrel file: adding a table means adding a file, nothing to re-export.
  schema: "./src/schema/*.ts",
  out: "./migrations",
  dbCredentials: { url: env.DATABASE_URL },
  // Ask before running anything destructive against a database.
  strict: true,
  verbose: true,
});
