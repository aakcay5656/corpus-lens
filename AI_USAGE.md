# AI Usage Log

An honest record of where AI assistance was used on this case, what it produced, what I
wrote or rewrote myself, and where it was wrong. Written as the work happened, one entry
per step.

Tool: Claude Code (Opus), driven one step at a time against `PLAN.md`, with a working
agreement in `CLAUDE.md` that requires the model to stop after each step for review.

---

### Step 0 — Corpus recon

- **AI did:** enumerated `sample_dataset/corpus/` and read every root document plus samples
  from each subfolder; ran the measurement scripts (token distribution by document and by
  `##` section, heading-depth census, front-matter/table/code-fence checks, duplicate-line
  counts); drafted `docs/CORPUS.md` and `eval/queries.yaml`.
- **I wrote/rewrote:** the chunking decision itself. The model initially framed the options
  as a straight choice between one-chunk-per-document and one-chunk-per-`##` section. Both
  are overfitted to a 23k-token sample and would have violated the "point ingestion at any
  directory" requirement, so I directed it to the split-then-merge design instead — the
  chunker implements the general strategy and this corpus simply resolves to the merge path.
  That framing, and the decision to leave the budget at 500 rather than tuning it down to
  the observed ~200, are mine.
- **Got it wrong:** the model's first pass reported the corpus as "142 files, ~596 KB" and
  moved straight to proposing chunk parameters — it had not yet measured section-level sizes
  or checked for duplication, so the proposal was resting on file counts alone. It also
  initially recorded the ingest path as `./sample_dataset` (copied from `STATE.md`) when the
  corpus actually lives in `./sample_dataset/corpus`, with `sample_questions.md` a sibling
  that must not be ingested.
- **How I caught it:** I asked for the distribution before the recommendation. The
  duplicate-line count — 546 bullet lines across `delivery-reports/`, only **15 distinct** —
  only surfaced because of that, and it turned out to be the most important finding in the
  step: it means the retrieval risk here is near-duplicate chunks, not chunk size, and it is
  what drove the decision to put `doc_type · date · subject` into the breadcrumb. The path
  error surfaced when listing the directory to confirm what ingestion would actually walk.

**Worth flagging for review:** `docs/CORPUS.md` proposes one change to `CLAUDE.md` §6 — a
conflict/deprecation rule in the generation prompt — because the shipped question set grades
whether the answer identifies SDK v2 as deprecated. Retrieval alone cannot satisfy that
question, so it is a prompt requirement, not a retrieval one.

---

### Step 1 — Monorepo scaffold

- **AI did:** generated the pnpm workspace, `turbo.json`, the shared TypeScript strictness
  config and per-workspace tsconfigs, the ESLint 9 flat config and Prettier setup, the
  `docker-compose.yml` for Postgres 16 + pgvector, `.env.example` and `.gitignore`; then ran
  install, build, typecheck, lint, format and the Postgres verification.
- **I wrote/rewrote:** the scoping rule that frameworks are installed in the step whose code
  needs them rather than all up front — the model's instinct was to scaffold NestJS and
  Next.js immediately. Since I have to defend every line in the interview, a Nest CLI
  scaffold I did not write is a liability, not a head start. Also mine: keeping the chunk of
  config that varies per workspace (`module`, `target`, `lib`) out of the base tsconfig
  instead of setting a default and overriding it twice.
- **Got it wrong:** two things, both caught by running the commands rather than by reading.
  (1) The first build failed outright — the packages expose subpath exports instead of barrel
  files, but the generated tsconfigs used `moduleResolution: "node"`, the node10 resolver,
  which silently ignores an `exports` map. TypeScript's own error text named the fix
  (`Node16`). (2) More seriously, I found that the Step 0 commit had tracked all 143
  `sample_dataset/` files and the case PDF, both of which `CLAUDE.md` forbids from ever
  entering the repository.
  (3) I reported the database as verified when it had in fact been verified on the wrong
  Docker daemon. This machine has two Docker contexts — `default` and `desktop-linux` — and
  the assistant's shell used one while my terminal used the other. Its container came up
  healthy on `default` and sat there holding port 5432, so when I ran the exact verification
  commands from the report, `docker compose up -d` failed with `address already in use`. The
  blocking container was the one the verification had just created.
- **How I caught it:** the resolution bug surfaced on the first `pnpm build`, before any code
  depended on it. The dataset leak surfaced because I ran `git ls-files | wc -l` while
  checking the toolchain and got 150 for a repo that should have had 7 — the file count was
  the tell. Writing `.gitignore` was not sufficient on its own: gitignore has no effect on
  files that are already tracked, so the index had to be corrected too. The Docker context
  split surfaced when I ran the verification block myself and it failed on a machine where
  it had supposedly just passed; `docker context ls` showed two daemons and
  `docker --context default ps` found the squatting container.

**Lesson kept:** a verification that runs in the assistant's environment is not a
verification of mine. From here, "done" means the commands passed in my terminal, and the
report says which environment produced any number it quotes.

---

### Step 2 — Database schema

- **AI did:** wrote the six Drizzle tables with their indexes and comments, the env validator,
  the connection factory, the argon2id helper, the migration runner and the idempotent seed;
  generated the migration and ran the clean-slate cycle (`down -v` → `up` → `migrate` → `seed`)
  plus a SQL smoke test of both retrieval paths.
- **I wrote/rewrote:** the rule that enums are only for values this system owns. The first
  draft had `doc_type` as a pgEnum listing the sample corpus's folder names — which would have
  quietly made "point ingestion at a different directory" a schema migration and broken the
  requirement in `CLAUDE.md` §5. `doc_type` and `lifecycle` are plain text for that reason.
  Also mine: putting the argon2 parameters in one module that both the seed and Step 8's auth
  import, rather than letting each declare its own.
- **Got it wrong:** the build failed on the seed's upsert — the schema had a unique index on
  `lower(email)`, but Drizzle's `onConflictDoUpdate` only accepts a column as its conflict
  target, not an expression, so the code did not compile. The fix moved case-insensitivity from
  the database to a `normalizeEmail()` call at the write boundary. That is a genuine trade: the
  guarantee is now enforced by discipline instead of by the database, so if Step 8's login path
  forgets to call it, a user who capitalises their email silently fails to log in. I recorded
  it in `STATE.md` as a parking-lot item for Step 8 rather than trusting myself to remember.
- **How I caught it:** `pnpm build` refused it — TS2322, `SQL<unknown>` is not an `IndexColumn`.
  Worth noting that the type system caught a design problem, not a typo: the ORM had no way to
  express what the schema was asking for.

**Two things I found by running the documented commands myself**, after the assistant had
reported the step complete:

1. The env validator printed *two* error lines for one empty `DATABASE_URL` — a `.min(1)` and a
   `.refine()` both firing. A fail-fast message exists to tell the reader what to do; saying it
   twice in different words is noise. Collapsed to a single check.
2. `pnpm db:migrate` on an already-migrated database dumped a full Postgres notice object to
   stderr (`relation "__drizzle_migrations" already exists, skipping`). Harmless, but it looks
   exactly like a crash to someone following the README, and the README is a scored deliverable.
   The connection now filters the three `IF NOT EXISTS` duplicate-object notice codes and lets
   everything else through — silencing all notices would have traded a cosmetic problem for a
   diagnostic one.

