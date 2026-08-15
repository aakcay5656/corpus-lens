import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import { EMBEDDING_DIMENSIONS } from "@corpus-lens/db/schema/chunks";
import {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_PROVIDER_KINDS,
} from "@corpus-lens/rag/embedding-provider-factory";
import { z } from "zod";

/**
 * The MCP server's own environment, validated at startup.
 *
 * It reads the *same* variables the API does — the same database, the same embedding
 * provider, and critically the same `JWT_ACCESS_SECRET`. That last one is what makes
 * "validated against the same user store" true rather than approximate: a token minted by
 * `POST /auth/login` verifies here, and one that does not verify there does not verify
 * here either.
 */
function findEnvFile(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const envFile = findEnvFile(process.cwd());
if (envFile !== undefined) loadDotenv({ path: envFile, quiet: true });

const schema = z.object({
  DATABASE_URL: z
    .string()
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "must be a postgres:// or postgresql:// connection string — copy .env.example to .env",
    ),

  // No default. A default signing secret is a published secret, and here it would also
  // silently stop matching the API's, which is the one thing this server relies on.
  JWT_ACCESS_SECRET: z.string().min(32, "must be at least 32 characters and match the API's"),

  EMBEDDING_PROVIDER: z.enum(EMBEDDING_PROVIDER_KINDS).default("deterministic"),
  EMBEDDING_MODEL: z.string().min(1).default(DEFAULT_EMBEDDING_MODEL),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(EMBEDDING_DIMENSIONS),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.url().optional(),

  MCP_PORT: z.coerce.number().int().positive().default(3002),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Field names and messages only — never the values. A malformed DATABASE_URL still
  // contains a password and JWT_ACCESS_SECRET is a secret by definition.
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid MCP environment:\n${issues}`);
}

if (parsed.data.EMBEDDING_DIMENSIONS !== EMBEDDING_DIMENSIONS) {
  throw new Error(
    `EMBEDDING_DIMENSIONS is ${parsed.data.EMBEDDING_DIMENSIONS} but the chunks.embedding ` +
      `column is vector(${EMBEDDING_DIMENSIONS}).`,
  );
}

export const mcpEnv = parsed.data;
