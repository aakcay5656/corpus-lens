import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Database } from "@corpus-lens/db/client";
import { type EmbeddingProvider } from "@corpus-lens/rag/embeddings";
import { type TokenCounter } from "@corpus-lens/rag/tokenizer";
import { describe, expect, it } from "vitest";

import { type McpCaller } from "./authenticate";
import { registerTools, type ToolDependencies } from "./tools";

/**
 * Which tools a caller gets, by role.
 *
 * This is the regression test for a real hole: `get_document` returns a document's whole
 * text, which on the REST side is an `@Roles("ADMIN")` route, and the MCP server used to
 * hand it to anyone with a valid token. Authenticating a caller is not authorising them,
 * and a second front door that grants more than the first undoes the guards on the first.
 */

interface CapturedTool {
  handler: (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: unknown }>;
}

function fakeServer(): { server: McpServer; tools: Map<string, CapturedTool> } {
  const tools = new Map<string, CapturedTool>();
  const server = {
    registerTool(name: string, _config: unknown, handler: CapturedTool["handler"]): void {
      tools.set(name, { handler });
    },
  };
  // The real McpServer carries far more surface than these tools touch; capturing the
  // registration is the whole point of the double.
  return { server: server as unknown as McpServer, tools };
}

function deps(role: McpCaller["role"]): ToolDependencies {
  return {
    // Never reached: every assertion below stops at the role check. A stub that would
    // throw on use is deliberate — if a test ever gets past the guard, it fails loudly
    // rather than quietly querying nothing.
    db: undefined as unknown as Database,
    embeddings: undefined as unknown as EmbeddingProvider,
    tokenCounter: undefined as unknown as TokenCounter,
    caller: { id: "caller-1", email: "someone@test.local", role },
  };
}

describe("registerTools", () => {
  it("gives an ADMIN both tools", () => {
    const { server, tools } = fakeServer();
    registerTools(server, deps("ADMIN"));

    expect([...tools.keys()].sort()).toEqual(["get_document", "search_corpus"]);
  });

  it("gives a USER search only, and does not even list the document reader", () => {
    const { server, tools } = fakeServer();
    registerTools(server, deps("USER"));

    // Absent rather than present-and-refusing: a tool a caller may not invoke is
    // information about the system they have no claim to.
    expect([...tools.keys()]).toEqual(["search_corpus"]);
  });

  it("refuses a non-admin inside the handler, not only at registration", async () => {
    const { server, tools } = fakeServer();
    const dependencies = deps("ADMIN");
    registerTools(server, dependencies);

    // The handler reads the role when it runs, so demoting the caller after registration
    // is a faithful stand-in for a future refactor that registers the tools before knowing
    // who is calling. If the second check were removed, this would reach the database stub
    // and throw instead of returning a tool error.
    dependencies.caller.role = "USER";

    const result = await tools
      .get("get_document")
      ?.handler({ id: "00000000-0000-0000-0000-000000000000" });

    expect(result?.isError).toBe(true);
  });
});