Both were invisible from reading the code and only appeared on the second run. Worth
generalising: idempotency needs to be tested by actually running things twice.

**Verified rather than assumed.** Three things I checked in the database instead of trusting the
schema file: that `search_vector` really is a generated column (`attgenerated = 's'`, not a
plain column someone must remember to fill); that both the HNSW and GIN indexes were actually
created with those access methods; and that `ON DELETE CASCADE` removes a document's chunks. The
generated column in particular only works because `to_tsvector` is given an explicit `'english'`
argument — the one-argument form is not IMMUTABLE and Postgres rejects it in a generated column.

**Note on the leak.** This is the failure mode the working agreement in `CLAUDE.md` §2.3 is
designed to catch — the model proposes a commit, I run it. The `.gitignore` belonged to
Step 1 while the commit happened at the end of Step 0, so the ordering in `PLAN.md` left a
one-step window where the dataset was committable. Worth stating plainly rather than quietly
fixing, since git history is a scored deliverable.

**How it was actually resolved.** The first remediation did not work: `git commit --amend`
landed on the tip commit rather than the root one, so the corpus stayed in history while
Steps 1 and 2 got squashed into a single commit whose message still claimed the packages were
"empty placeholders". Nothing had been pushed, so the history was rewritten from the root —
`git reset --soft` to the root, unstage, `git rm --cached`, amend, then recommit the rest. Both
commits now contain zero forbidden files, checked with `git ls-tree` rather than assumed.

I chose **not** to split Steps 1 and 2 back apart. A reconstructed Step 1 commit would not
compile, because `apps/api/src/main.ts` imports `@corpus-lens/db/client` and that module is
Step 2's work. A history with a non-building commit in it is worse than an honest combined one,
so the commit message was rewritten to describe both steps instead of hiding one.

---

### Step 3 — Shared contracts

- **AI did:** wrote the nine Zod modules in `packages/shared` (role, error envelope, limits,
  pagination, auth, search, answer, document, ingestion) with inferred types, replaced the
  placeholder files in `apps/api` and `apps/web` with real contract imports, and ran the
  boundary proofs.
- **I wrote/rewrote:** two things that are security decisions rather than modelling ones.
  `POST /ingest` originally took a `corpusDir` from the request body, which would have let any
  authenticated admin point ingestion at any directory the API process can read — path
  traversal presented as a feature. It now comes from `CORPUS_DIR` on the server. I also
  removed the access token from the login response body: it travels in an httpOnly cookie, and
  returning it in the body as well hands back precisely what the cookie flag exists to withhold.
- **Got it wrong:** `pnpm build` reported success on a tree that could not actually compile.
  I had deleted `packages/shared/src/package-info.ts`, but `packages/rag` still imported it —
  and the build passed, because `tsc -b` leaves the output of deleted sources in `dist/` and the
  stale `package-info.d.ts` was still there satisfying the import.
- **How I caught it:** the green result did not match what I knew about the tree — I had just
  deleted a module something else imported, so a passing build was the suspicious outcome, not
  the reassuring one. Deleting `dist/` and rebuilding surfaced the real error immediately.

**The fix is worth more than the bug.** Package builds now run `rm -rf dist && tsc -b`, so a
removed source can never be propped up by its own leftover output. Removing the stale directory
first also meant dropping the packages' `typecheck` script: for a composite project `tsc -b`
already *is* the type check, and leaving both tasks in place would have had two processes
running `rm -rf dist` in the same directory concurrently. Package type errors still surface,
because each app's `typecheck` depends on the packages being built first.

**Boundary proofs, run rather than asserted.** Renaming `Role`'s `ADMIN` member fails
`apps/api` with `TS2322`; renaming `AnswerResponse.answered` fails `apps/web` with `TS2551`.
That is the Step 3 acceptance criterion demonstrated in both directions rather than claimed.

---

### Step 4 — Chunking + embeddings

- **AI did:** wrote the Markdown line scanner, the three-pass chunker (size split → merge →
  absorb), the path-metadata deriver and breadcrumb builder, the `EmbeddingProvider`
  interface with its token-aware batching, the OpenAI provider over raw `fetch`, the offline
  deterministic provider, and 34 Vitest cases; then ran the chunker over all 142 corpus files.
- **I wrote/rewrote:** three calls that are architecture rather than code.
  (1) **A line scanner instead of `remark`.** The instinct was to reach for a Markdown AST.
  But Step 0 had already measured the trap — every changelog indents its first bullet by four
  spaces, which CommonMark reads as an indented *code block* — so the "correct" parser is the
  one that gets this corpus wrong. The scanner needs to know two things, where headings are
  and where fences are, and that is about ninety lines I can defend.
  (2) **Raw `fetch` instead of the `openai` SDK.** What is actually being graded here is the
  failure policy — a bounded timeout, one retry, and a transient-versus-permanent decision.
  The SDK ships its own retry defaults, so using it would mean either inheriting a policy I
  did not choose or switching it off and writing this anyway.
  (3) **The offline provider is a product feature, not a test double.** It is selected by
  `EMBEDDING_PROVIDER=deterministic` and carries the *same* input and batch limits as the
  OpenAI one, so an offline run fails wherever an online run would. That is what makes
  "clone it and watch it work without an API key" true, and it means the tests exercise the
  same code path production uses instead of a parallel one that quietly rots.
- **Got it wrong:** the content-budget floor. To stop a pathological breadcrumb from leaving
  zero room for content, the first version clamped the budget with `Math.max(budget - head,
  64)`. That silently *overrides* any configured budget below 64: a caller asking for a
  20-token budget got 64 and was never told. It is the worst kind of bug — a guard that
  ignores configuration and looks reasonable while doing it.
- **How I caught it:** a test that fed a 20-token budget and asserted more than one chunk got
  exactly one. The failure was in the test's expectation only by appearance; reading why the
  split had not fired led to the constant. The fix makes the floor a *fraction* of the budget
  (25%), so the rule is "a breadcrumb may not eat more than three quarters of the budget",
  which holds at every scale instead of only above 64.

**A dependency that had to be swapped after it compiled in Node but not in TypeScript.**
`js-tiktoken` was the first choice for token counting and worked at runtime, but its package
declares `"type": "module"` and offers no `types` entry under the `require` condition, so
TypeScript's Node16 resolver refuses it from a CommonJS package while Node itself loads it
happily. Replaced with `gpt-tokenizer`, which is dual-published properly and returns identical
counts (both give 8 for the same probe string). Worth recording because the runtime check
passed and the build still failed — a package working in `node -e` says nothing about whether
its types resolve.

**Evidence for the breadcrumb decision, rather than a claim.** Step 0 argued that filename
metadata in the breadcrumb is the highest-leverage retrieval choice in the case, because the
78 delivery reports are near-identical prose. Embedding all 142 chunks twice — once with the
breadcrumb, once without — and querying *"Bubble Bakery December 2025 delivery report"*:

```
WITH breadcrumb      1. 0.285 delivery-reports/2025-05-bubble-bakery.md
                     2. 0.272 delivery-reports/2025-07-bubble-bakery.md
                     … all five results are Bubble Bakery delivery reports

WITHOUT breadcrumb   1. 0.219 meeting-notes/2026-02-09-production-sync.md
                     2. 0.162 meeting-notes/2025-09-22-production-sync.md
                     … not one delivery report in the top five
```

