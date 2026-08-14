import { PACKAGE_NAME as RAG_PACKAGE } from "@corpus-lens/rag/package-info";

/**
 * Scaffold placeholder. The MCP SDK arrives in Step 13.
 *
 * The import below is the architectural claim of this repository in one line: the MCP
 * server calls the same @corpus-lens/rag retrieval code as the REST API rather than
 * reimplementing it.
 */
function main(): void {
  console.log(`mcp scaffold — retrieval comes from ${RAG_PACKAGE}`);
}

main();
