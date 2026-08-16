import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createDatabase } from "@corpus-lens/db/client";
import { createEmbeddingProvider } from "@corpus-lens/rag/embedding-provider-factory";
import { createTokenCounter } from "@corpus-lens/rag/tokenizer";
import express, { type Request, type Response } from "express";

import { UnauthenticatedError, authenticate } from "./authenticate";
import { mcpEnv } from "./env";
import {
  DEFAULT_MCP_RATE_LIMIT,
  DEFAULT_MCP_RATE_WINDOW_MS,
  createRateLimiter,
} from "./rate-limit";
import { registerTools } from "./tools";

/**
 * The MCP server: corpus search as a tool, over Streamable HTTP.
 *
 * Streamable HTTP rather than stdio because CLAUDE.md §3 wants the transport that admits
 * an OIDC story later — a stdio server has no request to carry a token on, so
 * authenticating it means inventing something. Over HTTP the credential is an ordinary
 * `Authorization` header, and swapping the JWT check for OIDC (Step 17) touches one file.
 *
 * The architectural claim of the whole repository is visible here: `search_corpus` calls
 * `retrieve()` from `packages/rag` against the Drizzle adapter in `packages/db` — the
 * same code `POST /search` runs. The MCP tool is not a reimplementation of search.
 */
async function main(): Promise<void> {
  const { db, close } = createDatabase({ url: mcpEnv.DATABASE_URL, maxConnections: 4 });

  const embeddings = createEmbeddingProvider({
    kind: mcpEnv.EMBEDDING_PROVIDER,
    dimensions: mcpEnv.EMBEDDING_DIMENSIONS,
    model: mcpEnv.EMBEDDING_MODEL,
    apiKey: mcpEnv.OPENAI_API_KEY,
    baseUrl: mcpEnv.OPENAI_BASE_URL,
  });
  const tokenCounter = createTokenCounter();

  const rateLimiter = createRateLimiter({
    limit: DEFAULT_MCP_RATE_LIMIT,
    windowMs: DEFAULT_MCP_RATE_WINDOW_MS,
  });

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.post("/mcp", (request, response) => {
    void handleMcpRequest(request, response);
  });

  /**
   * A fresh server and transport per request, in stateless mode.
   *
   * The alternative is a long-lived session keyed by `mcp-session-id`, which would mean
   * holding the caller's identity in a map and deciding when to evict it. Stateless means
   * every request carries its own token and is authenticated on its own merits — there is
   * no session to outlive a revoked user, and no server-side state to get wrong.
   */
  async function handleMcpRequest(request: Request, response: Response): Promise<void> {
    let transport: StreamableHTTPServerTransport | undefined;
    let server: McpServer | undefined;

    try {
      // Before anything MCP-shaped happens. An unauthenticated caller must not be able to
      // enumerate tool names, which is information about the system it has no claim to.
      const caller = await authenticate(request, db);

      // After authentication, so the budget belongs to an account rather than to an
      // address, and so an unauthenticated flood is rejected on the cheaper check first —
      // the same ordering the API uses for its global guards (apps/api/src/app.module.ts).
      const decision = rateLimiter.check(caller.id);
      if (!decision.allowed) {
        response
          .status(429)
          .set("Retry-After", String(decision.retryAfterSeconds))
          .json(
            jsonRpcError(-32000, `Rate limit exceeded. Retry in ${decision.retryAfterSeconds}s.`),
          );
        return;
      }

      server = new McpServer({ name: "corpus-lens", version: "0.1.0" });
      registerTools(server, { db, embeddings, tokenCounter, caller });

      transport = new StreamableHTTPServerTransport({
        // Stateless: no session ids to track.
        sessionIdGenerator: undefined,
      });

      // Closing the transport when the response ends is what stops a per-request server
      // from leaking. Without it every call would leave a listener attached for the life
      // of the process.
      response.on("close", () => {
        void transport?.close();
        void server?.close();
      });

      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        // `WWW-Authenticate` is what tells a client *how* to authenticate rather than
        // just that it failed, and it is the hook an OIDC flow advertises itself through.
        response
          .status(401)
          .set("WWW-Authenticate", 'Bearer realm="corpus-lens"')
          .json(jsonRpcError(-32001, error.message));
        return;
      }

      console.error("mcp request failed:", error instanceof Error ? error.message : error);
      if (!response.headersSent) {
        // Deliberately generic: the caller gets a code, the operator gets the log line.
        response.status(500).json(jsonRpcError(-32603, "Internal server error."));
      }
    }
  }

  const listener = app.listen(mcpEnv.MCP_PORT, () => {
    console.log(`MCP server listening on http://localhost:${mcpEnv.MCP_PORT}/mcp`);
    console.log(`embedding: ${embeddings.model}`);
  });

  const shutdown = (): void => {
    listener.close(() => {
      void close().then(() => process.exit(0));
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** JSON-RPC error envelope, which is the shape an MCP client knows how to read. */
function jsonRpcError(code: number, message: string): unknown {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
