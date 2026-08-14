import { schema } from "@corpus-lens/db/client";
import { PACKAGE_NAME as RAG_PACKAGE } from "@corpus-lens/rag/package-info";
import { PACKAGE_NAME as SHARED_PACKAGE } from "@corpus-lens/shared/package-info";

/**
 * Scaffold placeholder. NestJS is installed in Step 8 together with the auth module, so
 * that every dependency arrives in the step whose code justifies it.
 *
 * For now this file only proves the API can see the packages it will depend on, and that
 * the database schema crosses the workspace boundary as real types.
 */
function main(): void {
  console.log(`api scaffold — contracts from ${SHARED_PACKAGE}, retrieval from ${RAG_PACKAGE}`);
  console.log(`tables visible from the db package: ${Object.keys(schema).join(", ")}`);
}

main();
