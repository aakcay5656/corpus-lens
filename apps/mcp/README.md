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

## OIDC (optional)

`MCP_AUTH_MODE=oidc` replaces the local bearer check with token validation against an
identity provider. The server then holds **no signing key at all** — it can verify a
credential but not create one, which is the property that makes delegated access
meaningful.

`local` remains the default deliberately. Making OIDC the only mode would mean the MCP
server could not be tried without first registering an application with a provider, and
that is a worse trade than the feature is worth. Both are implemented; the choice is one
variable.

```bash
MCP_AUTH_MODE=oidc
OIDC_ISSUER=https://your-tenant.eu.auth0.com/
OIDC_AUDIENCE=corpus-lens-mcp
# OIDC_JWKS_URI=            # defaults to ${OIDC_ISSUER}/.well-known/jwks.json
OIDC_ROLE_CLAIM=roles
OIDC_ADMIN_ROLE=admin
```

The server refuses to start if the issuer or audience is missing, rather than rejecting
every caller at request time with a confusing message.

### What is checked, and what each check stops

| Check | Without it |
|---|---|
| Signature against the provider's JWKS | Anyone can write their own token |
| `alg` pinned to RS/ES/PS | A token claiming `alg: none` is accepted; worse, `HS256` lets an attacker sign using the *public* key as the HMAC secret |
| `iss` exact match | A token from **any** OIDC provider on the internet is accepted — anyone can create a tenant and get one |
| `aud` exact match | A token the user legitimately holds for another application at the same provider is replayable here |
| `exp` / `nbf`, 5s tolerance | Expired tokens keep working |
| Role defaults to `USER` | A missing or malformed claim could produce an admin |

Keys are cached by `jose` and re-fetched when a token arrives with an unknown `kid`, so
provider key rotation needs no restart and unknown key ids cannot be used to hammer the
provider.

### Provider setup

**Auth0.** Create an API with identifier `corpus-lens-mcp` (this becomes `aud`). Issuer is
`https://<tenant>.<region>.auth0.com/` — with the trailing slash, which Auth0 includes in
`iss`. Roles need a custom claim added by an Action, so set
`OIDC_ROLE_CLAIM=https://corpus-lens/roles`.

**Keycloak.** Issuer is `https://<host>/realms/<realm>`; JWKS lives at
`${issuer}/protocol/openid-connect/certs`, so set `OIDC_JWKS_URI` explicitly. Realm roles
arrive nested, so `OIDC_ROLE_CLAIM=realm_access.roles`.

**Microsoft Entra ID.** Issuer `https://login.microsoftonline.com/<tenant>/v2.0`, audience
is the application (client) id. App roles land in `roles`, which is the default.

### Verified

13 tests in `src/oidc.test.ts`, all signing real tokens with a real RSA key pair — nothing
about the verifier is mocked:

```
valid token                      accepted, subject and email mapped
signed by a different key        rejected
issuer mismatch                  rejected
audience mismatch                rejected
expired / not-yet-valid          rejected
no subject                       rejected
alg: none (unsigned)             rejected
roles as array / space-separated  → ADMIN
realm_access.roles (nested path)  → ADMIN
missing, empty, wrong-typed, unrecognised, or wrong path → USER
```
