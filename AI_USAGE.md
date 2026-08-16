# AI Usage Log

An honest record of what I had AI do, what I did myself, where it got things wrong, and how
each one surfaced.

**Tool and method.** Claude Code (Opus), driven one step at a time against `PLAN.md`. The
stack and its justification, the repository layout, the RAG rules (breadcrumbs, RRF, the
two-layer abstention) and the security requirements were fixed by me in `CLAUDE.md` *before*
any code existed — the assistant implemented against that document, it did not choose it.
Each step ended with a stop: I read the diff, ran the verify commands myself, and either
replied `go` or sent it back. **I ran every commit.** Design reasoning lives in
[`docs/ADR.md`](docs/ADR.md); this file is the working record.

Per step below, **AI** is what the assistant produced and **Me** is what I directed, changed,
or refused. Where I only reviewed, it says so — claiming a rewrite that did not happen would
make the rest of this file worth less.

**The pattern worth noticing:** the compiler, the linter and the test suite were green for
almost every defect below. One was caught by the type system. The rest were found by running
the thing and reading the output.

---

### Step 0 — Corpus recon

- **AI:** enumerated the corpus, measured token and heading distributions, wrote
  `docs/CORPUS.md` and the first evaluation query set.
- **Me:** required this step to exist at all — no chunking parameter could be committed before
  the corpus had been read. The first pass proposed parameters from file counts alone and I
  sent it back for the distribution, which is how the finding that mattered appeared: 546
  bullet lines across the delivery reports, only **15 distinct**. That drove the whole
  breadcrumb design.

### Step 1 — Monorepo scaffold

- **AI:** pnpm workspaces, Turborepo pipeline, the shared tsconfig chain, `docker-compose.yml`
  for Postgres + pgvector, `.env.example`.
- **Me:** the layout and the one-way dependency rule (`apps/*` → `packages/*`, and
  `packages/rag` never importing `packages/db`) were mine and pre-committed; I checked the
  scaffold against them rather than accepting the shape it proposed.
- **Bug:** first build failed — the packages expose subpath exports but the tsconfigs used
  `moduleResolution: "node"`, the node10 resolver, which silently ignores an `exports` map.
  Switched to `Node16`.
- **Bug (process, mine):** the Step 0 commit had tracked all 143 `sample_dataset/` files and
  the case PDF, both forbidden. Spotted by running `git ls-files | wc -l` and getting 150 for a
  repo that should have had 7. A `.gitignore` alone does not untrack; the history was rewritten
  from the root.
- **Bug:** the database was reported "verified" when it had been verified against a *different*
  Docker daemon — this machine has two contexts. Lesson kept for the rest of the project: a
  check that runs in the assistant's environment is not a check until I run it in mine.

### Step 2 — Database schema

- **AI:** the Drizzle schema, the generated migration, the HNSW and GIN index DDL, the seed
  script, the Zod env validator.
- **Me:** the single-store decision (documents, chunks, users, analytics in one Postgres) was
  mine and is the answer to "why not a dedicated vector DB". I reviewed the DDL closely —
  index choice and the generated `tsvector` column are the two things I expect to be asked
  about — but rewrote nothing.
- **Bug:** the seed's upsert would not compile — Drizzle's `onConflictDoUpdate` accepts a
  column, not `lower(email)`. Moved case-insensitivity to a `normalizeEmail()` call at the
  write boundary, and recorded that Step 8's login **must** call it.
- **Found by running twice:** the env validator printed two errors for one empty value, and a
  second `db:migrate` dumped a Postgres notice object to stderr that reads like a crash. Both
  invisible from reading the code.

### Step 3 — Shared contracts

- **AI:** the Zod schemas for every wire type and the inferred TypeScript types.
- **Me:** the rule that types are *inferred from Zod and never hand-written twice* is mine;
  the review here was checking that no DTO had quietly grown a parallel interface. It hadn't.
- **Bug:** `pnpm build` passed on a tree that could not compile. A module `packages/rag` still
  imported had been deleted, but `tsc -b` leaves the output of deleted sources in `dist/`, and
  the stale declaration satisfied the import.
