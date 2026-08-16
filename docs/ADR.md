# Design decision records

The decisions that were not obvious, with the reasoning that produced them. `STATE.md`
carries the full running list; this file holds the ones worth defending in conversation,
and it records what was **measured** rather than what was assumed.

Each record is: the decision, the alternative that was rejected, and why.

---

## ADR-001 — One Postgres instance, not a database plus a vector store

**Decision.** Documents, users, chunks, embeddings, ingestion history and query analytics
all live in a single PostgreSQL 16 instance with pgvector.

**Rejected.** Postgres for relational data plus a dedicated vector database (Pinecone,
Qdrant, Weaviate).

**Why.** A separate vector store introduces a synchronisation problem that has no good
solution at this size: a document and its vectors can no longer be written in one
transaction, so a crash between the two writes leaves an index that disagrees with the
corpus, and every repair path is a background job somebody has to own.

The decisive argument is smaller and more concrete, though. Postgres gives `tsvector` for
free, and full-text search is exactly the second retrieval arm hybrid search needs — so
choosing one store did not merely avoid a cost, it supplied a feature. Hybrid retrieval
went from "a second system to run" to "one more index on a table we already had".

**Consequence.** `chunks.search_vector` is a generated STORED column, so the keyword index
cannot drift from the content it indexes. The two-argument `to_tsvector('english', …)` is
required — only that form is IMMUTABLE and therefore legal in a generated column.

---

## ADR-002 — Chunk on structure first, size second — and merge

**Decision.** Split on Markdown headings. If a section exceeds 500 tokens, split on
paragraph then sentence boundaries with 60 tokens of overlap, never mid-sentence. Then
**greedily merge** adjacent sections back together while the running total fits.

**Rejected.** Fixed-size sliding windows; and separately, tuning the budget down to the
corpus's observed sizes.

**Why.** Measured before writing any chunker (`docs/CORPUS.md`): the largest document in
the corpus is **217 tokens** and no section exceeds 169. A size-based splitter has nothing
to split — the splitting machinery would be dead code and the *merge* is what actually
runs, collapsing each document into one chunk (142 documents → 142 chunks, confirmed).

Tuning the budget down to ~200 to "fit" would be overfitting to a 23k-token sample and
would break the requirement that pointing ingestion at another directory is a
configuration change. The structural rule does the work; the size rule is a safety valve
this corpus never trips.

**Consequence.** When sections merge, their shared heading path becomes the breadcrumb and
the deeper headings are written back into the body — a heading is either in the breadcrumb
or in the text, never dropped.

---

## ADR-003 — The breadcrumb carries path metadata, not just headings

**Decision.** Every chunk is embedded with a prefix of
`Title [docType · date · subject] > Section`, extending the plain
`Document > Section > Subsection` convention.

**Rejected.** Headings only.

**Why.** A measurement: the 78 delivery reports — 68% of the corpus by token count — are
assembled from **15 distinct sentences**. Their bodies are near-identical, so their
embeddings are near-identical, and cosine ranking between them is noise. What separates
`2025-05-bubble-bakery.md` from `2025-12-merge-marina.md` is the date and the game, and
both live in the *filename*.

**Measured.** Embedding all 142 chunks twice and querying *"Bubble Bakery December 2025
delivery report"*: with the breadcrumb, all five top hits are Bubble Bakery delivery
reports; without it, **not one delivery report appears in the top five** — they are all
meeting notes.

**Unplanned consequence.** The conflict/deprecation rule (ADR-007) works without extra
plumbing, because the breadcrumb puts the document title into the embedded text and those
titles are "Lumen SDK v3 (current)" and "Lumen SDK v2 (DEPRECATED)".

---

## ADR-004 — Reciprocal Rank Fusion, not a weighted score sum

**Decision.** Fuse the two arms with `score = Σ 1/(60 + rank)`, using only each arm's
ordering.

**Rejected.** `α · cosine + (1−α) · normalised_ts_rank`.

**Why.** The two scores are not comparable quantities. Cosine similarity on this corpus
sits densely in a narrow band; `ts_rank` is unbounded, depends on term frequency and
document length, and is routinely 0.05 for an excellent keyword match. Any weighted sum
therefore needs a normalisation, and that normalisation is itself a tuned guess — one that
shifts silently the moment the embedding model changes, because the cosine distribution
moves under it.

