import { schema } from "@corpus-lens/db/client";
import { PACKAGE_NAME as RAG_PACKAGE } from "@corpus-lens/rag/package-info";
import { TOP_K_DEFAULT, TOP_K_MAX } from "@corpus-lens/shared/limits";
import { type Role } from "@corpus-lens/shared/role";
import { searchRequestSchema } from "@corpus-lens/shared/search";

/**
 * Scaffold placeholder. NestJS is installed in Step 8 together with the auth module, so
 * that every dependency arrives in the step whose code justifies it.
 *
 * What this file demonstrates today is the contract boundary: the same Zod schema the
 * browser derives its types from is what the API will validate requests with, and the
 * bounds it enforces are the constants, not numbers retyped in a controller.
 */
function main(): void {
  const adminRole: Role = "ADMIN";

  // The schema is the runtime validator. An over-large topK is rejected here rather than
  // reaching the embedding provider (CLAUDE.md §9).
  const rejected = searchRequestSchema.safeParse({ query: "hello", topK: TOP_K_MAX + 1 });

  console.log(`api scaffold — retrieval will come from ${RAG_PACKAGE}`);
  console.log(`tables visible from the db package: ${Object.keys(schema).join(", ")}`);
  console.log(`roles: ${adminRole}, default topK ${TOP_K_DEFAULT}, max ${TOP_K_MAX}`);
  console.log(`topK ${TOP_K_MAX + 1} accepted? ${rejected.success}`);
}

main();
