import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

/**
 * Walk up from the current working directory looking for the repository .env.
 *
 * Needed because these scripts are invoked from three different places: the repo root
 * (`pnpm db:migrate`), the package directory (turbo runs tasks there), and drizzle-kit's
 * own process. Hard-coding a relative path would work for exactly one of them.
 */
function findEnvFile(startDir: string): string | undefined {
  let dir = resolve(startDir);

  for (;;) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) return undefined; // reached the filesystem root
    dir = parent;
  }
}

const envFile = findEnvFile(process.cwd());
if (envFile !== undefined) {
  loadDotenv({ path: envFile, quiet: true });
}

// CLAUDE.md §7: secrets come from the environment and are validated at startup, so the
// process dies on a missing key instead of failing at the first query.
const envSchema = z.object({
  // One check, not a .min(1) plus a .refine(): both fire on an empty value and print two
  // lines describing the same problem. A startup error should say what to do once.
  DATABASE_URL: z
    .string()
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "must be a postgres:// or postgresql:// connection string — copy .env.example to .env",
    ),

  SEED_ADMIN_EMAIL: z.email().default("admin@demo.local"),
  SEED_ADMIN_PASSWORD: z.string().min(8).default("admin-demo-pw-2026"),
  SEED_USER_EMAIL: z.email().default("user@demo.local"),
  SEED_USER_PASSWORD: z.string().min(8).default("user-demo-pw-2026"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Print the field names and messages, never the values — a malformed DATABASE_URL
  // still contains a password.
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");

  throw new Error(`Invalid database environment:\n${issues}`);
}

export const env = parsed.data;