Note the honest part: the *right* month (2025-12) ranks fourth, not first, because "December"
and "12" share no characters for a lexical embedder. That is precisely the gap the keyword arm
of RRF and the real embedding model close, and it is worth knowing before Step 6 rather than
being surprised by it.

**Verified rather than assumed.** The chunker was run over the real corpus, not just fixtures:
142 documents produce **exactly 142 chunks**, one per document, min 45 and max 253 tokens
including the breadcrumb. That is the number Step 0 predicted, which is the point of having
predicted it — a materially different count would have meant a bug. The changelog's
four-space-indented bullet is present and intact in the emitted chunk.

---

### Step 5 — Ingestion pipeline

- **AI did:** wrote the pipeline over its three interfaces, the filesystem corpus source with
  SHA-256 hashing, the narrow front-matter parser, the version/lifecycle deriver, the Drizzle
  store, the Zod-validated CLI with its summary table, and 17 new tests; then ran the whole
  thing against Postgres and the real 142-document corpus.
- **I wrote/rewrote:** where the pipeline lives. The obvious move was to put ingestion in
  `packages/db` next to the schema, or in `packages/rag` next to the chunker. Both are wrong:
  `packages/rag` may not import `packages/db` (CLAUDE.md §4), and a schema package has no
  business knowing what ingestion is. Splitting it — orchestration over interfaces in `rag`,
  the Drizzle implementation in `apps/api` as the composition root — costs one indirection and
  buys two things I actually wanted: the entire run is unit-tested in memory with no Postgres,
  and Step 9's `POST /ingest` will construct the same store rather than a second pipeline.
- **Got it wrong:** two things, and the second is the more serious.

  **(1) A first run over an empty database reported `added: 0, updated: 142`.** The upsert
  infers which branch it took by comparing `createdAt` with `updatedAt`, and the insert branch
  was setting `updatedAt: new Date()` — a JavaScript clock — against a `createdAt` filled by
  Postgres's `defaultNow()`. Those two are never equal, so every insert looked like an update.
  The Step 2 seed script does the same comparison and works, precisely because it does *not*
  set `updatedAt` on insert; I had copied the idea without copying the condition that makes it
  true.

  **(2) Every failed document was writing the full SQL statement into the database.** Drizzle's
  `error.message` is the entire failed query plus its bound parameters, and the pipeline stores
  whatever message it catches in `ingestion_events.message` and `documents.error_message` —
  both of which the admin dashboard will render in Step 12. So a failed insert would have
  printed our schema and the document's contents into the UI, which is the exact thing
  CLAUDE.md §7 forbids. The fix takes the driver error's `cause` (postgres.js puts the real
  diagnosis there — "invalid input syntax for type date") and drops the message entirely when
  there is no cause, rather than trusting it not to contain SQL.

- **How I caught it:** neither showed up as a failure. The whole first run against Postgres
  failed loudly for an unrelated reason — Postgres rejects `2025-12` for a `date` column, and
  108 of 142 documents are dated by month — and it was reading *that* error output that showed
  the SQL was being stored. The counting bug surfaced afterwards, from looking at a summary
  table that said `added: 0` on an empty database. Both are cases where the exit code was not
  the useful signal: one produced a green run with wrong numbers, the other a red run whose
  real problem was not the one being reported.

**On the date column.** Storing `2025-12` as `2025-12-01` is a deliberate precision loss and
worth saying out loud, since it is a lie of one day: a monthly delivery report has no exact
day. The alternative was widening the column to text, which would give up ordering and range
queries — the only reasons the column exists. The breadcrumb still carries the original
`2025-12` string, so retrieval sees the truth even though the column rounds.

**Verified rather than assumed**, against the real corpus and a real database:

```
clean run     142 discovered · 142 added · 142 chunks · 1.9s
immediate re-run  142 unchanged · 0 chunks written · 0.1s
--force           142 updated · 142 chunks
```

The second run is the one that matters: idempotency here is not "it succeeded twice" but "it
did no work", and `chunks written: 0` is what proves nothing was re-embedded. Separately, in a
three-file scratch corpus, editing one file and deleting another produced exactly
`1 updated · 1 unchanged · 1 removed`. In the database afterwards: 142 documents all INDEXED,
142 chunks all carrying both an embedding and a generated tsvector, and the doc_type
distribution matching docs/CORPUS.md exactly (78 delivery reports, 30 meeting notes, 13 root,
10 briefs, 6 changelogs, 3 guides, 2 postmortems).

Two things I checked because they feed later steps rather than this one: `sdk-notes-v2` is
stored with `lifecycle = deprecated` and `sdk-notes-v3` with `current`, which is the data Step
7's conflict rule needs — the model will not have to notice the word "DEPRECATED" in the prose.
And a `chmod 000` file produced `failed: 1` with the other documents still indexed, the error
recorded against the right phase (PARSE) on both the document row and the event row, and a
non-zero exit code so a README follower does not read "done" over an incomplete index.

**A Step 4 escape, found here.** `pnpm typecheck` was not in the Step 4 verification block —
I ran build, test, lint and format — and `apps/mcp/src/main.ts` still imported the
`package-info` module Step 4 deleted. The commit builds and tests clean but does not typecheck.
Fixed as part of this step and the verification block now runs all five. Worth recording
because it is the second time a gate I did not run was the one that mattered.

---

### Step 6 — Hybrid retrieval

- **AI did:** wrote the RRF implementation, the retriever over its repository interface, the
  two SQL arms, the `pnpm eval` runner, and 24 new tests; then measured the whole thing
  against the corpus twice — once with the offline embedder and once with
  `text-embedding-3-small`.
- **I wrote/rewrote:** the refusal to tune. When the eval came back 8/9 under the offline
  embedder, the obvious move was to add the `doc_type` prior that `docs/CORPUS.md` §5 had
  pre-registered for exactly this failure. I measured whether it would work before writing it,
  and it would not — twice, for two different reasons. That measurement is the actual output of
  this step; the code is the easy part.
- **Got it wrong:** two things, one of which had made the headline feature not work at all.

  **(1) The keyword arm was returning nothing, so "hybrid" retrieval was vector-only.** Every
  Postgres tsquery constructor — `websearch_to_tsquery`, `plainto_tsquery`, `phraseto_tsquery`
  — joins its terms with AND. Passing a question through therefore demanded that *every* lexeme
  appear in one 200-token chunk:

  ```
  websearch_to_tsquery('english', 'How many vacation days do Lumen employees get per year?')
    → 'mani' & 'vacat' & 'day' & 'lumen' & 'employe' & 'get' & 'per' & 'year'
  ```

  Zero matches. RRF was dutifully fusing one list with an empty one and every test passed,
  because the unit tests fed it two lists and the SQL was never exercised without a database.

  **(2) A provider error body wrote a partial API key into the database.** The comment above
  `readBodySafely` asserted that provider error bodies "contain no secrets". A real 401 proved
  otherwise: the response echoes the key back masked as `sk-or-v1***…73bf` — with its true last
  four characters — and that string lands in `ingestion_events.message`, which the admin
  dashboard renders. CLAUDE.md §9 says never log an API key, and a partial key is still a key.
  Error bodies are now scrubbed of anything key-shaped before being kept.