RRF reads only rank, so there is nothing to normalise and nothing to retune when the model
changes.

**On k = 60.** The published default, and its effect is what we want here: it flattens the
difference between top ranks (rank 1 scores 1/61, rank 2 scores 1/62 — a 1.6% gap), so a
document *both* arms rank reasonably beats one that a single arm ranks first and the other
misses. The two arms fail in different directions, so agreement between them is a stronger
signal than confidence within one.

**Consequence.** The fused score is not a similarity and not a probability — it only orders
results within one query. The UI labels it accordingly.

---

## ADR-005 — The keyword arm rewrites the query to OR

**Decision.** Before `websearch_to_tsquery`, the question's terms are joined with `or`.

**Rejected.** Passing the question through unchanged.

**Why.** This was a bug, found by measurement, and it is the most consequential line in the
keyword arm. **Every** Postgres tsquery constructor — `websearch_to_tsquery`,
`plainto_tsquery`, `phraseto_tsquery` — joins the terms it finds with AND:

```
websearch_to_tsquery('english', 'How many vacation days do Lumen employees get?')
  → 'mani' & 'vacat' & 'day' & 'lumen' & 'employe' & 'get'
```

Against 200-token chunks that matches nothing. The keyword arm was returning zero rows for
most of the evaluation set, RRF was fusing one list with an empty one, and "hybrid"
retrieval was silently vector-only — with every test passing, because the unit tests feed
fusion two lists and never exercise the SQL.

OR is the right semantics because recall is the keyword arm's job and precision is
`ts_rank`'s: it scores how many distinct query lexemes a chunk covers and how densely, so
a chunk matching "applovin" *and* "size" still outranks one matching only "size". AND is
not lost — it is demoted from a hard filter to a ranking signal.

**Consequence.** `websearch_to_tsquery` is kept rather than assembling a `to_tsquery`
string, because it is the only constructor that cannot be made to raise on hostile input —
so there is no query-injection surface even though the terms come from a user.

---

## ADR-006 — Abstention in two independent layers, with a derived floor

**Decision.** A retrieval score floor short-circuits before the model is called, *and* the
prompt instructs the model to return a sentinel. The floor is
`1/(k+1) + 1/(k+candidates)` = **0.0289**.

**Rejected.** A single mechanism; and separately, a hand-picked threshold.

**Why two layers.** They catch different failures, and the data shows neither alone
suffices:

| Question | Top score | Caught by |
|---|---|---|
| "recommended HNSW ef_construction for pgvector" | 0.0164 | **Floor** — model never called |
| "how many vacation days" | 0.0328 | **Prompt** — clears the floor easily |
| "salary band for a senior developer" | 0.0325 | **Prompt** |

`company-overview.md` scores 0.0328 for the vacation question because it genuinely *is*
about the company — it simply does not mention holidays. No score floor can catch that
without also rejecting real questions. Conversely, the prompt alone would spend a
generation call on every off-domain question.

**Why the floor is derived.** The first version was `MIN_SCORE = 0.02`, chosen because it
sat between the numbers I had just measured — which is the definition of fitting a
threshold to a sample. The expression above is the score of a chunk ranked **first by one
arm and last-of-candidates by the other**, so it asserts one thing in English: *at least
one chunk was found by both retrieval arms*. It evaluates to 0.0289, lands cleanly between
the two clusters, and moves correctly if `k` or the candidate budget ever changes.

**Consequence.** `answered` is a boolean on the wire, so the UI renders abstention as its
own state and the abstain rate is a metric rather than a string search over answer text.

---

## ADR-007 — Citations are validated server-side, and markers are resolved not counted

**Decision.** Resolve every `[n]` the model writes against the context that was actually
supplied. Drop unknown markers from the citation list *and* strip them from the prose. The
UI maps `marker → sourceIndex`.

**Rejected.** Trusting the model's markers; and rendering the nth citation as the nth
source.

