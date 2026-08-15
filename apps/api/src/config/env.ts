import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

// Imported for its side effect as well as its value: this module locates and loads the
// repository .env, and validates DATABASE_URL. Importing it here means the ingest CLI does
// not carry a second copy of the dotenv-discovery logic, and gets the same error message
// for a missing database URL that `pnpm db:migrate` gives.
import { env as databaseEnv } from "@corpus-lens/db/env";
import { EMBEDDING_DIMENSIONS } from "@corpus-lens/db/schema/chunks";
import { DEFAULT_CHAT_MODEL } from "@corpus-lens/rag/chat-provider-factory";
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

  // Generation. Separate from the embedding settings because the two are genuinely
  // independent choices: search and the dashboard work with no chat model at all, and a
  // deployment may reasonably embed locally while generating through a hosted API.
  CHAT_MODEL: z.string().min(1).default(DEFAULT_CHAT_MODEL),
  CHAT_BASE_URL: z.url().optional(),
  CHAT_API_KEY: z.string().optional(),

  // ---------------------------------------------------------------------------
  // Auth — Step 8
  // ---------------------------------------------------------------------------
  // No defaults, deliberately. Every other setting here has a sensible fallback; a
  // signing secret must not, because a default secret is a published secret and every
  // deployment that forgot to set one would share it. 32 characters is the floor for a
  // key that has to resist offline brute force.
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, "must be at least 32 characters — generate with: openssl rand -base64 48"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "must be at least 32 characters — generate with: openssl rand -base64 48"),

  // Short-lived, because an access token cannot be revoked before it expires: its whole
  // point is that verifying it needs no database round trip. The refresh token is the
  // revocable half, and it is stored server-side (packages/db/schema/refresh-tokens).
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),

  // Cookies are Secure in production and not in development, because a browser refuses a
  // Secure cookie over plain http and localhost is plain http.
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // The browser origin allowed to send credentialed requests. A single origin, never "*":
  // the two are incompatible for credentialed CORS, and a wildcard here would let any
  // site read authenticated responses.
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  API_PORT: z.coerce.number().int().positive().default(3001),
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

if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
  // Distinct secrets are what stop a refresh token from being presented as an access
  // token: both are JWTs signed by this server, and the only thing making them
  // non-interchangeable is the key each is verified against.
  throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.");
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

export const apiEnv = {
  ...parsed.data,
  DATABASE_URL: databaseEnv.DATABASE_URL,

  // One key usually covers both when a single gateway serves embeddings and generation,
  // so CHAT_API_KEY falls back to OPENAI_API_KEY rather than demanding the same value be
  // written into .env twice. Setting it explicitly splits the two.
  CHAT_API_KEY: parsed.data.CHAT_API_KEY ?? parsed.data.OPENAI_API_KEY,
  CHAT_BASE_URL: parsed.data.CHAT_BASE_URL ?? parsed.data.OPENAI_BASE_URL,
};

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

/**
 * The former name, kept so the ingest, eval and ask CLIs read naturally. Same object.
 */
export const ingestEnv = apiEnv;
