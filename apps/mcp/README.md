# corpus-lens MCP server

Corpus search exposed as MCP tools over Streamable HTTP. The `search_corpus` tool calls
the same `retrieve()` in `packages/rag` — against the same Drizzle adapter in
`packages/db` — that `POST /search` runs. It is not a reimplementation of search; the only
difference between the two front doors is the transport.

Step 14 folds this into the root README. It lives here for now so the client config is
next to the server it configures.

## Running

```bash
pnpm --filter @corpus-lens/mcp run build
pnpm mcp                       # http://localhost:3002/mcp
```

It needs the same `.env` as the API — the same `DATABASE_URL`, the same embedding
settings, and the same `JWT_ACCESS_SECRET`. That last one is the point: a token minted by
`POST /auth/login` is exactly a token this server accepts.

## Authentication

Every request needs a bearer token. Get one from the API:

```bash
curl -s -X POST http://localhost:3001/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"user@demo.local","password":"user-demo-pw-2026"}' \
  -D - -o /dev/null | grep -i '^set-cookie: cl_access=' | sed 's/.*cl_access=//; s/;.*//'
```

`USER` is sufficient — searching the corpus is a `USER` capability on the API too. An
unauthenticated request is refused **before** the MCP handshake, so tool names are not
enumerable without a token.

Access tokens expire in 15 minutes by default. For a long-lived client session, raise
`ACCESS_TOKEN_TTL_SECONDS` in `.env`, or replace this check with OIDC (Step 17), which is
the reason the transport is HTTP rather than stdio.

## Client configuration

For any client that speaks Streamable HTTP — Claude Desktop, Claude Code, an SDK client:

```json
{
  "mcpServers": {
    "corpus-lens": {
      "type": "http",
      "url": "http://localhost:3002/mcp",
      "headers": {
        "Authorization": "Bearer <paste the access token here>"
      }
    }
  }
}
```

Claude Code can add it in one command:

```bash
claude mcp add --transport http corpus-lens http://localhost:3002/mcp \
  --header "Authorization: Bearer <token>"
```

## Tools

### `search_corpus`

| Argument  | Type   | Bounds                     | Notes                                        |
| --------- | ------ | -------------------------- | -------------------------------------------- |
| `query`   | string | 1–500 chars, required      | Natural-language question or phrase           |
| `topK`    | int    | 1–20, default 6            | Same bound the REST API enforces              |
| `docType` | string | optional, ≤64 chars        | `delivery-report`, `guide`, `changelog`, …    |

Returns numbered passages with the heading breadcrumb, source path, fused score and each
retrieval arm's rank — the same numbered-source shape the answering prompt uses, so a
client can cite `[1]`, `[2]` against it directly.

### `get_document`

| Argument | Type | Notes                                              |
| -------- | ---- | -------------------------------------------------- |
| `id`     | uuid | Document id; returns metadata plus the full text    |

Includes `lifecycle` in the metadata. The corpus deliberately contains a deprecated
document alongside its replacement, and a client that cannot see that will quote
superseded guidance as current.

## Verified

```
no token                    401 + WWW-Authenticate: Bearer realm="corpus-lens"
garbage token               401, tools not enumerable
initialize                  protocol 2025-06-18, capabilities: tools
tools/list                  search_corpus, get_document
search_corpus topK=999      rejected: "Too big: expected number to be <=20 at topK"
search_corpus docType=guide only guides/* returned
get_document unknown id     isError, no exception

same query via POST /search and via search_corpus → byte-identical results
```