**Why.** A citation exists so a reader can check a claim. A marker that resolves to nothing
— or to the wrong document — is worse than no citation at all, because it converts an
unverifiable claim into one that *looks* verified.

The second half matters as much as the first. After validation the surviving markers are
no longer contiguous, and the model cites only the sources it used: a real answer cited
`[1][2][6]`. Rendering "the nth citation" would send the third chip to `unity-meta.md`
instead of `build-pipeline.md` — silently wrong, and invisible in a browser.

**Consequence.** `Citation` carries both `marker` (what the model wrote) and `sourceIndex`
(where it points), because after dropping one they are no longer the same number.

---

## ADR-008 — Guards are global; routes opt *out*

**Decision.** `JwtAuthGuard` and `RolesGuard` are registered as `APP_GUARD`. A route
becomes public with an explicit `@Public()`.

**Rejected.** `@UseGuards(JwtAuthGuard)` per controller.

**Why.** Per-controller guards satisfy "authorization on every route" only for as long as
nobody forgets, and forgetting is invisible — a new endpoint simply works, for everyone.
Registered globally, the default for a new route is *authenticated*, and exposing one takes
a deliberate decorator. The failure mode of forgetting becomes a locked door rather than an
open one.

**Consequence.** `POST /auth/login` and `/auth/refresh` carry `@Public()`, and there is a
test asserting that every other route answers 401 without a session.

---

## ADR-009 — Refresh tokens are stored and hashed, not self-contained

**Decision.** Refresh tokens are 256 random bits, stored as a SHA-256 hash with an
expiry, a revocation timestamp and a pointer to their replacement. Presenting an
already-rotated token revokes the entire family.

**Rejected.** A second JWT with a longer expiry.

**Why.** A stateless refresh token can be *rotated* but never *revoked*, and — more
importantly — its reuse cannot be **detected**: a stolen token and the legitimate one are
indistinguishable, so a theft is invisible. With the tokens recorded, presenting one that
has already been rotated means one of the two holders is illegitimate. Since there is no
way to tell which, both are cut off. Forcing an honest user to log in again is the right
trade against leaving an attacker with a live session.

**On SHA-256 rather than argon2.** The opposite choice to passwords, for opposite inputs.
Argon2's cost exists to make guessing a *human-chosen* secret expensive; this value is 256
bits from the CSPRNG, so there is nothing to guess and a deliberately slow hash would only
add latency to every refresh.

**Consequence.** The two JWT secrets must differ, checked at startup: both tokens are JWTs
signed by this server, and the key each verifies under is the only thing stopping a
refresh token being replayed as an access token. There is a test for it.

---

## ADR-010 — The retrieval adapter lives in `packages/db`, which depends on `packages/rag`

**Decision.** `RetrievalRepository` (the port) is defined in `packages/rag`; the Drizzle
implementation (the adapter) lives in `packages/db`, which therefore depends on
`packages/rag`.

**Rejected.** Keeping the adapter in `apps/api` and having the MCP server call
`POST /search` over HTTP.

**Why.** The rejected option would have worked, and would have quietly abandoned the claim
the whole monorepo layout exists to support. The adapter had lived in `apps/api` since it
was written, which was fine while one app used it and became wrong the moment a second one
did — an app cannot import another app.

The dependency edge looks backwards until it is named: this is ports and adapters. The
interface belongs to the code that *defines the need* (the domain package), the
implementation to the code that *satisfies* it (the infrastructure package), and an adapter
depends on its port. `packages/rag` still imports nothing from `packages/db`, so chunking,
fusion, citation validation and the abstain rule remain unit-testable with no database.

**Measured.** The same query through `POST /search` and through the `search_corpus` MCP
tool returns byte-identical results. The MCP tool is not a reimplementation of search — it
is the same `retrieve()` over the same SQL, differing only in transport.

---

## ADR-011 — The offline embedding provider is a product feature, not a test double

**Decision.** `EMBEDDING_PROVIDER=deterministic` selects a local hashing-trick provider
that implements the same interface and carries the same input and batch limits as the
hosted one.

**Rejected.** A mock injected in tests; and separately, an equivalent stand-in for
generation.

