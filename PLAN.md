# PLAN.md

Execution plan. **One step per turn**, then stop and wait — see `CLAUDE.md` §2.
Current position is tracked in `STATE.md`.

Priorities: **P0** = the case fails without it. **P1** = expected quality.
**P2** = bonus, only after every P0 and P1 is done and verified.

Suggested pacing against the two-day timebox:
Day 1 → Steps 0–7 (everything server-side, retrieval proven before any UI exists).
Day 2 → Steps 8–13, then bonuses with whatever remains.

---

## Phase A — Foundation

### Step 0 · Corpus recon — P0

No code. Read the corpus and let it drive the chunking decision instead of guessing.

**Do:** enumerate `sample_dataset/`; count files and total size; sample 5–8 files in
full; identify structure (front-matter? heading depth? tables? code blocks? consistent
schema?); measure length distribution in tokens and heading-section sizes; collect the
example queries shipped with the dataset into `eval/queries.yaml`.

**Write:** `docs/CORPUS.md` — what the corpus is, what its shape implies, the proposed
chunking parameters *with the observed numbers that justify them*, and the metadata
worth storing per document. State clearly if the observations contradict the defaults
in `CLAUDE.md` §6, and propose the change.

**Done when:** I can read `docs/CORPUS.md` and know why the chunk size is what it is.

**Commit**
```
docs: analyse sample corpus and derive chunking strategy

Enumerate the provided Markdown corpus, measure section and document
length distributions, and record the chunking parameters these
observations support. Collect the shipped example queries into an
evaluation query set for later use.
```

---

### Step 1 · Monorepo scaffold — P0

pnpm workspaces + Turborepo. Empty but wired `apps/api`, `apps/web`, `apps/mcp`,
`packages/{shared,db,rag}`. Base `tsconfig` with `strict` and project references,
shared ESLint + Prettier, root scripts (`dev`, `build`, `lint`, `test`, `typecheck`),
`docker-compose.yml` with Postgres 16 + pgvector, `.env.example`, `.gitignore`
including `sample_dataset/`.

**Done when:** `pnpm install && pnpm typecheck && pnpm lint` passes clean and
`docker compose up -d` gives a reachable Postgres with the `vector` extension.

**Commit**
```
chore(repo): scaffold pnpm and turborepo workspace

Set up the workspace structure, shared TypeScript and lint config, and a
Postgres + pgvector service for local development. Apps and packages are
empty placeholders wired for cross-workspace type sharing.
```

---

### Step 2 · Database schema — P0

`packages/db`: Drizzle schema, migrations, seed.

Tables: `users` (email, argon2 hash, role, timestamps) · `documents` (source path,
title, content hash, metadata jsonb, status, indexed_at) · `chunks` (document_id,
ordinal, heading breadcrumb, content, token count, `vector(1536)` embedding, tsvector
generated column) · `ingestion_runs` (started/finished, trigger source, counts of
added/updated/removed/failed, status) · `ingestion_events` (run_id, document, phase,
level, message) · `search_queries` (user_id, text, latency split, top score, k,
abstained, created_at).

Indexes: HNSW on the embedding (cosine), GIN on the tsvector, unique on document
source path, index on `chunks.document_id`.

Seed: `admin@demo.local` and `user@demo.local` with known passwords, both written into
`.env.example` and later the README.

**Done when:** migrations apply from empty, seed is idempotent, `pnpm db:studio`
shows the tables.

**Commit**
```
feat(db): add schema, migrations and demo user seed

Model documents, chunks with pgvector embeddings, ingestion runs and
query logs in a single Postgres instance. Chunks carry both an HNSW
cosine index and a generated tsvector with a GIN index so hybrid
retrieval can be served from one store.
```

---

### Step 3 · Shared contracts — P0

`packages/shared`: Zod schemas for auth, search request/response, answer request/
response (including `answered`, `citations`, `sources`), document and ingestion DTOs,
the error envelope, and the role enum. Export inferred types. No logic here.

**Done when:** `apps/api` and `apps/web` can both import a type and the compiler
enforces it across the boundary.

**Commit**
```
feat(shared): define zod contracts for the API boundary

Schemas are the single source of truth: the API validates requests with
them and both sides derive their TypeScript types from the same
definitions, so a contract change breaks the build rather than
production.
```

---

## Phase B — The RAG core

### Step 4 · Chunking + embeddings — P0

`packages/rag`:
- `chunker.ts` — Markdown-aware structural chunking per `CLAUDE.md` §6 and the
  parameters agreed in Step 0. Emits heading breadcrumbs. Never splits a code fence.
- `embeddings.ts` — `EmbeddingProvider` interface, OpenAI implementation with batching,
  timeout, one retry, and a token-aware batch size cap.
- Vitest: headings preserved, overlap correct, code fence intact, oversized section
  split, empty and single-line documents survive.

**Done when:** tests pass and a real sample file chunked by hand-eye looks sensible —
print three chunks in the completion report so I can judge them.

**Commit**
```
feat(rag): add markdown-aware chunker and embedding provider

Chunk on heading structure first and size second, prefixing each chunk
with its heading breadcrumb so retrieved fragments stay interpretable
out of context. Embeddings sit behind an interface to keep the model
choice swappable.
```