- **Caught by:** the green build contradicting what we knew — something another package used
  had just been deleted. Fix: package builds now `rm -rf dist` first, so a deleted source
  cannot be propped up by its own leftovers.

### Step 4 — Chunking and embeddings

- **AI:** the structural Markdown chunker, the breadcrumb prefix, the `EmbeddingProvider`
  interface and its OpenAI implementation, batching and retry.
- **Me:** "structural first, size second" and the breadcrumb format
  (`Document > Section > Subsection`) were specified by me in advance; I asked for the
  with/without measurement rather than accepting the claim that it helps.
- **Bug:** the chunk budget had a floor of `Math.max(budget - overhead, 64)`, which silently
  **overrides** any configured budget below 64. Ask for 20, get 64, never be told. Now a
  fraction of the budget, so the rule holds at any scale. Caught by a test that set a 20-token
  budget, expected a split, and got one chunk.
- **Dependency swapped:** `js-tiktoken` loads fine under `node -e` but ships ESM-only *types*
  against a dual runtime, which Node16 rejects from a CommonJS package. Replaced with
  `gpt-tokenizer` (identical counts). A runtime check says nothing about type resolution.
- **Measured, not claimed:** embedding all 142 chunks with and without the breadcrumb — with
  it, all five top hits for "Bubble Bakery December delivery" are the right kind of document;
  without it, **none** are.

### Step 5 — Ingestion pipeline

- **AI:** the directory walker, front-matter parsing, content hashing, the upsert, per-document
  error isolation, run bookkeeping.
- **Me:** required that ingestion take a **directory path as a parameter** with nothing about
  the sample corpus hard-coded, and that one failed document must not abort the run. Both were
  in `CLAUDE.md` before the step; I verified them by pointing the CLI at a three-file folder.
- **Bug (security):** every failed document wrote the **entire SQL statement plus its bound
  parameters** into `documents.error_message`, which the admin dashboard renders. Drizzle puts
  the query in `error.message`. Now the driver's `cause` is used, and the message is dropped
  entirely when there is none.
- **Bug:** a first run over an empty database reported `added: 0, updated: 142`. The upsert
  infers its branch from `createdAt === updatedAt`, but the insert set `updatedAt: new Date()`
  — a JavaScript clock against Postgres's `defaultNow()`, never equal.
- **Caught by:** neither was a test failure. The run died for an unrelated reason (Postgres
  rejects `2025-12` for a `date` column) and reading *that* output exposed the SQL leak; the
  counting bug came from a summary saying `added: 0` on an empty table.

### Step 6 — Hybrid retrieval

- **AI:** the vector arm, the full-text arm, Reciprocal Rank Fusion, the repository interface
  that keeps `packages/rag` free of database imports.
- **Me:** RRF with k=60 over a weighted sum was my call and the reason is mine to defend (no
  score normalisation needed between two incomparable scales). I also refused the pre-registered
  `doc_type` prior once it was measured — see below.
- **Bug (headline):** the keyword arm returned **nothing** on most queries, so "hybrid"
  retrieval was silently vector-only. Every Postgres tsquery constructor ANDs its terms, so an
  8-word question demanded all 8 lexemes in one 200-token chunk. Rewritten to OR.
- **Caught by:** a column in our own evaluation output — the per-arm rank showed `k=—` on
  nearly every row. All 75 unit tests passed throughout, because they feed fusion two lists and
  never exercise the SQL.
- **Bug (security):** a real 401 disproved the assistant's own comment claiming provider error
  bodies "contain no secrets" — the response echoes the API key back, masked but with its real
  last four characters, into a table the dashboard renders. Now scrubbed.
- **A pre-registered fix, refuted:** Step 0 committed in advance to a `doc_type` prior for
  near-duplicate crowding. Measured, it would not have worked — the target document never
  reaches fusion at all. Not added.

### Step 7 — Grounded answering

- **AI:** the numbered-source prompt, the `ChatProvider` interface and its Anthropic/OpenAI
  implementation, server-side citation validation, the abstention path.
- **Me:** the two-layer abstention (a score floor *and* a prompt instruction) and
  `answered: boolean` on the DTO were specified by me before the step — abstention is a
  first-class state in this system, not a paragraph of hedging.
