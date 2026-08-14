# CLAUDE.md

Operating instructions for Claude Code on this repository. Read this file fully before
the first action of every session, then read `STATE.md` to find out where we are.

---

## 1. What this is

A take-home case study for an **AI Software Engineer** position at Playable Factory.

Build a TypeScript monorepo that ingests a corpus of documents into a vector store,
serves **semantic search + grounded RAG answers with citations**, exposes two web
surfaces (Chat, Dashboard), exposes search as an **MCP server**, and gates everything
behind **authentication and role-based authorization**.

**Timebox: about two days of work.** A smaller system that works end to end beats a
large one that half-works. When in doubt, cut scope, not quality.

**Evaluated equally on:** retrieval/RAG quality · monorepo & system architecture ·
code quality · security · clarity of communication (README, commit history, AI usage log).

The repository will be submitted privately. Do not publish the case document, the
dataset, or the solution anywhere public. Do not add the dataset to a public remote.

---

## 2. Working agreement — READ THIS TWICE

This is the single most important section. It overrides your default behaviour of
completing as much as possible in one turn.

### 2.1 One step at a time, then stop

Work is defined in `PLAN.md` as numbered steps. In a single turn you may work on
**exactly one step**. When that step is done you **stop and wait for my reply**.

You do **not**:
- start the next step because it seems small,
- "quickly also" fix something outside the current step,
- refactor files the current step does not own,
- run `git commit`, `git push`, or `gh` commands. Ever. I commit, not you.

If you notice something wrong outside the current step, write it under **Parking lot**
in `STATE.md` and carry on.

### 2.2 Before starting a step

Post a short plan first — files you will create or change, and any decision you are
about to make that is not already fixed in this file. If a decision is ambiguous, ask
one question and wait rather than guessing.

### 2.3 Step completion report (mandatory format)

Every step ends with exactly this block and nothing after it:

```
## Step <N> complete — <step name>

**Built**
- <2–5 bullets, what actually exists now>

**Files**
- <path> — new/changed, one line why

**Decisions**
- <decision> → <one-sentence reason>   (omit if none)

**Verify**
```bash
<commands I can run to see it work>
```

**Interview notes** (added to AI_USAGE.md)
- <what you generated vs. what needs my review>
- <anything you got wrong here and how it surfaced>

**Commit message**
```
<type>(<scope>): <subject>

<body: what and why, wrapped at 72 chars>
```

**Next:** Step <N+1> — <name>.
Reply `go` to continue, or tell me what to change.
```

Then stop. No extra prose, no "shall I also…", no starting the next step.

### 2.3.1 The commit handoff

You propose the message, **I run the commit**. This is not negotiable — the git
history is a scored deliverable and I need to review the diff before it is recorded.

After the completion report you wait. You do not begin the next step until I reply
with `go`, `next`, or explicit instructions. Silence, a short "ok", or a question from
me about something else is **not** approval to continue.

If I paste back a commit hash, write it into `STATE.md` next to that step. If I reply
with changes instead of `go`, we are still on the same step — fix it, then re-issue the
completion report with a revised commit message.

### 2.4 Update the trackers every step

Before writing the completion report:
- update `STATE.md` (mark the step done, note anything deferred),
- append an entry to `AI_USAGE.md` (see §8).

### 2.5 Commit messages

Conventional Commits. Scope = workspace name: `db`, `shared`, `rag`, `ingest`, `api`,
`web`, `mcp`, `repo`, or none for `docs`/`chore`.

One commit per step. Subject in imperative mood, no trailing period, ≤ 72 chars.
Body explains **why**, not a file listing. Never mention Claude, Cursor, or AI in a
commit message — that belongs in `AI_USAGE.md`.

### 2.6 I must be able to explain every line

I will be asked to walk through this code and change it live in the interview.
Therefore:
- no clever abstractions, no framework magic I did not ask for,
- no dependency added without saying why in the completion report,
- prefer 30 obvious lines over 8 dense ones,
- any non-obvious algorithm (RRF, HNSW parameters, chunk overlap) gets a short
  comment explaining the reasoning, not the mechanics.

If a step produced something I would struggle to defend, flag it in **Interview notes**.

---

## 3. Stack and the reason for each choice

Every one of these has to survive the question "why did you pick that?".

