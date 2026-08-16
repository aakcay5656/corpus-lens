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

  // ---------------------------------------------------------------------------
  // Authentication mode
  // ---------------------------------------------------------------------------
  // `local` verifies a token this system issued, against JWT_ACCESS_SECRET — the same
  // credential the API and the web app use, so the demo works with nothing else running.
  // `oidc` delegates to an identity provider and this server holds no signing key at all.
  //
  // Defaulting to `local` is a deliberate departure from "replace the bearer token": making
  // the default require an external IdP would mean the MCP server could not be tried at all
  // without registering an application somewhere, which is a worse trade than the bonus is
  // worth. Both are implemented; the choice is one variable.
  MCP_AUTH_MODE: z.enum(["local", "oidc"]).default("local"),

  OIDC_ISSUER: z.url().optional(),
  OIDC_AUDIENCE: z.string().min(1).optional(),
  // Defaults to the standard discovery location when the issuer is set.
  OIDC_JWKS_URI: z.url().optional(),
  OIDC_ROLE_CLAIM: z.string().min(1).default("roles"),
  OIDC_ADMIN_ROLE: z.string().min(1).default("admin"),
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

if (parsed.data.MCP_AUTH_MODE === "oidc") {
  // Checked at startup rather than on the first request. A server that boots in OIDC mode
  // without an issuer would reject every caller with a confusing error, and the operator
  // would find out from a user rather than from the logs.
  const missing = (["OIDC_ISSUER", "OIDC_AUDIENCE"] as const).filter(
    (key) => parsed.data[key] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(`MCP_AUTH_MODE=oidc requires ${missing.join(" and ")}.`);
  }
}

if (parsed.data.EMBEDDING_DIMENSIONS !== EMBEDDING_DIMENSIONS) {
  throw new Error(
    `EMBEDDING_DIMENSIONS is ${parsed.data.EMBEDDING_DIMENSIONS} but the chunks.embedding ` +
      `column is vector(${EMBEDDING_DIMENSIONS}).`,
  );
}

export const mcpEnv = {
  ...parsed.data,
  // The standard discovery path, unless the provider publishes it elsewhere.
  OIDC_JWKS_URI:
    parsed.data.OIDC_JWKS_URI ??
    (parsed.data.OIDC_ISSUER === undefined
      ? undefined
      : `${parsed.data.OIDC_ISSUER.replace(/\/$/, "")}/.well-known/jwks.json`),
};
