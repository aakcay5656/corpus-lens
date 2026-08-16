import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Database } from "@corpus-lens/db/client";
import { chunks } from "@corpus-lens/db/schema/chunks";
import { documents } from "@corpus-lens/db/schema/documents";
import { createDrizzleRetrievalRepository } from "@corpus-lens/db/retrieval-repository";
import { type EmbeddingProvider } from "@corpus-lens/rag/embeddings";
import { retrieve } from "@corpus-lens/rag/retriever";
import { type TokenCounter } from "@corpus-lens/rag/tokenizer";
import {
  QUERY_MAX_LENGTH,
  QUERY_MIN_LENGTH,
  TOP_K_DEFAULT,
  TOP_K_MAX,
  TOP_K_MIN,
} from "@corpus-lens/shared/limits";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { type McpCaller } from "./authenticate";

/**
 * The two tools, over the same retrieval code the REST API uses.
 *
 * `search_corpus` calls `retrieve()` from `packages/rag` against the Drizzle adapter in
 * `packages/db` — byte for byte what `POST /search` runs. Nothing about hybrid retrieval,
 * fusion or the candidate budget is reimplemented here; the only difference between the
 * two front doors is the transport and the shape of the reply.
 *
 * Bounds come from the shared limits module for the same reason they do on the API: an
 * unbounded `topK` is a denial-of-service vector against the embedding bill (CLAUDE.md
 * §9), and an MCP client is not a friendlier caller than a browser.
 *
 * **The tools a caller sees depend on who they are**, and that is a fix rather than a
 * flourish. `get_document` returns a document's entire text — which on the REST side is
 * `GET /documents/:id`, an `@Roles("ADMIN")` route. Authenticating the MCP caller and then
 * serving every tool regardless of role made this server a way for a `USER` to read exactly
 * what the API refuses them: the second front door granted more than the first. A `USER`
 * may search and cite passages, which is the capability the role model gives them.
 *
 * Registration is per request, because `main.ts` builds a server per request with the
 * caller already resolved. So the role decides what `tools/list` even contains — an
 * unauthorised tool is absent rather than present-and-refusing, which is the same reasoning
 * that keeps an unauthenticated caller from enumerating tool names at all.
 */
export interface ToolDependencies {
  db: Database;
  embeddings: EmbeddingProvider;
  tokenCounter: TokenCounter;
  caller: McpCaller;
}

export function registerTools(server: McpServer, deps: ToolDependencies): void {
  // Available to any authenticated caller: retrieval is what `USER` is for.
  registerSearchCorpus(server, deps);

  // Whole-document read, mirroring the API's admin-only document routes.
  if (deps.caller.role === "ADMIN") registerGetDocument(server, deps);
}

function registerSearchCorpus(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "search_corpus",
    {
      title: "Search the documentation corpus",
      description:
        "Hybrid semantic + keyword search over the indexed Markdown corpus. Returns passages " +
        "with their document title, heading breadcrumb and relevance score, so each result can " +
        "be cited. Use this before answering questions about the corpus; it retrieves evidence " +
        "rather than composing an answer.",
      inputSchema: {
        query: z
          .string()
          .trim()
          .min(QUERY_MIN_LENGTH)
          .max(QUERY_MAX_LENGTH)
          .describe("A natural-language question or phrase."),
        topK: z
          .number()
          .int()
          .min(TOP_K_MIN)
          .max(TOP_K_MAX)
          .default(TOP_K_DEFAULT)
          .describe(`How many passages to return (${TOP_K_MIN}–${TOP_K_MAX}).`),
        docType: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .optional()
          .describe("Restrict to one document type, e.g. delivery-report, guide, changelog."),
      },
    },
    async ({ query, topK, docType }) => {
      const { passages, timings } = await retrieve({
        repository: createDrizzleRetrievalRepository(deps.db),
        embeddingProvider: deps.embeddings,
        tokenCounter: deps.tokenCounter,
        query,
        topK,
        filters: docType === undefined ? {} : { docType },
      });

      if (passages.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No passages matched "${query}". The corpus may not cover this topic.`,
            },
          ],
        };
      }

      // Rendered as numbered text rather than raw JSON: the consumer is a language model,
      // and this is the same numbered-source shape the answering prompt uses, so a client
      // can cite [1], [2] against it directly.
      const rendered = passages
        .map(
          (passage, index) =>
            `[${index + 1}] ${passage.breadcrumb}\n` +
            `    source: ${passage.sourcePath} · score ${passage.score.toFixed(4)} ` +
            `(vector rank ${passage.vectorRank ?? "—"}, keyword rank ${passage.keywordRank ?? "—"})\n\n` +
            passage.content,
        )
        .join("\n\n---\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text:
              `${passages.length} passages for "${query}" ` +
              `(embed ${timings.embedMs}ms, retrieve ${timings.retrieveMs}ms)\n\n${rendered}`,
          },
        ],
      };
    },
  );
}

function registerGetDocument(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "get_document",
    {
      title: "Read a full document",
      description:
        "Fetch one document by id, with its metadata and complete text reassembled from its " +
        "chunks in reading order. Use after search_corpus when a passage is not enough context.",
      inputSchema: {
        id: z.uuid().describe("Document id, as returned in a search result's source path lookup."),
      },
    },
    async ({ id }) => {
      // Checked again here, even though a non-admin never gets this tool registered. The
      // guard above is a decision made in one place at construction time; this one survives
      // a later refactor that registers the tools unconditionally, which is precisely the
      // mistake being corrected. It is four lines to make the rule true at the point of use.
      if (deps.caller.role !== "ADMIN") {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "This tool requires an administrator." }],
        };
      }

      const document = await deps.db.query.documents.findFirst({
        where: eq(documents.id, id),
      });

      if (document === undefined) {
        // A tool error, not a thrown exception: the model asked for something that does
        // not exist, which it can recover from by searching again.
        return {
          isError: true,
          content: [{ type: "text" as const, text: `No document with id ${id}.` }],
        };
      }

      const rows = await deps.db
        .select({ content: chunks.content })
        .from(chunks)
        .where(eq(chunks.documentId, id))
        .orderBy(asc(chunks.ordinal));

      const metadata = [
        `title: ${document.title}`,
        `source: ${document.sourcePath}`,
        document.docType === null ? null : `type: ${document.docType}`,
        document.docDate === null ? null : `date: ${document.docDate}`,
        document.version === null ? null : `version: ${document.version}`,
        // Surfaced deliberately: the corpus contains a deprecated document alongside its
        // replacement, and a client that cannot see this will quote superseded guidance.
        document.lifecycle === null ? null : `lifecycle: ${document.lifecycle}`,
      ].filter((line): line is string => line !== null);

      return {
        content: [
          {
            type: "text" as const,
            text: `${metadata.join("\n")}\n\n${rows.map((row) => row.content).join("\n\n")}`,
          },
        ],
      };
    },
  );
}
