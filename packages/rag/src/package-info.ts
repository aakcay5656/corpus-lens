import { TOP_K_DEFAULT } from "@corpus-lens/shared/limits";

/**
 * Scaffold placeholder. Replaced in Step 4 by the chunker and embedding provider.
 *
 * The import is real work, not decoration: retrieval defaults to the same top-K the API
 * validates against, so the two cannot drift.
 *
 * Note what is absent: this package must never import @corpus-lens/db. Retrieval takes a
 * repository interface instead, which is what keeps it unit-testable without Postgres.
 */
export const PACKAGE_NAME = "@corpus-lens/rag";

export const DEFAULT_TOP_K = TOP_K_DEFAULT;