- **I rewrote:** the score floor arrived as `MIN_SCORE = 0.02`, a number picked because it sat
  between two values that had just been measured. It is now derived from RRF's arithmetic, so
  it means something in English and moves correctly if k or the candidate count changes.
- **Bug:** the abstention detector used `includes()` on the sentinel, so a model *explaining*
  the rule ("reply NO_ANSWER when unsupported") would have had its real, correctly-cited answer
  discarded. Now compares the whole normalised response. Caught by writing the list of things it
  must **not** fire on — a different exercise from listing what it must.

### Step 8 — Auth and authorization

- **AI:** argon2id hashing, JWT access + rotating refresh tokens with reuse detection, the
  global guard, `@Public()` and `@Roles()`, httpOnly cookie handling, the 403 tests.
- **Me:** roles, the global-guard-with-opt-out shape (so a new route is protected by default
  rather than by remembering), and the requirement that a `USER` token provably receives 403
  from an admin route were mine, from `CLAUDE.md` §9.
- **Bug:** the entire API answered **500 on every route**, including login, while 22 tests
  passed. NestJS resolves injection from `emitDecoratorMetadata`; esbuild (via `tsx`) does not
  emit it, so every dependency was `undefined`. The tests passed because vitest transforms with
  SWC, which does. **The test harness was more capable than the runtime.** Fixed by compiling
  the server with `tsc`. Caught by starting the server to collect curl output.
- **Then the linter demanded the opposite mistake** — `consistent-type-imports` flagged the
  injected types, and obeying it would delete the runtime references DI needs, with no compiler
  error. Rule disabled for that app, with the reason written down.
- **Bug (security):** the dummy hash used to equalise login timing was a fabricated argon2
  string. `verifyPassword` rejects a malformed hash in microseconds instead of ~50ms — it would
  have produced exactly the enumeration oracle it was written to close. Now computed at startup.

### Step 9 — API endpoints

- **AI:** the search, answer and stats endpoints, DTO validation, the exception filter, the
  throttler, SSE streaming, the query log.
- **Me:** bounded `topK` and query length are mine and non-negotiable — an unbounded `topK` is
  a denial-of-service against the LLM bill, not a convenience. I also required the single error
  shape `{ error: { code, message, requestId } }` with no stack trace or SQL ever reaching a
  client.
- **Bug:** `GET /stats` returned 500 on the first real call. Drizzle's `db.execute<T>()` generic
  is an **assertion, not a check** — a `Date` was declared, TypeScript believed it, and a raw
  query skips column-type decoding so Postgres sent a string. Caught by calling the endpoint:
  green build, dead route.
- **Small but revealing:** the throttler rendered `"ThrottlerException: Too Many Requests"` into
  a user-facing error, and `abstainRate` returned `0` when nothing had been asked — "0%
  abstention" and "no data" are different facts.

### Step 10 — App shell and auth flow

- **AI:** the Next.js App Router shell, Tailwind theme tokens, the login form, the session
  plumbing, the middleware.
- **Me:** "hiding a nav link is not authorization" is my line from `CLAUDE.md` §9, and it is
  what made me check the response body rather than the browser — which is the only reason the
  leak below was found.
- **Bug:** a forbidden route answered **HTTP 200** with the not-found page. `notFound()` cannot
  set a status once a `loading.tsx` Suspense boundary has flushed the shell.
- **Bug (worse):** moving the check into a layout **leaked the page it was guarding**. React
  builds `children` before the layout resolves, so the guard runs *alongside* the page — the
  dashboard's markup was serialised into the response sent to a user being turned away.
- **Caught by:** checking status codes rather than bodies, then not trusting the first fix —
  grepping the *rejected user's* HTML for a string only the admin page contains. It was there.
  Neither is visible in a browser.
- **Fix:** decide in middleware, before rendering, by asking the API — a verified check rather
  than a cookie-presence guess.

### Step 11 — Chat page

- **AI:** the chat panel, streaming token rendering, citation chips, the source list, the
  loading/empty/error states.