- **How I caught it:** the first one came from a column in my own output. The eval printer shows
  each passage's rank in each arm, and the `k=` column was `—` on almost every row. I had added
  that column for debugging later, and it caught the bug on its first run — which is the
  argument for exposing `vectorRank` and `keywordRank` on the passage DTO rather than just the
  fused score. The second came from an accident: the key I was given was an OpenRouter key, so
  the request 401'd against `api.openai.com`, and reading the failure showed the key in it.

**The pre-registered hypothesis, tested and refuted twice.** Step 0 predicted that the 78
near-duplicate delivery reports would crowd out root reference documents, and committed in
advance to a `doc_type` prior in fusion as the remedy. Both halves turned out to be wrong:

- *With the offline embedder*, `style-guide-ui.md` reached fusion at rank 21 but sat behind five
  **other** non-delivery-report documents, so capping the cluster would have promoted
  `company-overview` and `sdk-notes-v3` instead of the style guide.
- *With real embeddings*, it is worse and clearer: **all 40 candidates — 20 vector, 20 keyword —
  are delivery reports.** `style-guide-ui.md` is at vector rank 69 and keyword rank 86 of 142.
  It never reaches fusion at all, so no fusion-stage rule of any kind can promote it. Raising
  the candidate budget to the entire corpus does not help either: its fused score would be
  0.0146 against ~0.030 for the cluster.

The crowding is real. It just happens one stage earlier than the hypothesis assumed, which is
the sort of thing only measurement tells you.

**What q7 actually is.** One more measurement settled it. The same document ranks **1st in both
arms** for "What is the CTA contrast rule?" and 69th/86th for "Why does a low-contrast CTA keep
coming up in delivery reports, and what is the rule?". The phrase "delivery reports" in the
query activates the 78-document cluster in both arms simultaneously. So q7 is a multi-intent
query — half of it is answered correctly and the other half is drowned — and the remedy is query
decomposition or reranking, both already scoped in Step 19. It is not a defect in fusion, in
chunking, or in the breadcrumb.

I left q7 failing and the eval exiting non-zero rather than editing the query or tuning fusion
around it. `eval/queries.yaml` says the shipped queries "must not be edited to make the numbers
look better", and a probe I wrote myself deserves the same treatment.

**Measured, with `text-embedding-3-small`:**

```
answerable queries: 8/9
q1 applovin size limit      rank 1     q6 december merge marina    rank 4
q2 sdk init / lumen.track   rank 1     q7 cta contrast rule        MISS (multi-intent)
q3 audio separate pass      rank 2     q8 meta vs unity limits     rank 1
q4 march 2026 rejections    rank 1     q9 delivery review owner    rank 1
q5 minimum languages        rank 1

all five shipped dataset queries (q1–q5) return their expected document at rank 1
re-embed 142 chunks 65s · search ~450ms end to end, almost all of it the embedding call
```

**A finding Step 7 gets for free.** Across the eval set, in-corpus queries top out at
0.0325–0.0328, while the fully off-domain q12 tops out at **0.0164** — which is exactly
`1/(60+1)`, the signature of a single arm contributing with nothing agreeing with it. That is a
2× separation for the retrieval score floor, and it falls out of RRF's structure rather than
from a threshold I picked. The honest caveat is in the same numbers: q10 and q11 are also
unanswerable and still top 0.0325, because `company-overview.md` is genuinely about the company.
The floor is the cheap half of abstention; the prompt rule has to do the rest.

---

### Step 7 — Grounded answering

- **AI did:** wrote the `ChatProvider` interface and its streaming implementation, the system
  prompt, the citation validator, the two-layer abstention in `answer.ts`, the `pnpm ask` CLI,
  and 21 new tests; then ran the real thing against the corpus for both the answer case and all
  three abstention cases.
- **I wrote/rewrote:** the score floor, which arrived as a magic number. The first version had
  `MIN_SCORE = 0.02` with a comment pointing at the Step 6 measurements — a value chosen because
  it sat between the numbers I had just seen, which is the definition of fitting a threshold to
  a sample. It is now derived: `1/(k+1) + 1/(k+candidates)`, the score of a chunk ranked first
  by one arm and last-of-candidates by the other. That expression asserts one thing in English
  — *at least one chunk was found by both retrieval arms* — and it happens to evaluate to
  0.0289. Same behaviour, but now it is a rule rather than a number, and it moves correctly if
  k or the candidate budget ever changes.
- **Got it wrong:** the abstention detector. The first version searched the response for the
  sentinel with `includes()`. That means a model which writes "the rule says to reply NO_ANSWER
  when unsupported" — explaining the instruction rather than obeying it — has its real,
  correctly-cited answer thrown away and replaced with "not in the corpus". It is a silent
  failure in the worst direction: the system looks appropriately cautious while destroying good
  output.
- **How I caught it:** writing the test list rather than the code. Enumerating what the detector
  must *not* fire on is a different exercise from enumerating what it must fire on, and the
  second list is the one that finds this. It now compares the whole normalised response, while
  still tolerating a sentinel the model wrapped in bold or a code fence.

**A deviation from CLAUDE.md §3, recorded rather than quietly taken.** §3 specifies Anthropic
Claude "via official SDK". The model is Claude — `anthropic/claude-sonnet-5` — but the transport
is the OpenAI `/v1/chat/completions` wire format, because the credential available is an
OpenRouter key and OpenRouter does not expose Anthropic's `/v1/messages`. Two things make this
cheap rather than a compromise: Step 6 already built exactly this seam for embeddings, so there
is one streaming parser and one retry policy in the repository rather than two; and the
`ChatProvider` interface §3 actually asks for is untouched, so an SDK-backed implementation is
one new file and one factory branch.

**No offline chat provider, deliberately** — which is the opposite of the call I made for
embeddings in Step 4. A hashing trick can stand in for an embedding model because both produce
a vector whose only job is to be compared against other vectors. Nothing can stand in for
generation: canned text would make the abstain rule and the citation validator *look* exercised
when they had never run once. Search, ingestion and the dashboard all work with no chat key at
all; asking a question is the single feature that requires one, and that is the honest place to
draw the line.

**Both abstention layers demonstrated, each firing on the case it exists for.** This is the part
I would have got wrong by building only one:

```
"What is the recommended HNSW ef_construction value for pgvector?"   (fully off-domain)
  → answered false · NO_RELEVANT_CONTEXT · top score 0.0164 · generate —ms · total 580ms
    the model is never called

"How many vacation days do Lumen employees get per year?"            (topic covered, answer not)
  → answered false · MODEL_DECLINED · top score 0.0328 · generate 2284ms

"What is the salary band for a senior developer at Lumen?"
  → answered false · MODEL_DECLINED · top score 0.0325 · generate 2505ms
```

The floor cannot catch the last two: `company-overview.md` scores 0.0328 because it genuinely
is about the company, it just does not mention holidays or pay. And the prompt rule cannot
replace the floor either, because doing so would spend a generation call on every off-domain
question. The prediction recorded at the end of Step 6 held exactly.

**The graded conflict case, verbatim.** The dataset's question 2 is marked as requiring the
answer to identify v2 as deprecated:

> To initialize the current SDK (v3), call `LumenSDK.init(config)` before any game code runs
> … [1]. `lumen.track` was the event method from the deprecated v2 SDK [2]. In v3, events are
> sent with `LumenSDK.event(name, payload)` instead … [1]. Note that v2 is superseded by v3 and
> should not be used for new playables [1][2].
>
> [1] sdk-notes-v3.md · [2] sdk-notes-v2.md

