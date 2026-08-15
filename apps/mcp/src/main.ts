import { DEFAULT_CHUNK_OPTIONS } from "@corpus-lens/rag/chunker";

/**
 * Scaffold placeholder. The MCP SDK arrives in Step 13.
 *
 * The import below is the architectural claim of this repository in one line: the MCP
 * server calls the same @corpus-lens/rag code as the REST API rather than reimplementing
 * it. Step 13 swaps this import for the retriever; the direction is already correct.
 */
function main(): void {
  console.log(`mcp scaffold — chunking budget ${DEFAULT_CHUNK_OPTIONS.budgetTokens} tokens`);
}

main();