- **I rewrote:** abstention initially reused the error component. A failed request and a refusal
  are opposite events; conflating them tells the user the system broke when it did exactly what
  it should. Abstention is now its own state, which is the whole point of `answered` existing.
- **The bug that didn't happen, because Step 7 wrote it down:** citation markers are not
  contiguous (a real answer cited `[1][2][6]`). The obvious implementation links the *n*th
  citation to the *n*th source. Verified against the skip case: the third chip would have
  scrolled to the wrong document.

### Step 12 — Dashboard

- **AI:** the document table with search and pagination, the ingestion-run view, the query
  analytics, the admin actions.
- **I rewrote:** the first pass had a chart per metric. Almost none of that data is a chart —
  counts and latest-run status are read faster as numbers and a table, and a sparse line chart
  over 40 queries implies a trend that does not exist.
- **Bug:** a missing document answered **200** — the same defect as Step 10, which had only been
  worked *around* there. This time the cause was measured: removed the Suspense boundary,
  rebuilt, got 404. `loading.tsx` now exists only on the one route with no not-found path.
- **Worth keeping:** `search=%` returns no matches, because the LIKE metacharacter is escaped.
  Unescaped it matches everything — the filter would have looked like it worked while silently
  not filtering.

### Step 13 — MCP server

- **AI:** the MCP server over Streamable HTTP, the search tool, bearer authentication, the
  tool-result formatting.
- **Me:** insisted the MCP server authenticate its callers — it is a second front door to the
  same data, and leaving it open would undo the API's auth work — and that it call the *same*
  `retrieve()` rather than a reimplementation, which is the architectural argument for the
  monorepo. The retrieval adapter moved to `packages/db` so both apps construct it; results
  verified byte-identical.
- **A false finding nearly recorded:** comparing the same query through the API and the MCP
  tool, one score read `0.0312` versus `0.0313`, with a plausible explanation ready (HNSW is
  approximate). Running the API three times first gave an identical value each time, so it was
  not variance — it was the comparison script: Python's `:.4f` rounds half-to-even, JS
  `toFixed(4)` rounds half-up, and `0.03125` is exactly the tie.

### Step 14 — Documentation

- **AI:** the README, `.env.example` completion, the OpenAPI wiring, the MCP client config
  snippet.
- **Me:** required that this step be *executed*, not written — clone into an empty directory
  and follow the README verbatim. Both bugs below exist only because that is a different
  activity from proofreading it.
- **Bug:** the README did not work. On a clean clone `pnpm ingest` failed — the packages are
  consumed through `dist/`, which does not exist on a fresh checkout, and there was no
  `pnpm build` step. `db:migrate` had hidden it by running inside the package with relative
  imports.
- **Bug:** `pnpm dev` served **500 on every web page** — the command the README tells people to
  run. `packages/shared` emitted CommonJS only, and webpack's React Refresh transform injects
  `import.meta` into it. The web app had been built and run a dozen times in production mode,
  where Refresh does not exist. Fixed by emitting both CJS and ESM.
- **The first fix was also wrong:** removing `transpilePackages`, on the assumption that it was
  what pulled the package in. No change — a symlinked workspace package is first-party to
  webpack either way.

### Step 15 — Self-updating ingestion (bonus)

- **AI:** the file watcher, the scheduled re-index, the trigger plumbing.
- **Me:** chose which bonus items to attempt and in what order; this one first because it is the
  one that makes the corpus rule ("pointing it at the real corpus is straightforward") true
  rather than claimed.
- **Bug found:** `ingestion_runs.trigger` was written as `trigger === "API" ? "API" : "CLI"`, so
  every automatic re-index would have been logged as a manual one. The enum has carried `WATCH`
  and `SCHEDULE` since Step 2 and nothing honoured them.
- **Mistake worth recording:** the working index was destroyed during testing. The test script
  truncated the tables first, but the truncate failed silently — Step 14's clean-clone exercise
  had left Postgres under a different compose project, and stderr had been sent to `/dev/null`.
  Ingestion then correctly removed 139 documents while pointed at a 3-file folder. Caught
  because the summary said `unchanged 3` right after the table had been emptied.