Worth noting *why* that works without any extra plumbing: the breadcrumb built in Step 4 puts
the document title into the embedded text, and these two titles are "Lumen SDK v3 (current)" and
"Lumen SDK v2 (DEPRECATED)". The supersession reaches the model because of a decision made three
steps earlier for a different reason.

**The near-duplicate case paying off end to end.** Asked about the December 2025 Merge Marina
delivery, the model was shown six near-identical delivery reports and cited `[4]` — the correct
month. Without `2025-12 · merge-marina` in each source header it could not have told source 4
from sources 1, 2, 3, 5 and 6, because their bodies are drawn from the same fifteen sentences.

**One contract detail this confirmed.** A real answer cited `[1][2][6]` — non-contiguous, because
the model cites the sources it used rather than the first three it was given. That is exactly why
`Citation` carries both `marker` and `sourceIndex` (Step 3), and it is a note for Step 11: the
chat page must resolve markers, never assume the nth citation is the nth source.

---

### Step 8 — Auth and authorization

- **AI did:** wrote the refresh-token table and migration, the Nest bootstrap and module graph,
  the token service, both guards and their decorators, the cookie helpers, the auth service and
  controller, the exception filter, the request-id middleware and the Zod validation pipe, plus
  22 end-to-end tests; then walked the whole flow over real HTTP with curl.
- **I wrote/rewrote:** two things.

  The **dummy password hash**. The first version was a hard-coded argon2 string, used to make a
  failed login take the same time whether or not the account exists. It was fabricated — a
  plausible-looking encoding that was not a real hash. `verifyPassword` rejects a malformed hash
  in microseconds instead of the ~50ms a real verification takes, so the constant would have
  produced exactly the timing difference it was written to remove, while looking like it worked.
  It is now computed once at startup from random bytes, which cannot be got wrong.

  The **direction of the guard default**. The first draft applied `@UseGuards` per controller.
  That satisfies "authorization on every route" only for as long as nobody forgets, and Step 9
  adds five endpoints where forgetting would be silent. Both guards are now global and routes
  opt *out* with `@Public()`, so a forgotten decorator produces a locked door rather than an
  open one.

- **Got it wrong:** the entire API answered 500 on every route while 22 tests passed.

  NestJS resolves constructor injection from `emitDecoratorMetadata`. **esbuild does not
  implement it**, and `tsx` — which I had used for the other CLIs in this app — is esbuild. So
  every injected dependency arrived as `undefined`, the first guard threw on
  `this.reflector.getAllAndOverride`, and the exception filter dutifully turned it into a clean
  `{"error":{"code":"INTERNAL"}}` for every single request, including login.

  The reason the tests did not catch it is the part worth keeping: vitest transforms with SWC,
  which *does* emit decorator metadata. **The test harness was more capable than the runtime.**
  A green suite proved the code was correct under a compiler the server was never going to use.

- **How I caught it:** by running the thing. The tests were green, so I started the server and
  ran the flow with curl to have output for the report, and the first request came back 500. The
  exception filter had already logged the real cause with a stack — which is the first time the
  "log the truth, return a request id" split earned its keep.

The fix is to compile the server with `tsc` and run it with `node`, leaving `tsx` for the CLIs,
which have no decorators. Then the linter demanded the opposite mistake: `consistent-type-imports`
flagged eight imports as type-only, and obeying it would have deleted the very runtime references
`emitDecoratorMetadata` needs — reintroducing undefined dependencies with no compiler error. The
rule is switched off for `apps/api` with that reason written down, because the next person to see
those errors will otherwise "fix" them.

**Design decisions worth defending in an interview:**

*Refresh tokens are stored, hashed, rather than being self-contained JWTs.* A stateless refresh
token can be rotated but never revoked, and — more importantly — reuse cannot be **detected**: a
stolen token and the legitimate one are indistinguishable. With a table, presenting an
already-rotated token means one of the two holders is an attacker, and since there is no way to
tell which, the whole family is revoked and both must log in again. Failing loudly for the honest
user is the right trade against leaving an attacker with a live session.

*SHA-256 for refresh tokens, argon2id for passwords.* Opposite choices because the inputs are
opposite. Argon2's cost exists to make guessing a human-chosen secret expensive; a refresh token
is 256 bits from the CSPRNG, so there is nothing to guess and a slow hash would only add latency
to every refresh.

*The two JWT secrets must differ, checked at startup.* Both tokens are JWTs signed by this
server, and the only thing stopping a refresh token being replayed as an access token is the key
it verifies under. There is a test that a token signed with the refresh secret — forged to claim
ADMIN — is rejected.

**Verified over HTTP, not only in tests:**

```
GET  /auth/me                       401  UNAUTHORIZED
POST /auth/login (admin)            200  no token in the body
     Set-Cookie: cl_access=…   Path=/;             HttpOnly; SameSite=Lax
     Set-Cookie: cl_refresh=…  Path=/auth/refresh; HttpOnly; SameSite=Lax
POST /auth/register  as USER        403  FORBIDDEN
POST /auth/register  as ADMIN       201
POST /auth/refresh   rotate         200
POST /auth/refresh   replay spent   401  → family revoked
POST /auth/refresh   successor      401  (proves the revocation cascaded)
Authorization: Bearer not.a.jwt     401
```

The refresh cookie's `Path=/auth/refresh` is visible in that output and is deliberate: the
long-lived credential is not attached to every ordinary API call, only to the one route that
consumes it.

---

### Step 9 — API endpoints

- **AI did:** wrote the stats contract, the RAG provider module, query logging, the search and
  SSE answer endpoints, the documents, ingest and stats modules, the throttler configuration and
  the Swagger setup; then exercised every route over HTTP with curl.
- **I wrote/rewrote:** three things where the first attempt was the convenient shape rather than
  the correct one.

  **The ingest endpoint returned the finished run.** Awaiting the pipeline inside the request is
  the obvious code and it is wrong here: a full pass is about a minute against a hosted
  embedding model, which exceeds every proxy and browser timeout in between. It now returns 202
  with the run row — measured at 60ms — and the client polls. That also happens to be what makes
  the dashboard's live status possible, so the constraint improved the design.

  **The SSE endpoint checked its chat provider too late.** The availability check sat inside the
  service, which meant an unconfigured chat model would raise a 503 *after* the stream had
  already sent a 200 status line, where the exception filter can no longer do anything. Anything
  knowable before the first byte has to be checked before the first byte.

  **The stats window was built with `sql.raw`.** The value is Zod-validated as a bounded integer,
  so it was in fact safe — but "safe because of a validator three files away" is the reasoning
  that stops being true the moment someone relaxes the validator. It is a bound parameter now,
  which needs no argument at all.

- **Got it wrong:** `GET /stats` returned 500 on the first real request, with
  `row.last_indexed_at.toISOString is not a function`.

  The generic on Drizzle's `db.execute<T>()` is an **assertion, not a check**. I had declared
  `last_indexed_at: Date | null` and TypeScript simply believed me. A raw SQL query does not go
  through the column-type decoding that the query builder applies, so Postgres's timestamp
  arrived as a string. The compiler was satisfied, the build was green, and the route failed on
  contact.

- **How I caught it:** by calling the endpoint. It is the same lesson as Step 8 and it arrived
  by the same route — everything compiled, everything passed, and the first curl found it. The
  timestamp fields are now typed `unknown` and narrowed through one helper, which is the honest
  description of what a raw query returns.

