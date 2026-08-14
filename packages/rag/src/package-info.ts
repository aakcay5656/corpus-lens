import { PACKAGE_NAME as SHARED_PACKAGE_NAME } from "@corpus-lens/shared/package-info";

/**
 * Scaffold placeholder. Replaced in Step 4 by the chunker and embedding provider.
 *
 * Note what is absent: this package must never import @corpus-lens/db. Retrieval takes
 * a repository interface instead, which is what keeps it unit-testable without Postgres.
 */
export const PACKAGE_NAME = "@corpus-lens/rag";

export const DEPENDS_ON: readonly string[] = [SHARED_PACKAGE_NAME];