### Step 16 — Evaluation harness (bonus)

- **AI:** the labelled query set, recall@k / MRR computation, the per-arm comparison table.
- **Me:** the decision that matters in this step is mine — **publish the table as measured**.
  Hybrid beats vector-only decisively (`loop_complete` is missed entirely by embeddings), but
  **keyword-only matches hybrid on recall and beats it on MRR**. Two paraphrase queries were
  written specifically to find a case where keyword search fails; it found both at rank 1.
  Hybrid is kept and the README's claim narrowed to what the evidence supports. Retuning until
  the table agreed would be fitting the design to a 13-query sample.
- **Bug in the instrument:** the first comparison gave three *identical* recall figures. That is
  a reading of zero, not a result — every query in the set was found by both arms independently,
  so nothing could distinguish them. Four queries hard for a specific arm were added.

### Step 17 — OIDC for the MCP server (bonus)

- **Me (deviated from the plan deliberately):** OIDC is a *mode*, not a replacement for the
  bearer token. Making it the only mode means a reviewer cannot try the MCP server without
  registering an application first, which trades a bonus for the thing the case actually asks
  for — that it runs on a fresh machine from the README.
- **AI:** JWKS verification with `jose`, pinned algorithms, issuer/audience checks, the mode
  switch.
- **Bug:** `apps/mcp` was converted to ESM (jose is ESM-only) and had to be reverted. Every
  Drizzle query broke — `packages/db` is CommonJS and resolves `drizzle-orm` via `require`, an
  ESM app resolves it via `import`, so the compiler sees two copies of the types. The
  dual-package hazard, strictly bigger than the problem it solved. jose is now loaded by cached
  dynamic import. **This is the one defect in this log the compiler caught.**

### Step 19a — Offline answering, cost, error classification (bonus)

Prompted by `/answer` returning 500s during my own testing — which turned out to be an
exhausted API balance, not a bug.

- **Me:** asked for three things: classify the failure correctly instead of reporting 500,
  answer without a model when no credential works, and cut token cost. The automatic
  behaviour — hosted model when the credential works, offline when it does not, recovering on
  its own when the balance is topped up — is the shape I asked for; a startup probe would have
  failed every request after credit ran out mid-session.
- **AI:** the extractive answerer, the circuit-breaker fallback provider, error classification
  (401/402/403 switch modes, 429/5xx do not), near-duplicate suppression, the `answerMode` field
  and the UI notice.
- **Me (the judgement call):** the offline mode is **labelled**, on the wire and in the UI,
  rather than dressed up as the real thing. Across all 16 labelled queries no lexical threshold
  separates "the corpus contains the answer" from "the corpus contains the words" — an
  answerable query scores 0.29 while an unanswerable one scores 0.60 — so the extractive path
  cannot perform the second abstention layer, and pretending otherwise would break the one
  guarantee this system makes.
- **Bug:** deduplicating passages for the prompt while validating citation markers against the
  *original* list. Every marker after a dropped passage would resolve to the wrong document —
  the Step 11 failure mode, reintroduced a minute after the dedup was written. One list is now
  used for the prompt, the validation and the reported sources; three tests pin it.
- **Bug, latent since Step 9:** the SSE handler rethrew after the stream had started, which
  hands the error to Nest's filter, which writes headers already sent → `ERR_HTTP_HEADERS_SENT`,
  real cause buried, truncated stream. It had never surfaced because no provider had failed
  *mid-stream* before.
- **Bug:** the tab icon was answered with a **307 to `/login`** — the middleware matcher excluded
  `favicon.ico` but not `/icon.svg`. A browser will not render a redirect as an image, so the
  favicon never appeared. Found by requesting the file rather than trusting the framework.
- **Cost, measured rather than estimated:** `max_tokens` 700 → 400 (providers *reserve* against
  it, which is what caused the 402), and near-duplicate suppression saving 6% on average.
  Reported as 6%, not the 30% the raw duplicate count suggested. `topK` 6→4 would have saved 25%
  and I declined it — an expected document sits at rank 4.

### Step 19b — Security review fixes (bonus)