| Layer | Choice | Reason (this is the interview answer) |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Native TS project references, cheap task caching, no bundler ceremony |
| Language | TypeScript everywhere, `strict: true` | Required by the case; one type language across the API boundary |
| Database + vectors | **PostgreSQL 16 + pgvector**, one instance | Documents, users, chunks, embeddings, analytics in one transactional store. No sync problem between a relational DB and a separate vector DB, and it gives keyword search (`tsvector`) for free, which is what makes hybrid retrieval nearly free to add |
| ORM | Drizzle ORM | SQL-shaped, typed, and does not fight raw `<=>` vector operators or custom index DDL the way Prisma does |
| API | NestJS (REST) + `@nestjs/swagger` | Guards + decorators make role-based authorization declarative and auditable, which is a scored criterion; OpenAPI generated from the same code satisfies the README's API documentation requirement |
| Frontend | Next.js (App Router) + Tailwind CSS | Tailwind required by the case; App Router gives server-side route protection instead of client-side flicker |
| Embeddings | OpenAI `text-embedding-3-small` (1536d) behind an `EmbeddingProvider` interface | Cheap, strong, batchable. The interface exists so a local Transformers.js model can be swapped in — demonstrate the seam, do not build both unless time allows |
| Generation | Anthropic Claude via official SDK, behind a `ChatProvider` interface | Streaming, reliable instruction-following for the abstain rule |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP transport | Official SDK; HTTP transport is what allows the OIDC bonus later |
| Auth | JWT access + refresh, argon2id hashes, httpOnly cookies | No third-party dependency to explain; refresh rotation is easy to demonstrate |
| Validation | Zod schemas in `packages/shared`, inferred types on both sides | One definition is the contract, the runtime validator, and the type |
| Tests | Vitest | Unit tests for chunking, RRF, and the abstain rule. Not a coverage exercise |

**Do not add** Redis, Kafka, a second vector store, Docker for the apps themselves,
GraphQL, or a state-management library. Postgres and two processes are enough.

---

## 4. Repository layout

```
.
├─ apps/
│  ├─ api/                 NestJS REST API (auth, search, RAG, admin)
│  ├─ web/                 Next.js + Tailwind (Chat page, Dashboard)
│  └─ mcp/                 MCP server exposing search as a tool
├─ packages/
│  ├─ shared/              Zod contracts + inferred types (the API contract)
│  ├─ db/                  Drizzle schema, migrations, seed script
│  └─ rag/                 Chunking, embeddings, retrieval, prompting, answering
├─ sample_dataset/         Provided corpus (git-ignored, never pushed)
├─ eval/                   Query set + retrieval evaluation harness
├─ docs/
│  ├─ CORPUS.md            Corpus analysis, written in Step 0
│  └─ ADR.md               Short design decision records
├─ docker-compose.yml      Postgres + pgvector only
├─ .env.example
├─ README.md
├─ AI_USAGE.md
├─ CLAUDE.md               this file
├─ PLAN.md                 the steps
└─ STATE.md                where we are
```

**The point of the monorepo is `packages/rag`.** `apps/api` and `apps/mcp` both call
the exact same retrieval code — the MCP tool is not a reimplementation. Say this in
the README; it is the architectural justification for the whole structure.

Dependency direction is one-way: `apps/*` → `packages/*`. Packages never import from
apps, and `packages/rag` never imports from `packages/db` — it receives a repository
interface, so it can be unit-tested without a database.

---

## 5. The corpus

The corpus lives in `sample_dataset/` and is a set of Markdown files. **It is not yet
analysed.** Step 0 exists precisely to read it before any chunking decision is frozen.

Rules:
- `sample_dataset/` is git-ignored. The README explains where to place it instead.
- Ingestion takes a **directory path** as a parameter. Nothing about the sample corpus
  may be hard-coded — pointing it at a different folder must be a one-line change to
  an env var.
- Markdown is a gift, not an obstacle: heading structure carries semantics. Chunk with
  it, not against it (see §6).
- If files carry YAML front-matter, that metadata is stored on the document row and
  prepended to chunk text where it aids retrieval. Step 0 determines whether it exists.

---

## 6. RAG design rules

These are the defaults. Step 0 and the evaluation harness may change the numbers —
if they do, record the change and the reason in `docs/ADR.md`.

**Chunking.** Structural first, size second. Split on Markdown headings into sections;
if a section exceeds the budget, split it on paragraph boundaries with overlap; never
split mid-sentence or mid-code-fence. Target ~500 tokens, ~60 token overlap.

Every chunk is stored with a **heading breadcrumb prefix** in its embedded text —
`Document Title > Section > Subsection\n\n<content>`. A chunk that says "it must be
rotated every 90 days" is useless in isolation; with the breadcrumb it is retrievable.
This is a deliberate, defensible choice: mention it in the README.