**Why.** Everything downstream of a vector — ingestion, retrieval, the dashboard, the MCP
tool — is otherwise unrunnable without an API key, and "clone it and watch it work" is a
scored setup criterion. Making it a real provider selected by configuration means the tests
exercise the same code path production uses, rather than a parallel one that rots. Sharing
the limits means an offline run fails wherever an online run would.

**Why there is no offline chat provider.** A hashing trick can stand in for an embedding
model because both produce a vector whose only job is to be compared. Nothing can stand in
for generation: canned text would make the abstain rule and the citation validator *look*
exercised when they had never run. Search, ingestion and the dashboard work with no chat
key; asking a question is the one feature that genuinely requires one.

**Consequence.** The offline provider matches vocabulary, not meaning, so both `pnpm
ingest` and `pnpm eval` print a warning that its numbers are not a measure of retrieval
quality.

---

## ADR-012 — Route protection is decided in middleware, by asking the API

**Decision.** Next.js middleware calls the API's `/auth/me` and decides before any page
renders. Pages repeat the check.

**Rejected.** Inspecting the session cookie in middleware; and gating in a layout.

**Why.** Both alternatives were tried and both were wrong in ways only running them
revealed.

A check in a **layout** does not stop the page below it rendering: React receives
`children` as already-constructed elements, so the layout's `await` runs *alongside* the
page rather than in front of it. The dashboard's markup was serialised into the response
sent to a `USER` who was being turned away.

And `notFound()` cannot set a 404 once a `loading.tsx` Suspense boundary has flushed the
shell — the status line is already written, so a forbidden route answered **200** with the
right page.

Deciding in middleware happens before any rendering and while the status is still ours.
Asking the API rather than inspecting the cookie makes it a *verified* check; the
alternative is copying the JWT signing secret into a second process to save one HTTP call.

**Consequence.** `loading.tsx` exists only on `/chat`, the one route with no not-found
path. Nothing is lost: the dashboard renders in tens of milliseconds and the loading states
that matter live in the components that actually wait.

**Note.** None of this is load-bearing for security. It decides what to *render*; the API
independently refuses whatever the renderer gets wrong.

---

## ADR-013 — Hybrid retrieval is kept despite the comparison table not endorsing it

**Decision.** Keep RRF over both arms, even though keyword-only matches hybrid's recall and
beats its MRR on the evaluation set.

**Rejected.** Dropping the vector arm; and separately, tuning `k` until hybrid wins.

**Why.** The measurement, over 13 answerable queries at k=6:

| Mode | recall@6 | MRR |
|---|---:|---:|
| hybrid | 0.923 | 0.737 |
| vector-only | 0.846 | 0.612 |
| keyword-only | 0.923 | **0.833** |

Hybrid beats vector-only clearly — `loop_complete`, a snake_case event name appearing once
in the corpus, is missed *entirely* by the vector arm and found at rank 1 by keyword. That
is exactly the blind spot a keyword arm exists to cover.

Keyword-only, though, is not beaten. On this corpus that is a real result rather than
noise: 23k tokens of internally consistent documentation, where questions reuse the
vocabulary of the documents that answer them, is close to a best case for lexical matching.
Two paraphrase queries were written specifically to find a case where keyword search fails,
and it found both at rank 1.

The MRR gap has an intended cause. `k = 60` flattens the top ranks so agreement between
arms outweighs confidence within one (ADR-004), so a document keyword ranks 1st and vectors
rank 5th lands at hybrid rank 2 or 3. The constant was chosen for that behaviour; the table
shows what it costs.

**So why keep it.** Thirteen queries is far too small a sample to make an architectural
decision on, and the case keyword-only fails — genuine paraphrase with no shared vocabulary
— is real, is common in larger and less consistently written corpora, and is simply not
represented here. Dropping an arm or retuning `k` on this evidence would be fitting the
design to the sample, which is the same error ADR-002 refuses for chunk size.

**What the table actually supports** is narrower than "hybrid is better", and that is the
claim worth making: *hybrid is never worse than the better arm on recall, and it removes
the vector arm's blind spots.*

**Consequence.** The comparison is in the README rather than only in this file, including
the row that does not flatter the design. An evaluation that only ever confirms the choice
already made is decoration.