- **Me:** asked for a read of the whole system against `CLAUDE.md` §9 before calling it done —
  guards, controllers, MCP, input bounds, secret handling, dependencies — rather than taking
  "the auth step passed" as an answer. Three findings came out of it; all three are fixed here.
- **Bug (the real one):** the MCP server **authenticated its callers and then ignored who they
  were**. `ToolDependencies.caller` was passed in and never read, so `get_document` — which
  returns a document's entire text, and which the API restricts to `@Roles("ADMIN")` on
  `GET /documents/:id` — was served to any valid token. A `USER` could read through MCP exactly
  what the API answers with 403. The tool is now registered per role, so it is absent from
  `tools/list` for a non-admin, and the handler re-checks.
- **Bug:** the MCP endpoint had **no rate limit at all**, while the API throttles `/search` to
  30/min precisely because it spends an embedding call — the same call `search_corpus` makes.
  Limiting one front door and leaving the other open bounds nothing.
- **Bug:** `/auth/login` was covered only by the global 120/min ceiling, which is 120 password
  guesses a minute against a known email. Now 10/min. What this does *not* fix is written down
  rather than implied: the limit is per IP, so a distributed attacker still gets 10 per address.
- **Bug (mine, in the fix):** disabling the throttler for the auth test suite with
  `overrideGuard(AppThrottlerGuard)` **silently did nothing** — the guard is registered under
  the `APP_GUARD` token with `useClass`, so the class itself is not a provider token and there
  was nothing to override. Caught immediately because the suite still failed with 429. Fixed by
  replacing `ThrottlerStorage` instead.
- **Verified against the running system, not only the tests:** a `USER`'s `tools/list` returns
  one tool and an `ADMIN`'s returns two; a `USER` calling `get_document` by name gets "Tool
  get_document not found"; the 61st MCP request in a minute returns 429 with `Retry-After` while
  a different caller is unaffected; the 11th wrong password returns 429 in the standard error
  envelope.

### Step 19c — Query rewriting for the vector arm (bonus)

- **Me:** required that the strategy be picked by measurement, not chosen and then justified.
  A throwaway probe measured four candidates against the query that had been failing since
  Step 16 before any of them was written into the retriever, and it changed the answer twice.
- **Rejected on measurement — the obvious idea, which is worse than nothing:** splitting the
  question on its conjunction and fusing the sub-queries takes q7 from "not found" to **fused
  rank 34**. RRF is a *vote*, and each noisy sub-query contributes two more ranked lists with
  the same bias. "More retrieval views can only help" is wrong when the views share a blind
  spot — I would have shipped this on intuition.
- **Rejected on measurement — the version that scores best:** rewriting *both* arms puts q7 at
  rank 2 and destroys q9, where "delivery review" is the name of the process being asked
  about (vector 1 → 9, keyword 1 → nothing). Chose the asymmetric version, which is worse on
  the headline query and does not break anything.
- **The design, in one line:** `ts_rank` already discounts a term that appears everywhere,
  an embedding cannot — so the vector arm gets the query with majority terms removed and the
  keyword arm gets the question as asked.
- **Bug (mine):** first version of the term-frequency SQL passed a JS array straight into the
  Drizzle template, which expands it into one placeholder per element and produces
  `unnest(($1, $2, …)::text[])` — a row constructor cast to an array, which Postgres rejects.
  Fixed with `sql.param`. Found by running `pnpm eval`, not by the build.
- **Bug:** a backtick inside the SQL comment terminated the enclosing template literal, and the
  emitted JavaScript was syntactically broken in a way that pointed at the *comment* rather
  than the cause.
- **Bug:** the working query printed ten `NOTICE: text-search query contains only stop words`
  lines per search — `plainto_tsquery` emits one per stop word. Fixed by filtering stop words in
  a `MATERIALIZED` CTE; without `MATERIALIZED` the planner inlines the filter and the notices
  come back.
- **Result, with its cost:** hybrid recall@6 0.923 → **1.000**, all-expected 0.923 → **1.000**,
  and **MRR 0.737 → 0.721** — q9 lands at rank 2 instead of 1. Published with the regression
  visible in the per-query table rather than reported as a clean win.