**Retrieval — hybrid.** Vector similarity (cosine, HNSW index) *and* Postgres full-text
search, each returning ~20 candidates, fused with **Reciprocal Rank Fusion**
(`score = Σ 1/(k + rank)`, k = 60). Vector search alone fails on exact identifiers,
error codes, and proper nouns; keyword search alone fails on paraphrase. RRF needs no
score normalisation between the two, which is why it is used instead of weighted sums.

Top 6 fused chunks go into the answer context.

**Grounding and abstention.** This is graded harder than eloquence. The generation
prompt must:
- receive chunks as numbered sources with document title and section,
- require inline citation markers `[1]`, `[2]` tied to those numbers,
- forbid any claim not supported by the provided chunks,
- **abstain explicitly** when the corpus does not contain the answer.

Abstention is enforced twice, not once: a retrieval-score floor short-circuits before
the model is even called, and the prompt instructs the model to abstain. The response
DTO carries `answered: boolean` so the UI can render abstention as a first-class state
instead of a paragraph of hedging.

Never let a citation point at a document that was not in the retrieved set. Validate
the returned markers against the context server-side and drop unknown ones.

**Observability.** Every query is logged: text, latency broken down by embed/retrieve/
generate, chunk ids returned, top score, whether it abstained. The dashboard analytics
are a read over this table, not a separate metrics system.

---

## 7. Conventions

**TypeScript.** `strict`, `noUncheckedIndexedAccess`. No `any` — use `unknown` and
narrow. No non-null `!` assertions outside tests. Types describing wire data live in
`packages/shared` and are *inferred from Zod*, never hand-written twice.

**Errors.** No swallowed exceptions, no `catch {}`. The API has one exception filter
producing a consistent shape `{ error: { code, message, requestId } }`. Never leak a
stack trace, a SQL string, or a provider error body to the client. External calls
(embeddings, LLM) are wrapped with a timeout and one retry on transient failures, and
a failed ingestion of one document does not abort the whole run — it is recorded as a
failed document and the run continues.

**Frontend.** Server Components by default, `"use client"` only where interaction
requires it. Reusable components in `apps/web/components`. Every view has three states
implemented: loading, empty, error. Responsive is a requirement, not a bonus — build
mobile layout first and verify at 375px, 768px, 1280px before calling a UI step done.

**Naming.** Files `kebab-case.ts`, types `PascalCase`, no barrel `index.ts` files that
re-export everything.

**Secrets.** Only from env, validated at startup with Zod so the process fails fast on
a missing key. Every new variable is added to `.env.example` in the same step.

---

## 8. AI_USAGE.md

A scored deliverable, and it is only credible if written as we go. After each step,
append:

```md
### Step <N> — <name>
- **AI did:** …
- **I wrote/rewrote:** …
- **Got it wrong:** … (or "nothing notable this step")
- **How I caught it:** …
```

Be honest in the "got it wrong" field. Empty-for-every-step reads as fabricated, and a
real, specific bug caught by a test or by reading the SQL is worth more than a clean
record. Hallucinated API surfaces, wrong pgvector operator syntax, and invented
NestJS decorators are the likely candidates — record them when they happen.

---

## 9. Security requirements

- Passwords: argon2id. Never log a password, a token, or an API key.
- Roles: `USER` and `ADMIN`. `USER` may search and ask. `ADMIN` additionally reads the
  dashboard, manages documents, and triggers ingestion.
- Authorization is enforced **server-side on every route**. Hiding a nav link is not
  authorization. Every admin endpoint has a guard, and there is a test that a `USER`
  token receives 403 from an admin route.
- Validate and bound every input: query length, `topK` range, pagination limits,
  upload size. An unbounded `topK` is a denial-of-service vector against the LLM bill.
- Rate-limit the search and answer endpoints.
- The MCP server authenticates callers too — it is a second front door to the same
  data, and leaving it open would undo the auth work on the API.

---

## 10. Definition of done for the whole case

- `git clone` → `pnpm install` → `docker compose up -d` → `pnpm db:migrate` →
  `pnpm db:seed` → `pnpm ingest` → `pnpm dev` works on a fresh machine, from the
  README alone, with no undocumented step.
- Demo credentials for both roles are in the README and actually work.
- A question answerable from the corpus returns a cited answer; a question not
  answerable from it returns an explicit "not in the corpus".
- An MCP client can connect and call the search tool, and the README shows the config.
- README, AI_USAGE.md, and `.env.example` are complete.
- Git history reads as a deliberate build, one meaningful commit per step.