---

### Step 5 · Ingestion pipeline — P0

CLI: `pnpm ingest --dir ./sample_dataset`. Walks the directory, parses front-matter,
computes a content hash, chunks, embeds in batches, writes documents and chunks in a
transaction per document, and records an `ingestion_run` plus per-document events.

Repeatable and observable: re-running is safe (unchanged documents skipped by hash),
progress is logged, and one failing document is recorded as failed while the run
continues. Print a summary table at the end.

**Done when:** the full sample corpus ingests, the run row shows accurate counts, and
running it twice produces zero re-embeddings the second time.

**Commit**
```
feat(ingest): add repeatable, observable ingestion pipeline

Walk a configurable corpus directory, chunk and embed each document, and
persist the result under a tracked ingestion run. Content hashing makes
re-runs idempotent and per-document failures are recorded without
aborting the batch.
```

---

### Step 6 · Hybrid retrieval — P0

`packages/rag/retriever.ts`: vector search (cosine, HNSW) and full-text search
(`ts_rank`) in parallel, ~20 candidates each, fused with RRF (k = 60), deduplicated by
chunk, returning chunk text, breadcrumb, document reference, and both raw ranks plus
the fused score. Retrieval takes a repository interface — no direct DB import.

Then run `eval/queries.yaml` against it and **print the results in the completion
report**. If a known-answerable query does not surface its document in the top 6, fix
retrieval before moving on. This is the step the whole case is graded on.

**Done when:** every example query returns its expected document in the top results,
and I have seen the numbers.

**Commit**
```
feat(rag): add hybrid retrieval with reciprocal rank fusion

Combine vector similarity with Postgres full-text search and fuse the
two rankings with RRF, which needs no score normalisation between
incomparable scales. Keyword recall covers the exact identifiers that
embeddings blur; vectors cover the paraphrases keywords miss.
```

---

### Step 7 · Grounded answering — P0

`packages/rag/answer.ts`: build the numbered-source prompt, call the `ChatProvider`,
stream tokens, parse and **validate** citation markers against the supplied context,
and return `{ answered, text, citations, sources, timings }`.

Two-layer abstention: score floor before the model call, plus an explicit prompt rule.
Vitest against a stubbed provider: cites correctly, abstains on an empty context,
drops a hallucinated citation number.

**Done when:** an in-corpus question answers with valid citations and an out-of-corpus
question returns `answered: false` — demonstrate both in the report.

**Commit**
```
feat(rag): generate grounded answers with validated citations

Answers are built only from retrieved chunks and must cite them by
index; markers are validated server-side against the context so a
hallucinated citation is dropped rather than rendered. A score floor
and an explicit prompt rule make "not in the corpus" a real response
state instead of a hedge.
```

---

## Phase C — API

### Step 8 · Auth and authorization — P0

NestJS auth module: register (admin-only), login, refresh, logout, `/me`. Argon2id
hashing, JWT access + rotating refresh, httpOnly cookies, `JwtAuthGuard`,
`RolesGuard` + `@Roles()` decorator, `@Public()` for open routes. Zod validation pipe
using `packages/shared`. Global exception filter and request-id middleware.

Tests: `USER` token gets 403 on an admin-only route; expired token gets 401.

**Done when:** those two tests pass and no route is reachable unauthenticated except
login and refresh.

**Commit**
```
feat(api): add JWT authentication with role-based guards

Authorization is enforced by guards on every route rather than by the
UI, with a rotating refresh token in an httpOnly cookie. Tests assert
that a regular user is refused on admin routes.
```

---

### Step 9 · API endpoints — P0

- `POST /search` — authenticated, returns passages (user + admin)
- `POST /answer` — authenticated, streams the grounded answer (SSE)
- `GET /documents`, `GET /documents/:id` — admin
- `POST /ingest` — admin, triggers a run; `GET /ingest/runs`, `GET /ingest/runs/:id`
- `GET /stats` — admin: document/chunk counts, index health, last run, query volume,
  p50/p95 latency, abstain rate, top queries
- Swagger at `/docs`, rate limiting on search and answer, every query logged.

**Done when:** the full flow works from `curl`, `/docs` renders, and rate limiting
visibly triggers.

**Commit**
```
feat(api): expose search, answering and admin endpoints

Wire the retrieval package into REST routes with streamed answers,
admin-only corpus and ingestion management, and system statistics read
from the query log. OpenAPI is generated from the same decorators that
enforce validation.
```

---

## Phase D — Web

### Step 10 · App shell and auth flow — P0

Next.js App Router + Tailwind. Login page, session handling against the API,
middleware-protected routes, layout with role-aware navigation, dark-mode-safe theme,
shared UI primitives (button, input, card, badge, skeleton, empty state, error state).
Mobile-first; verify 375 / 768 / 1280.

**Commit**
```
feat(web): add app shell, authentication flow and UI primitives

Route protection lives in middleware so an unauthenticated user never
renders a protected view, and the shared primitives give the chat and
dashboard consistent loading, empty and error states.
```