**A dependency I did not add.** `@nestjs/swagger` builds its schemas from decorated DTO classes,
which would have meant describing every payload twice — once as a Zod schema for the contract and
the client, once as a class for the docs — with nothing keeping them in agreement. Zod 4 emits
JSON Schema natively, so the documentation is generated from the same object that validates the
request. Fourteen schemas across thirteen paths, no bridging library.

**Verified over HTTP rather than asserted:**

```
POST /search    USER    200   0.0328 network-specs-applovin.md  (embed 551ms, retrieve 14ms)
GET  /documents USER    403   ADMIN 200
GET  /stats     USER    403   ADMIN 200
POST /ingest    USER    403   ADMIN 202 in 60ms, status RUNNING
POST /search    topK 9999     400  "topK: Too big: expected number to be <=20"
POST /ingest    {"corpusDir":"/etc"} → ran against sample_dataset/corpus (field is not accepted)
unauthenticated on all five new routes → 401

/search rate limit, 35 requests:  17× 200 then 18× 429
  {"error":{"code":"RATE_LIMITED","message":"Too many requests. Please wait a moment…"}}

/answer SSE:  7 token frames, then 1 result frame
  citations [(1, sdk-notes-v3.md), (2, sdk-notes-v2.md)]  timings embed 408 · generate 4860
/answer SSE on an unanswerable question:  0 token frames, "NO_ANSWER" appears nowhere
```

That last line closes the parking-lot item from Step 7. When the model declines it emits the raw
sentinel, and streaming it straight through would have made the user watch "NO_ANSWER" type
itself out before being replaced. The guard holds tokens only while what has arrived is still a
possible *prefix* of the sentinel — one token of delay for a real answer, nothing emitted for a
refusal. It lives in `packages/rag` rather than in the API, so the MCP server and anything else
added later gets it without knowing the problem exists.

**Two things I fixed that were cosmetic but revealing.** The throttler's default message renders
the literal string `"ThrottlerException: Too Many Requests"` into the error envelope — an
internal class name in a user-facing field, which is the same habit that leaks a SQL statement
somewhere more serious. And `abstainRate` now returns null rather than 0 when no questions have
been asked, because "0% abstention" and "no data" are different states and a dashboard that draws
them identically is lying about one of them.

---

### Step 10 — App shell and auth flow

- **AI did:** installed Next 15 and Tailwind 4, wrote the token-based theme, seven UI
  primitives, the login page and form, the app shell with role-aware navigation, the route
  middleware, the error and not-found boundaries, and the two placeholder pages; then drove the
  whole flow with a cookie jar as a browser stand-in.
- **I wrote/rewrote:** the route protection, twice, and both rewrites came from evidence rather
  than from reading the code again.
- **Got it wrong:** two separate mistakes in the same feature, and the second is the one worth
  remembering.

  **(1) A 404 page served with HTTP 200.** A `USER` typing `/dashboard` got the not-found page —
  correct content, wrong status. `notFound()` can only set a status while the response headers
  are still open, and the `loading.tsx` in that route group creates a Suspense boundary: the
  shell flushes as soon as the enclosing layout resolves, the status line is written as 200, and
  the `notFound()` thrown later in the page arrives too late to change it.

  **(2) Moving the check into a layout made it worse — it leaked the page.** The obvious fix was
  to gate earlier, in a `dashboard/layout.tsx`. That produced a response containing *both* the
  not-found markup and `"Corpus and analytics"` — the dashboard's own content — in the payload
  sent to a `USER`. React receives `children` as already-constructed elements, so a layout's
  `await` does not run *before* its children; they render alongside it. **An authorization check
  in a layout does not prevent the page below it from executing.** Today that leaked placeholder
  text. In Step 12 it would have leaked the document table.

- **How I caught it:** the first one from `curl -w '%{http_code}'` while collecting output for
  this report — the body said "Page not found" and the status said 200. The second from not
  trusting the fix: I re-ran the check and grepped the *USER's* HTML for a string that should
  only exist on the admin page. It was there. Neither would have shown up in a browser, because
  a browser renders the not-found page and never mentions what else came down the wire.

**The resulting design is better than what I started with.** Both problems disappear if the
decision is made in middleware, before any rendering and while the status is still ours to
choose. The middleware asks the API `/auth/me` rather than inspecting the cookie itself, which
makes it a *verified* check — the alternative is copying the JWT signing secret into a second
process to save one HTTP call. A `USER` reaching `/dashboard` is now redirected to `/chat`
before a single byte of that page is rendered, and the page keeps its own `requireRole` because
a matcher is a configuration line someone can narrow by accident.

**Verified rather than asserted**, with a cookie jar standing in for a browser:

```
anonymous  /chat        307 → /login?next=%2Fchat
anonymous  /dashboard   307 → /login?next=%2Fdashboard
           ?next=https://evil.example → ignored, no redirect  (open-redirect guard)
USER       /dashboard   307 → /chat   · dashboard content in payload: 0
USER       /chat        200           · Dashboard nav link present: 0
ADMIN      /dashboard   200           · Dashboard nav link present: 1
signed in  /login       307 → /chat

login: Access-Control-Allow-Origin: http://localhost:3000 · Allow-Credentials: true
       cookies stored across ports (cookies ignore port, so :3000 and :3001 are one site)
```

**One thing I decided rather than defaulted.** There are no `dark:` variants anywhere in the
app — 0 occurrences across every component. Colours are semantic tokens (`bg-surface`,
`text-muted`) defined once for each scheme in `@theme`, and the media query swaps the values.
Per-component `dark:` classes are how dark mode ends up correct on the pages someone looked at
and broken on the rest, and with two more UI steps to come that seemed worth settling now rather
than discovering later.

**Deliberately still placeholders.** `/chat` and `/dashboard` render an empty state and say
which step fills them in. The shell, the session handling, the navigation, the primitives and
the three required view states are real; the content is Steps 11 and 12, and pretending
otherwise in this report would be the easiest thing here to get wrong.

---

### Step 11 — Chat page

- **AI did:** wrote the SSE client, the citation-chip renderer, the source card, the chat panel
  with its four states, and the page around them; then drove the whole thing against a running
  API with both an answerable and an unanswerable question.
