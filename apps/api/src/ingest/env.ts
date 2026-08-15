import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

// Imported for its side effect as well as its value: this module locates and loads the
// repository .env, and validates DATABASE_URL. Importing it here means the ingest CLI does
// not carry a second copy of the dotenv-discovery logic, and gets the same error message
// for a missing database URL that `pnpm db:migrate` gives.
import { env as databaseEnv } from "@corpus-lens/db/env";
import { EMBEDDING_DIMENSIONS } from "@corpus-lens/db/schema/chunks";
import {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_PROVIDER_KINDS,
} from "@corpus-lens/rag/embedding-provider-factory";
import { z } from "zod";

/**
 * Environment for the ingestion CLI, validated at startup so the process dies on a bad
 * value rather than partway through a run (CLAUDE.md §7).
 *
 * `packages/rag` deliberately does not read `process.env` — it is a library and takes its
 * configuration as arguments — so this is where the environment becomes configuration.
 */
const ingestEnvSchema = z.object({
  CORPUS_DIR: z.string().min(1, "must name the directory to ingest — see .env.example"),

  EMBEDDING_PROVIDER: z.enum(EMBEDDING_PROVIDER_KINDS).default("deterministic"),
  EMBEDDING_MODEL: z.string().min(1).default(DEFAULT_EMBEDDING_MODEL),

  // Validated as a number but pinned to the schema's width below: the two must agree, and
  // a mismatch is a migration, not a configuration change.
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(EMBEDDING_DIMENSIONS),

  // Not required here — the provider factory raises a specific, actionable error when the
  // openai kind is selected without it. Demanding it unconditionally would break the
  // no-API-key path that is the whole point of the deterministic provider.
  OPENAI_API_KEY: z.string().optional(),

  // The /v1/embeddings wire format is spoken by OpenRouter, Azure OpenAI and self-hosted
  // servers too, so the vendor is a URL rather than a code change. Validated as a URL so a
  // typo fails at startup instead of as a confusing fetch error mid-run.
  OPENAI_BASE_URL: z.url().optional(),
});

const parsed = ingestEnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Field names and messages only. An API key must never reach a log line, and neither
  // must the value that failed validation (CLAUDE.md §9).
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid ingestion environment:\n${issues}`);
}

if (parsed.data.EMBEDDING_DIMENSIONS !== EMBEDDING_DIMENSIONS) {
  // The parking-lot check from Step 4. packages/rag cannot import packages/db, so this is
  // the only place both numbers are in scope. Without it a mismatch surfaces as an opaque
  // Postgres error on the first chunk insert, several minutes into a run.
  throw new Error(
    `EMBEDDING_DIMENSIONS is ${parsed.data.EMBEDDING_DIMENSIONS} but the chunks.embedding ` +
      `column is vector(${EMBEDDING_DIMENSIONS}). Changing the width needs a migration.`,
  );
}

export const ingestEnv = { ...parsed.data, DATABASE_URL: databaseEnv.DATABASE_URL };

/**
 * Resolves a relative path against the repository root.
 *
 * `CORPUS_DIR=./sample_dataset/corpus` in .env is written relative to the repository, but
 * these scripts run from wherever pnpm or turbo puts them. Resolving against
 * `process.cwd()` would make the same .env mean different directories depending on how the
 * command was invoked.
 */
export function resolveRepositoryPath(path: string): string {
  return isAbsolute(path) ? path : resolve(findRepositoryRoot(), path);
}

/** Named alias, because "resolve the corpus directory" is what the CLI is actually doing. */
export const resolveCorpusDir = resolveRepositoryPath;

function findRepositoryRoot(): string {
  let current = resolve(process.cwd());

  for (;;) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("could not locate the repository root (no pnpm-workspace.yaml found)");
    }
    current = parent;
  }
}