---

### Step 11 · Chat page — P0

Question input, streamed answer, inline citation chips that scroll to or expand the
matching source, retrieved passages with document title, breadcrumb and score, a
distinct rendering for the abstain case, latency shown, error and empty states,
keyboard-submit, fully responsive.

**Done when:** I can ask an in-corpus and an out-of-corpus question on a phone-width
viewport and both look intentional.

**Commit**
```
feat(web): add chat page with streaming answers and citations

Citations are interactive and resolve to the exact retrieved passage, so
a user can verify any claim against its source. Abstention renders as
its own state rather than as an apologetic paragraph.
```

---

### Step 12 · Dashboard — P0

Admin-only. Document table (title, source, chunks, status, indexed at, search/filter/
paginate), document detail with its chunks, ingestion runs with per-run events and a
"run ingestion" action that reflects live status, index health card, and search
analytics (volume over time, p50/p95 latency, abstain rate, top queries, zero-result
queries).

**Commit**
```
feat(web): add admin dashboard for corpus and system observability

Surface what is indexed, what each ingestion run did, and how retrieval
is actually performing — abstain rate and zero-result queries are the
signals that tell an operator the corpus has a gap.
```

---

### Step 13 · MCP server — P0

`apps/mcp` using `@modelcontextprotocol/sdk` over Streamable HTTP. Tools:
`search_corpus` (query, topK, optional filters → passages with citations) and
`get_document` (id → metadata + content). Same `packages/rag` code path as the API —
say so in the README. Authenticated: bearer token in the request, validated against
the same user store, `USER` role sufficient for search. Input validated with the
shared Zod schemas.

**Done when:** it is connected from a real MCP client, the tool returns results, and
the README contains the exact working client config.

**Commit**
```
feat(mcp): expose corpus search as an authenticated MCP tool

The MCP server calls the same retrieval package as the REST API rather
than reimplementing it, which is the concrete payoff of the monorepo
layout. Callers must present a valid token, so the tool is not a second
unauthenticated door into the corpus.
```

---

## Phase E — Communication

### Step 14 · Documentation — P0

`README.md`: project description · architecture diagram (ASCII is fine) · tech stack ·
prerequisites · install → docker → migrate → seed → ingest → run, verbatim and
tested · demo credentials for both roles · env var table · API documentation with
example requests · MCP client config · design choices with reasons (chunking, hybrid
retrieval, RRF, single-store, abstention) · features list marking bonuses ·
deployment section · known limitations and what I would do next.

Also finalise `AI_USAGE.md` and `docs/ADR.md`.

**Then:** re-run the entire README on a clean clone and a fresh database. If any step
is missing, the README is wrong, not the reader.

**Commit**
```
docs: add README, AI usage log and design decision records

Document a fresh-machine setup verified against a clean clone, the
reasoning behind the retrieval and storage choices, and an honest
account of where AI assistance helped and where it had to be corrected.
```

---

## Phase F — Bonuses (only after everything above is green)

### Step 15 · Self-updating ingestion — P2, high value
Compare on-disk content hashes against the stored manifest to classify documents as
new / changed / removed; re-embed only changed ones and delete orphaned chunks. Add a
`chokidar` watch mode and a scheduled run. Log every incremental run like a full one.
```
feat(ingest): keep the index current with incremental re-indexing

Classify documents by content hash so only new and changed files are
re-embedded and removed files are purged, replacing full rebuilds with
a cheap incremental pass.
```

### Step 16 · Evaluation harness — P2, cheap and persuasive
`pnpm eval` over `eval/queries.yaml`: recall@k, MRR, abstain accuracy on deliberately
out-of-corpus questions; compare vector-only vs. keyword-only vs. hybrid and put the
table in the README. Numbers turn a design claim into evidence.
```
test(rag): add retrieval evaluation harness

Measure recall@k, MRR and abstention accuracy across a fixed query set
and compare vector-only, keyword-only and hybrid retrieval so the
design choice is backed by numbers rather than assertion.
```

### Step 17 · OIDC for MCP — P2, "significant bonus"
Replace the bearer token with OIDC: validate the ID/access token against a provider's
JWKS, check issuer, audience and expiry, map claims to a role, cache JWKS. Document
the provider setup.
```
feat(mcp): protect the MCP server with OIDC authorization

Validate caller tokens against the provider JWKS with issuer and
audience checks, so tool access is delegated to an identity provider
instead of a shared secret.
```

### Step 18 · Live deployment — P2
Deploy API + web + Postgres/pgvector (Fly.io, Railway, or Neon + Vercel). Seed and
ingest against it. Put the URL and the credentials in the README.
```
chore: deploy the stack and document the setup
```

### Step 19 · Polish — P2
Result highlighting of matched terms, query rewriting, LLM reranking of the fused top
20, user management screen for admins. One at a time, each its own commit.

---

## Cut list

If time runs short, sacrifice in this order — and write what was cut, and why, in the
README's limitations section. An acknowledged gap costs less than a broken feature.

1. All of Phase F
2. Dashboard analytics charts → plain numbers
3. Answer streaming → single response
4. Document detail view → table only