- **I wrote/rewrote:** the abstention rendering. The first version showed the refusal in the
  same error component as a failed request, which is wrong in a way that matters for this
  product specifically: a failed request means the system is broken, and an abstention means the
  system worked and the corpus has a gap. They now look different on purpose — abstention is
  warning-toned rather than red, the two `abstainReason` values get different explanations
  ("nothing scored highly enough to be worth asking the model" versus "the model read the
  passages and declined"), and the retrieved passages are still shown underneath so the refusal
  can be audited rather than taken on trust.
- **Got it wrong:** nothing that reached a running page this step — which is itself worth a
  sentence, because the two things most likely to have gone wrong had both already been caught
  and written down as parking-lot items in earlier steps, and I built against those notes rather
  than rediscovering them.

**The citation bug that did not happen.** Step 7's report recorded that a real answer had cited
`[1][2][6]` — markers are not contiguous, because the model cites only the sources it used and
the server drops any that point at a source it was never given. The obvious implementation
renders the nth citation as linking to the nth source. Both live questions this step happened to
produce contiguous markers, so I checked the skip case deterministically instead of hoping for
it:

```
markers written by the model: [1][2][6]
  chip [1]  resolved->applovin.md        nth-citation->applovin.md        same
  chip [2]  resolved->postmortem.md      nth-citation->postmortem.md      same
  chip [6]  resolved->build-pipeline.md  nth-citation->unity-meta.md      NAIVE WOULD BE WRONG
```

The third chip would have scrolled to the wrong document. That is the worst class of bug in this
feature: a citation exists so a reader can check a claim, and one that silently points somewhere
else breaks that while still looking correct.

**Two rules carried over rather than relearned.** The client's SSE reader holds a trailing
partial frame between network chunks — the same rule the server's provider parser needed, for
the same reason, and the same one that works perfectly on localhost and drops tokens under real
latency. And a new question aborts the in-flight stream, because two overlapping streams append
into the same state and interleave.

**Verified against a running system:**

```
in-corpus question   8 token frames, then result
                     markers [1,2] · citation.marker [1,2] · sourceIndex [0,1]
                     [1] -> sources[0] sdk-notes-v3.md  OK
                     [2] -> sources[1] sdk-notes-v2.md  OK

unanswerable         0 token frames · "NO_ANSWER" appears nowhere in the stream
                     answered false · MODEL_DECLINED · 6 passages still returned

off-domain           answered false · NO_RELEVANT_CONTEXT · generateMs null (model not called)
```

The middle line is the Step 7 parking-lot item closing: the sentinel guard added in Step 9 lives
in `packages/rag`, so the browser never sees the token even though it streams everything else.

**On the "phone-width" criterion.** I verified the layout the way I could without a browser —
the composition is flex-wrap throughout, there are no fixed pixel widths anywhere in the page,
controls are 44px tall, the header sheds the email below `sm`, and the source cards truncate
long titles rather than overflowing. What I have *not* done is look at it at 375px in a real
browser, and the plan asks for that explicitly. It is the one claim in this report I would want
to check myself before believing.

---

### Step 12 — Dashboard

- **AI did:** wrote the formatters, three more primitives (stat tile, table, pagination), the
  overview with its index-health and analytics cards, the volume chart, the documents table with
  filtering and pagination, the document detail with its chunks, the ingestion run list and
  detail, and the live "run ingestion" button; then drove every page and every filter against
  real data.
- **I wrote/rewrote:** what gets drawn as a chart. The first pass had a chart per metric — a
  small bar chart for document counts, another for latency. Almost none of that data is a chart:
  a single current value is a stat tile, and rendering it as a one-bar bar chart adds an axis and
  a plot area in order to communicate one number. Exactly one thing here is a genuine series over
  time, and that one gets a column chart. The rest are numbers, laid out as numbers.
- **Got it wrong:** a missing document answered **HTTP 200** with the not-found page.

  This is the same defect I diagnosed in Step 10 and it had followed me here. `notFound()` can
  only set a status while the response headers are still open; a `loading.tsx` creates a Suspense
  boundary, the shell flushes, the status line is written as 200, and the `notFound()` thrown
  afterwards is too late. In Step 10 I worked around it by moving the *authorization* decision
  into middleware, which fixed the case I was looking at and left the underlying cause in place
  for every other `notFound()` in the app.

- **How I caught it:** by checking status codes rather than bodies. `curl -w '%{http_code}'`
  against a random UUID returned 200 while the page said "Page not found" — the content was
  right and the contract was wrong, which is the combination a browser will never show you.

  This time I measured the cause instead of routing around it: removed the boundary, rebuilt,
  and the same request returned 404. So `loading.tsx` now exists on `/chat` alone — the one route
  with no not-found path — and the dashboard's detail pages get correct statuses. Nothing is
  lost, because those pages are server-rendered in tens of milliseconds and the loading states
  that actually matter live in the components that wait: the streaming answer skeleton and the
  ingestion button's spinner.

**A decision carried forward rather than relearned.** The dashboard layout holds sub-navigation
and deliberately no role check, because Step 10 established that React builds a layout's children
before the layout resolves — a gate there runs alongside the pages instead of in front of them.
Every page calls `requireRole` itself, and the middleware has already redirected before either
runs.

**Two small things that are really product decisions.** `chunksMissingEmbedding` has its own tile
with a warning tone rather than being folded into the chunk count: a chunk with no vector is
invisible to the vector arm, so retrieval is silently incomplete and nothing else in the system
would ever surface it. And the abstain rate renders as "—" rather than "0%" when nothing has been
asked, because a dashboard that draws "no data" and "nothing was refused" identically is lying
about one of them.

**Verified against real data:**

```
ADMIN 200 · USER 307 → /chat        on /dashboard, /dashboard/documents, /dashboard/runs
documents            1–20 of 142 · page 2 → 21–40 of 142
search=merge-marina  1–10 of 10        search=sdk  1–2 of 2
search=%             no matches        (the LIKE metacharacter is escaped, not a wildcard)
document detail      Lumen SDK v2 (DEPRECATED) · lifecycle deprecated · version 2
missing document     404              missing run  404
POST /ingest         202, run appears in the table as API COMPLETED within 4s
overview             142 documents · 142 chunks · 27,325 tokens · 0 failed · 0 missing embeddings
```

The `search=%` line is worth keeping: an unescaped `%` in a LIKE pattern matches everything, so
the filter would have appeared to work while silently not filtering. It is not an injection —
the term is a bound parameter — but it is the kind of bug that only shows up when someone types
a punctuation character into a search box.

**Still not verified, same as last step:** I have checked the layout composition — flex-wrap
everywhere, tables that scroll inside their own container rather than overflowing the page, no
fixed pixel widths — but I have not opened any of this at 375px in a real browser. That remains
the one claim in these last three reports I would want to check myself.

---

### Step 13 — MCP server

- **AI did:** moved the Drizzle retrieval adapter into `packages/db`, wrote the MCP server over
  Streamable HTTP with its two tools, the bearer-token authentication and the environment
  validation, and `apps/mcp/README.md` with the client config; then drove the protocol by hand —
  initialize, tools/list, tools/call — and compared its output against the REST API's.
- **I wrote/rewrote:** where the retrieval adapter lives. It had been sitting in
  `apps/api/src/retrieval/` since Step 6, which was fine while one app used it and became wrong
  the moment a second one did — an app cannot import another app. The tempting shortcut was to
  have the MCP server call `POST /search` over HTTP, which would have worked and would have
  quietly abandoned the claim the whole monorepo layout exists to support. Moving the adapter
  into `packages/db` costs one dependency edge and makes the claim literal.

  The edge is `db → rag`, which looks backwards until you name it: the *port*
  (`RetrievalRepository`) belongs to the domain package, the *adapter* to the infrastructure
  package, and an adapter depends on its port. `rag` still imports nothing from `db`, so
  retrieval remains unit-testable with no database at all.

- **Got it wrong:** nothing that survived to a running system this step. The one thing I nearly
  reported as a defect turned out to be my own measuring instrument, which is worth recording
  because I would have written down a false finding.

  Comparing the same query through both front doors, one score came back as `0.0312` from the
  API and `0.0313` from the MCP tool. My first instinct was that HNSW's approximate search had
  returned slightly different neighbours. Before writing that down I ran the API three times in
  a row and got an identical `0.03125` each time — so it was not run-to-run variance, and the
  difference had to be in the comparison. It was: my extraction script formatted the API's score
  with Python's `:.4f`, which rounds half-to-even, while the MCP tool renders with JavaScript's
  `toFixed(4)`, which rounds half-up. `0.03125` is exactly the tie case. Re-running the
  comparison with the same rounding on both sides gives byte-identical output.

- **How I caught it:** by not trusting a one-digit discrepancy enough to explain it. The
  explanation I had ready — approximate nearest-neighbour search — was plausible, which is what
  made it dangerous; it would have gone into this document as a real characteristic of the
  system. The check that killed it took thirty seconds.

**The architectural claim, measured:**

```
same query, POST /search vs the search_corpus MCP tool

API: guides/asset-naming.md@0.0325 | build-pipeline.md@0.0323 |
     incident-postmortem-2026-03.md@0.0313 | client-briefs/gloom-garden.md@0.0284
MCP: guides/asset-naming.md@0.0325 | build-pipeline.md@0.0323 |
     incident-postmortem-2026-03.md@0.0313 | client-briefs/gloom-garden.md@0.0284
                                              → identical
```

Not similar — the same `retrieve()`, the same SQL, the same fusion. The only thing that differs
between the two front doors is the transport and the shape of the reply.

**Authentication, and why it is two checks rather than one.** The signature is verified against
the *same* `JWT_ACCESS_SECRET` the API signs with, which is what "validated against the same user
store" means concretely: there is no second credential system to drift. On top of that the user
is looked up by id, and the role is taken from the database row rather than the token's claim. A
JWT is a bearer credential that cannot be withdrawn before it expires; an MCP client holds one by
hand for far longer than a browser does, so a deleted or demoted account should stop working now
rather than in fifteen minutes. The API can skip this because its tokens are short-lived and
revocation bites at the refresh; here it is worth one query.

**Verified:**

```
no token                     401 + WWW-Authenticate: Bearer realm="corpus-lens"
garbage token                401 — tool names are not enumerable without one
initialize                   protocol 2025-06-18, capabilities: tools
tools/list                   search_corpus, get_document
search_corpus topK=999       rejected: "Too big: expected number to be <=20 at topK"
search_corpus docType=guide  only guides/* returned
get_document (deprecated doc) surfaces lifecycle: deprecated in the metadata
get_document unknown id      isError, not an exception
```

That last `lifecycle` line is deliberate rather than incidental: the corpus ships a deprecated
document beside its replacement, and a client that cannot see which is which will quote
superseded guidance as current — the same failure the answering prompt's conflict rule exists to
prevent, arriving through a different door.

**What I have not done.** I drove the protocol with curl — the real handshake, the real headers,
the real SSE framing — but I have not attached a GUI MCP client such as Claude Desktop. The
config in `apps/mcp/README.md` is written from the transport's requirements rather than from
having watched a client consume it, and connecting one is the check I would want before calling
this done. The token's 15-minute default lifetime is the part most likely to bite there.

---

### Step 14 — Documentation

- **AI did:** wrote `README.md` and `docs/ADR.md`, then executed the README's own setup
  sequence against a genuinely clean clone and an empty database.
- **I wrote/rewrote:** the limitations section, which is the part of a README most likely to be
  quietly optimistic. Every entry there is a decision with its reasoning rather than a apology,
  and two of them are admissions that something was *not verified* rather than that it does not
  work — the UI has never been opened in a browser at 375px, and no GUI MCP client has ever been
  attached. Both were tempting to leave out. They are the two claims in this repository I would
  least want someone to discover for themselves in an interview.
- **Got it wrong:** the README did not work. Twice, in two different ways, and neither was
  visible from anything I had run before.

  **(1) A missing `pnpm build`.** Following the setup sequence verbatim, `pnpm ingest` failed
  with `Cannot find module .../@corpus-lens/db/dist/client.js`. The workspace packages are
  consumed through their `exports` map, which points at `dist/` — and `dist/` does not exist on
  a fresh checkout. `db:migrate` and `db:seed` had worked, because they run *inside*
  `packages/db` with relative imports, so nothing before that step revealed the gap.

  **(2) `pnpm dev` served a 500 on every web page.** The command the README tells a reader to
  run. `packages/shared` emitted CommonJS only; webpack applies its React Refresh transform to a
  workspace package's output, and that transform emits `import.meta.webpackHot`, which is a
  parse error inside a CommonJS file. Every page importing a shared *value* — the login form's
  Zod schema, the chat page's length limit — failed to compile.

  I had built and run the web app in production mode a dozen times across Steps 10–12 and it was
  always fine, because React Refresh is a development-only transform. The one thing I had never
  done was request a page while `pnpm dev` was running.

- **How I caught it:** by doing exactly what the plan says at this step — running the README on a
  clean clone instead of reading it. Both failures took under a minute to surface and neither
  was reachable from the repository I had been working in, where `dist/` had existed since Step 1
  and where I always started the web app with `next start`.

  My first fix for the second one was wrong, too: I removed `transpilePackages`, on the theory
  that it was what pulled the package into Next's compilation. It changed nothing — a symlinked
  workspace package resolves to a path outside `node_modules` and webpack treats it as
  first-party either way. The actual fix is that a package consumed by both a CommonJS Node
  process and a bundler has to ship both formats, so `packages/shared` now emits CJS and ESM
  with an `exports` map that offers each to the right consumer.

**The clean-clone run, end to end.** Cloned to a new directory, corpus copied in, `.env` from
`.env.example`, fresh Postgres on an empty volume:

```
tracked files 188 · .env absent · sample_dataset absent · forbidden files 0

pnpm install        ok
pnpm build          ok            ← the step the README was missing
docker compose up   0 tables before migrate
pnpm db:migrate     Migrations applied
pnpm db:seed        created ADMIN admin@demo.local · created USER user@demo.local
pnpm ingest         142 discovered · 142 added · 142 chunks · 65.3s

pnpm ask  (in corpus)     answered true, cited network-specs-applovin.md + the postmortem
pnpm ask  (vacation days) answered false · MODEL_DECLINED
pnpm eval                 8/9 answerable, q1–q5 all at rank 1
pnpm typecheck / test     118 tests pass
pnpm dev                  web 200 · api /docs 200 · mcp /health 200
login with the README's demo credentials → 200, dashboard renders
```

The 8/9 reproducing on a machine that had never seen this project is the number I most wanted to
confirm — it means the eval result is a property of the system rather than of my working
directory.

**On `docs/ADR.md`.** Twelve records, each written as decision / rejected alternative / why.
Several of them exist because the rejected alternative was tried first and measured: the
weighted-score fusion, the constant abstention threshold, the layout-level authorization check,
the cookie-presence middleware. Those records are more useful than the ones where the first
choice was right, and they are the ones I would expect to be asked about.

---

## Closing note

Fourteen steps, each one committed separately after review. The pattern that produced most of
the value in this log is visible across all of them and worth stating plainly: **the compiler,
the linter and the test suite were green for every single defect recorded here.** A CommonJS
package that broke the dev server, an authorization check that leaked the page it was guarding,
a 404 that answered 200, an ORM error message containing the whole SQL statement, an API key
echoed into the database, a keyword arm that silently returned nothing, a dummy hash that
defeated the timing attack it was written to prevent — every one of them was found by running
the thing and looking at the output, and not one of them by reading the code again.
