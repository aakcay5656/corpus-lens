# corpus-lens

Semantic search and grounded RAG answers over a Markdown documentation corpus, with a
chat UI, an admin dashboard, and the same retrieval exposed as an MCP tool — all behind
JWT authentication with role-based authorization.

The system answers questions **only** from documents it has indexed, cites the exact
passage behind every claim, and says "not in the corpus" rather than guessing.

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Tech stack, and why](#tech-stack-and-why)
- [Setup](#setup)
- [Demo credentials](#demo-credentials)
- [Environment variables](#environment-variables)
- [API](#api)
- [MCP server](#mcp-server)
- [Design choices](#design-choices)
- [Evaluation](#evaluation)
- [Features](#features)
- [Deployment](#deployment)
- [Known limitations](#known-limitations)
- [Project documents](#project-documents)

---

## What it does

**Ingest.** Walks a directory of Markdown, chunks it on heading structure, embeds each
chunk, and stores documents, chunks, vectors and a full-text index in one Postgres
database. Re-running is cheap: unchanged files are skipped by content hash.

**Search.** Hybrid retrieval — vector similarity *and* Postgres full-text search, fused
with Reciprocal Rank Fusion.

**Answer.** Retrieved passages go to Claude as numbered sources with a strict grounding
prompt. Citation markers are validated server-side against the supplied context, and any
that point at a source the model was not given are removed. When the corpus does not cover
a question, the answer is an explicit refusal, not a hedge.

**Operate.** An admin dashboard shows what is indexed, what each ingestion run did, and
how retrieval is actually performing — abstain rate and zero-result queries being the
signals that say the corpus has a gap.

---

## Architecture

```
                    ┌──────────────┐         ┌──────────────┐
   browser ───────► │  apps/web    │ ──────► │  apps/api    │
                    │  Next.js 15  │  HTTP   │  NestJS      │
                    └──────────────┘         └──────┬───────┘
                                                    │
   MCP client ────────────────────────────►  ┌──────┴───────┐
   (Claude Desktop, Claude Code)             │  apps/mcp    │
                    Streamable HTTP + Bearer │  MCP SDK     │
                                             └──────┬───────┘
                                                    │
                              ┌─────────────────────┴─────────────────────┐
                              │            packages/rag                   │
                              │  chunking · embeddings · hybrid retrieval │
                              │  RRF fusion · prompting · answering       │
                              │  (no database import — takes interfaces)  │
                              └─────────────────────┬─────────────────────┘
                                                    │  RetrievalRepository
                              ┌─────────────────────┴─────────────────────┐
                              │            packages/db                    │
                              │  Drizzle schema · migrations · adapters   │
                              └─────────────────────┬─────────────────────┘
                                                    │
                                       ┌────────────┴────────────┐
                                       │  PostgreSQL 16          │
                                       │  + pgvector (HNSW)      │
                                       │  + tsvector (GIN)       │
                                       └─────────────────────────┘

   packages/shared — Zod schemas + inferred types, imported by every app
```

**The point of the monorepo is `packages/rag`.** `apps/api` and `apps/mcp` call the exact
same `retrieve()` over the exact same SQL adapter — the MCP tool is not a reimplementation
of search. The same query through both front doors returns byte-identical results.

Dependency direction is one-way: `apps/*` → `packages/*`. `packages/rag` never imports
`packages/db`; it receives a repository interface, which is why chunking, fusion, citation
validation and the abstain rule are all unit-tested with no database at all. The Drizzle
implementation of that interface lives in `packages/db` — the adapter depends on the port,
not the other way round.

---

## Tech stack, and why

| Layer | Choice | Reason |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Native TS project references, cheap task caching, no bundler ceremony |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` | One type language across the API boundary |
| Database | **PostgreSQL 16 + pgvector**, one instance | Documents, users, chunks, embeddings and analytics in one transactional store. No sync problem between a relational DB and a separate vector DB, and `tsvector` comes free — which is what makes hybrid retrieval nearly free to add |
| ORM | Drizzle | SQL-shaped and typed; does not fight the `<=>` vector operator or custom index DDL |
| API | NestJS + OpenAPI | Guards make role-based authorization declarative and auditable; the docs are generated from the same Zod schemas that validate requests |
| Frontend | Next.js 15 (App Router) + Tailwind 4 | Server-side route protection instead of client-side flicker |
| Embeddings | `text-embedding-3-small` (1536d) behind an `EmbeddingProvider` interface | Cheap, strong, batchable. The interface is real: an offline provider implements it too |
| Generation | Claude, behind a `ChatProvider` interface | Reliable instruction-following for the abstain and conflict rules |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP | Official SDK; HTTP is the transport that can carry a credential |
| Auth | JWT access + rotating refresh, argon2id, httpOnly cookies | No third-party dependency to explain; reuse detection is demonstrable |
| Validation | Zod in `packages/shared` | One definition is the contract, the runtime validator and the type |
| Tests | Vitest | 118 tests: chunking, RRF, citations, abstention, ingestion, auth |

---

## Setup

### Prerequisites

- **Node.js ≥ 20.11** (tested on 20.19)
- **pnpm 9** — `corepack enable && corepack prepare pnpm@9.15.4 --activate`
- **Docker** — for Postgres only; the apps run on the host

### The corpus

`sample_dataset/` is git-ignored and is **not** in this repository. Place the provided
corpus so that the Markdown files sit at:

```
sample_dataset/corpus/*.md
sample_dataset/corpus/delivery-reports/*.md   …and the other subfolders
```

`sample_questions.md` sits *outside* `corpus/` and must not be ingested. To point at a
different corpus, change `CORPUS_DIR` in `.env` — nothing else.

### Run it

```bash
git clone <repository-url> corpus-lens
cd corpus-lens

pnpm install
pnpm build                    # required: the workspace packages are consumed from dist/

cp .env.example .env
# Edit .env: set OPENAI_API_KEY and CHAT_API_KEY, or leave
# EMBEDDING_PROVIDER=deterministic to run with no API key at all (see below).

docker compose up -d          # Postgres 16 + pgvector on :5432
pnpm db:migrate               # create the schema
pnpm db:seed                  # create the two demo users
pnpm ingest                   # index the corpus (~140 documents)

pnpm dev                      # web :3000 · api :3001 · mcp :3002
```

Open <http://localhost:3000> and sign in with the credentials below.

**Running without any API key.** `EMBEDDING_PROVIDER=deterministic` is the default in
`.env.example`, and it makes ingestion, search, the dashboard and the MCP tool work with
no network and no credentials — useful for checking the system runs before spending
anything. It is a real provider, not a test stub, and it carries the same input and batch
limits as the hosted one so an offline run fails wherever an online one would. It matches
*vocabulary* rather than meaning, so **never read retrieval quality off a deterministic
run**; both the ingest and eval commands print a warning saying so. Asking questions is
the one feature that genuinely needs a key.

### Verify it worked

```bash
pnpm ask "What is the maximum file size for an AppLovin playable, and how does it ship?"
pnpm ask "How many vacation days do Lumen employees get per year?"   # must refuse
pnpm eval                                                            # retrieval scores
```

---

## Demo credentials

Created by `pnpm db:seed`. The values live in `.env.example`, so a reviewer can copy that
file and log in without inventing anything.

| Role | Email | Password | Can |
|---|---|---|---|
| **ADMIN** | `admin@demo.local` | `admin-demo-pw-2026` | Everything, plus the dashboard, documents and ingestion |
| **USER** | `user@demo.local` | `user-demo-pw-2026` | Search and ask |

These are demo accounts on a local database. Change them for any real deployment.

---

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://corpus:corpus@localhost:5432/rag` | Must agree with the `POSTGRES_*` values compose uses |
| `CORPUS_DIR` | `./sample_dataset/corpus` | The only thing tying the system to this corpus |
| `EMBEDDING_PROVIDER` | `deterministic` | `openai` for real quality; `deterministic` for no-key operation |
| `OPENAI_API_KEY` | — | Required when `EMBEDDING_PROVIDER=openai` |
| `OPENAI_BASE_URL` | OpenAI | Any gateway speaking `/v1/embeddings` — OpenRouter, Azure, vLLM |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Some gateways need a prefix, e.g. `openai/text-embedding-3-small` |
| `EMBEDDING_DIMENSIONS` | `1536` | Must match the `vector(n)` column; changing it needs a migration |
| `CHAT_MODEL` | `anthropic/claude-sonnet-5` | Only `/answer` needs this |
| `CHAT_BASE_URL` | falls back to `OPENAI_BASE_URL` | |
| `CHAT_API_KEY` | falls back to `OPENAI_API_KEY` | One gateway key usually covers both |
| `JWT_ACCESS_SECRET` | **required, ≥32 chars** | `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | **required, ≥32 chars, must differ** | Both are JWTs signed by this server; different keys are what stop a refresh token being replayed as an access token |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | |
| `REFRESH_TOKEN_TTL_SECONDS` | `604800` | |
| `WEB_ORIGIN` | `http://localhost:3000` | The single origin allowed credentialed CORS. Never `*` |
| `API_BASE_URL` | `http://localhost:3001` | Server-to-server: how Next reaches the API |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3001` | How the *browser* reaches the API |
| `WEB_PORT` / `API_PORT` / `MCP_PORT` | `3000` / `3001` / `3002` | |

Every variable is validated with Zod at startup, so a missing or malformed value fails the
process immediately rather than at first use.

---

## API

OpenAPI at **<http://localhost:3001/docs>** (JSON at `/docs-json`), generated from the same
Zod schemas that validate the requests — so the documentation cannot describe a contract
the server does not enforce.

Every route requires authentication except `POST /auth/{login,refresh,logout}`.
`/documents`, `/ingest` and `/stats` additionally require `ADMIN`.

| Method | Path | Role | |
|---|---|---|---|
| POST | `/auth/login` | public | Sets httpOnly `cl_access` + `cl_refresh` cookies |
| POST | `/auth/refresh` | public | Rotates the refresh token |
| POST | `/auth/logout` | public | Revokes and clears |
| GET | `/auth/me` | any | Current user |
| POST | `/auth/register` | ADMIN | No self-signup — it is a closed corpus |
| POST | `/search` | any | Hybrid retrieval, 30 req/min |
| POST | `/answer` | any | SSE stream, 10 req/min |
| GET | `/documents`, `/documents/:id` | ADMIN | Paginated, searchable |
| POST | `/ingest` | ADMIN | 202 + run id; runs in the background |
| GET | `/ingest/runs`, `/ingest/runs/:id` | ADMIN | Run history and events |
| GET | `/stats` | ADMIN | Dashboard aggregates |

### Examples

```bash
# Log in and keep the cookies
curl -s -c cookies.txt -X POST http://localhost:3001/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"user@demo.local","password":"user-demo-pw-2026"}'
```
```json
{"user":{"id":"…","email":"user@demo.local","role":"USER"},
 "accessTokenExpiresAt":"2026-08-16T00:15:00.000Z"}
```
Note there is no token in the body — it is in an httpOnly cookie, and repeating it here
would hand back exactly what that flag exists to withhold.

```bash
# Search
curl -s -b cookies.txt -X POST http://localhost:3001/search \
  -H 'content-type: application/json' \
  -d '{"query":"What is the maximum file size for an AppLovin playable?","topK":3}'
```
```json
{"query":"…","passages":[
  {"sourcePath":"network-specs-applovin.md","breadcrumb":"Network Specs: AppLovin [network-specs-applovin]",
   "score":0.0328,"vectorRank":1,"keywordRank":1,"content":"…"}],
 "timings":{"embedMs":551,"retrieveMs":14,"totalMs":565}}
```

```bash
# Answer (Server-Sent Events)
curl -sN -b cookies.txt -X POST http://localhost:3001/answer \
  -H 'content-type: application/json' \
  -d '{"question":"How do I initialize the current Lumen SDK, and what happened to lumen.track?"}'
```
```
event: token
data: {"token":"To initialize the current SDK (v3), call `LumenSDK.init(config)`…"}

event: result
data: {"answered":true,"text":"…","citations":[
        {"marker":1,"sourceIndex":0,"sourcePath":"sdk-notes-v3.md"},
        {"marker":2,"sourceIndex":1,"sourcePath":"sdk-notes-v2.md"}],
       "sources":[…],"abstainReason":null,
       "timings":{"embedMs":408,"retrieveMs":8,"generateMs":4860,"totalMs":5277}}
```

Errors are one shape everywhere, with no `details` or `stack` field to leak into:

```json
{"error":{"code":"FORBIDDEN","message":"You do not have access to this resource.",
          "requestId":"0f5c2a97-89f4-4f8f-a80b-21651c37fd72"}}
```

---

## MCP server

Full client config, the token recipe and the tool reference are in
**[`apps/mcp/README.md`](apps/mcp/README.md)**. In short:

```bash
pnpm --filter @corpus-lens/mcp run build
pnpm mcp                        # http://localhost:3002/mcp
```

```json
{
  "mcpServers": {
    "corpus-lens": {
      "type": "http",
      "url": "http://localhost:3002/mcp",
      "headers": { "Authorization": "Bearer <access token>" }
    }
  }
}
```

Get a token by reading the `cl_access` cookie out of a login response — the exact command
is in the MCP README. `USER` is sufficient. The server verifies it against the **same**
`JWT_ACCESS_SECRET` the API signs with and additionally looks the user up, so a deleted
account stops working immediately rather than when the token expires. Authentication runs
*before* the MCP handshake, so tool names are not enumerable without a token.

Tools: `search_corpus(query, topK, docType)` and `get_document(id)`.

---

## Design choices

### Chunking: structure first, size second

Split on Markdown headings; if a section exceeds the budget, split on paragraph then
sentence boundaries with overlap; never mid-sentence. Budget 500 tokens, overlap 60,
minimum 80.

The corpus was measured before any of this was written (`docs/CORPUS.md`): the largest
document is **217 tokens**, so the splitting machinery never fires and the **merge** pass
is what actually runs, collapsing each document into one chunk. The split path is written
and tested anyway, because pointing ingestion at another directory must keep working.
Tuning the budget down to fit a 23k-token sample would be overfitting.

### Every chunk carries a heading breadcrumb — with metadata

```
Delivery Report: Merge Marina, 2025-12 [delivery-report · 2025-12 · merge-marina]
> QA findings and fixes

<content>
```

A chunk saying "it must be rotated every 90 days" is unretrievable in isolation. But the
metadata in brackets is the higher-leverage half, and it comes from a measurement: the 78
delivery reports are assembled from **15 distinct sentences**. Their bodies are
near-identical, so their embeddings are near-identical, and what actually separates
`2025-05-bubble-bakery.md` from `2025-12-merge-marina.md` lives in the filename.

Measured: embedding all 142 chunks with and without the breadcrumb and querying *"Bubble
Bakery December 2025 delivery report"* — with it, all five top hits are Bubble Bakery
delivery reports; without it, **not one delivery report is in the top five**.

### Hybrid retrieval with RRF

Vector similarity (cosine, HNSW) and Postgres full-text search (`ts_rank`, GIN), 20
candidates each, fused with `score = Σ 1/(60 + rank)`. Top 6 go to the model.

**Why RRF rather than a weighted sum.** Cosine similarity and `ts_rank` are not comparable
quantities — one is dense in a narrow band, the other unbounded and routinely 0.05 for an
excellent match. Any weighted sum needs a normalisation that is itself a tuned guess and
that shifts silently the moment the embedding model changes. RRF reads only the *ordering*
each arm produced, so there is nothing to normalise and nothing to retune. `k = 60`
flattens the top ranks, so a document both arms rank reasonably beats one that a single
arm ranks first — which is what we want, because the arms fail in different directions.

**One thing worth knowing.** Every Postgres tsquery constructor joins its terms with AND,
so passing a question straight through demands that *every* lexeme appear in one 200-token
chunk — which matches nothing. The keyword arm returned zero rows for most of the
evaluation set before this was found, and hybrid retrieval was silently vector-only. The
query is rewritten to OR; `ts_rank` supplies the precision by scoring lexeme coverage.

### One store, not two

Documents, users, chunks, embeddings, ingestion history and query analytics live in one
Postgres instance. There is no synchronisation problem between a relational database and a
separate vector database, no second thing to back up, and `tsvector` comes free — which is
precisely what makes the keyword arm of hybrid retrieval nearly free to add.

`chunks.search_vector` is a **generated STORED** column, so the full-text index can never
drift from the content it indexes.

### Abstention, in two independent layers

1. **A retrieval score floor**, checked before the model is called — so an off-domain
   question costs one embedding instead of a generation. The floor is *derived*, not
   tuned: `1/(k+1) + 1/(k+candidates)` = 0.0289 is the score of a chunk ranked first by one
   arm and last-of-candidates by the other, so it asserts exactly one thing — both arms
   found something in common.
2. **An explicit prompt rule** returning a sentinel token, which the response layer turns
   into `answered: false`.

Neither is sufficient alone, and the data shows why: "how many vacation days" retrieves
`company-overview.md` at 0.0328 — well above the floor — because the company overview
genuinely *is* about the company. It just does not mention holidays. That one is caught by
the prompt; the fully off-domain question is caught by the floor at 0.0164 without the
model ever being called.

`answered` is a boolean on the wire so the UI renders abstention as its own state and the
abstain rate is a metric rather than a string search.

### Citations are validated server-side

The model is given numbered sources and must cite them. Markers are then resolved against
the context that was actually supplied, and any that point at a source the model was never
given are dropped from the citation list *and* removed from the prose. A dead reference is
worse than no reference: it still lends the sentence an air of having been sourced.

Markers are **not contiguous** after validation, and the model cites only what it used — a
real answer cited `[1][2][6]`. The UI resolves `marker → sourceIndex` rather than assuming
the nth citation is the nth source, which would silently link to the wrong document.

### Conflict and deprecation

The corpus deliberately contains `sdk-notes-v2.md` marked deprecated alongside
`sdk-notes-v3.md`. The prompt requires the answer to prefer the current source **and name
the supersession** rather than silently choosing. It works without extra plumbing, because
the breadcrumb puts the document title into the embedded text and those titles are "Lumen
SDK v3 (current)" and "Lumen SDK v2 (DEPRECATED)".

### Security

- argon2id (OWASP 19 MiB profile), never logged
- Access + **rotating** refresh tokens; refresh tokens stored hashed, and presenting an
  already-rotated one revokes the whole family — a stateless JWT can be rotated but reuse
  cannot be *detected*
- Both guards registered **globally**; routes opt out with `@Public()`, so a new endpoint
  is authenticated by default
- Every bound in one module: query length, `topK` 1–20, page size, password length. An
  unbounded `topK` is a denial-of-service against the LLM bill
- Rate limiting: 120/min global, 30/min on `/search`, 10/min on `/answer`
- The exception filter never uses an unrecognised exception's message — an ORM message can
  be an entire SQL statement, and a provider error body was found echoing an API key back
- `POST /ingest` does not accept a corpus directory from the client; that would be path
  traversal presented as a feature

---

## Evaluation

`eval/queries.yaml` holds 12 queries: the 5 shipped with the dataset, 4 added from the
corpus analysis to probe near-duplicates, and 3 that are out of corpus and must be refused.

```bash
pnpm eval
```

With `text-embedding-3-small`:

| Query | Expected document at |
|---|---|
| q1 AppLovin size limit | rank 1 |
| q2 SDK init / `lumen.track` | rank 1 |
| q3 audio in a separate pass | rank 2 |
| q4 March 2026 rejections | rank 1 |
| q5 minimum languages | rank 1 |
| q6 December Merge Marina | rank 4 |
| **q7 CTA contrast rule** | **miss** |
| q8 Meta vs Unity limits | rank 1 |
| q9 delivery review owner | rank 1 |

**8/9, and all five shipped dataset queries return their expected document at rank 1.**

q7 is a query I wrote myself, and it fails for a diagnosable reason rather than a mysterious
one. Asked *"Why does a low-contrast CTA keep coming up in delivery reports, and what is the
rule?"*, the phrase "delivery reports" activates the 78-document cluster in **both** arms —
all 40 candidates come back as delivery reports and `style-guide-ui.md` sits at vector rank
69, keyword rank 86. The same document ranks **1st in both arms** for "What is the CTA
contrast rule?". It is a multi-intent query, and the fix is query decomposition or
reranking, both listed under [next steps](#known-limitations).

Worth recording: `docs/CORPUS.md` predicted this crowding *and* pre-committed to a
`doc_type` prior as the remedy. Measured, that would not have worked — the style guide never
reaches fusion, so no fusion-stage rule can promote it. The prior was not added.

---

## Features

- [x] Ingestion from a configurable directory, idempotent by content hash
- [x] Hybrid retrieval (vector + full-text) with RRF
- [x] Grounded answers with server-validated citations
- [x] Two-layer abstention with `answered` as a first-class state
- [x] Conflict / deprecation handling
- [x] Streaming answers over SSE
- [x] Chat UI with interactive citation chips
- [x] Admin dashboard: index health, documents, ingestion runs, search analytics
- [x] JWT auth, argon2id, rotating refresh with reuse detection, role-based guards
- [x] MCP server over Streamable HTTP, authenticated
- [x] OpenAPI generated from the Zod contracts
- [x] Rate limiting
- [x] Evaluation harness over a fixed query set
- [x] **Bonus** — offline embedding provider: the whole system runs with no API key
- [x] **Bonus** — configurable provider base URL (OpenRouter / Azure / self-hosted)
- [ ] **Bonus** — incremental re-indexing with a file watcher (hash comparison is done; the
      watcher is not)
- [ ] **Bonus** — OIDC for the MCP server (the transport and the `WWW-Authenticate` hook are
      in place)
- [ ] **Bonus** — live deployment

---

## Deployment

Nothing here is deployed. What it would take:

- **Database** — any Postgres 16 with pgvector (Neon, Supabase, RDS + extension). Run
  `pnpm db:migrate` against it; `CREATE EXTENSION vector` needs superuser and lives in
  `docker/init-pgvector.sql` rather than in a migration for that reason.
- **API** — `pnpm --filter @corpus-lens/api run build` then `node dist/main.js`. Needs
  `DATABASE_URL`, both JWT secrets, the provider keys and `WEB_ORIGIN` set to the real web
  origin.
- **Web** — `next build` / `next start`, or Vercel. `API_BASE_URL` is server-to-server;
  `NEXT_PUBLIC_API_BASE_URL` is what the browser uses, and in a real deployment those two
  are usually different hosts.
- **MCP** — same build/run shape as the API, with the same `JWT_ACCESS_SECRET`.
- **Cookies** — `NODE_ENV=production` turns on the `Secure` flag. If web and API end up on
  different sites (not merely different ports), `SameSite=Lax` will stop sending cookies
  and they need `SameSite=None; Secure` plus a shared parent domain.

---

## Known limitations

Honest list. Each of these is a decision, not an oversight.

**Retrieval**
- Multi-intent questions retrieve for whichever intent dominates the vocabulary (see q7).
  Query decomposition or LLM reranking of the fused top 20 is the fix.
- HNSW is left at its defaults. With 142 chunks, tuning numbers that cannot be measured at
  this scale would be theatre.
- Chunk parameters are deliberately *not* fitted to this corpus.

**Operations**
- The concurrent-ingestion guard is an in-process flag. Correct for one instance, wrong for
  two.
- Rate limiting is in-memory per instance, so limits multiply by replica count.
- Expired refresh tokens are never purged. Harmless — they are rejected on expiry — but the
  table grows.
- `GET /ingest/runs/:id` caps events at 500. The UI says so rather than implying the list
  is complete.

**Product**
- No document upload; ingestion reads a directory. `POST /ingest` deliberately refuses to
  take a path from the client.
- No user-management screen. Admins create users via `POST /auth/register`.
- Chat has no conversation history — each question is independent. Follow-ups like "what
  about the other one?" will not work.
- Dark mode follows the operating system with no toggle, because there is no preference
  store to remember a choice in.

**Verification**
- The UI was built mobile-first and checked at composition level — no fixed pixel widths,
  tables scroll inside their own container, 44px touch targets — but **not opened in a real
  browser at 375px**.
- The MCP server was driven with the real protocol by hand, but **no GUI MCP client has
  been attached**. The 15-minute default token lifetime is the part most likely to need
  adjusting there.

### What I would do next, in order

1. **Query decomposition** for multi-intent questions — the one measured retrieval failure.
2. **A file watcher** on the corpus directory; the hash-based classification already exists.
3. **OIDC on the MCP server**, replacing the bearer check. The transport was chosen for it.
4. **Reranking** the fused top 20 with a cross-encoder or the LLM.
5. **Conversation history** in chat, with the previous turn folded into retrieval.

---

## Project documents

| File | What it is |
|---|---|
| [`docs/CORPUS.md`](docs/CORPUS.md) | Corpus analysis, written before any chunking code, with the measurements that justify the parameters |
| [`docs/ADR.md`](docs/ADR.md) | Design decision records — the substantial choices and their reasons |
| [`AI_USAGE.md`](AI_USAGE.md) | Honest account of where AI assistance was used, what it got wrong, and how each was caught |
| [`apps/mcp/README.md`](apps/mcp/README.md) | MCP client config and tool reference |
| `PLAN.md` / `STATE.md` | The step plan and its running state |

### Commands

| Command | |
|---|---|
| `pnpm dev` | All three apps in watch mode |
| `pnpm build` · `pnpm typecheck` · `pnpm test` · `pnpm lint` | 118 tests |
| `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:studio` | Schema, demo users, Drizzle Studio |
| `pnpm ingest [--dir <path>] [--force] [--quiet]` | Index a corpus |
| `pnpm ask "question" [--sources]` | Grounded answer from a terminal; `--sources` shows what the model saw |
| `pnpm eval` | Retrieval evaluation; exits non-zero on a miss |
| `pnpm mcp` | The MCP server |
