# STATE.md

Single source of truth for progress. Claude Code updates this at the end of every
step, before writing the completion report. Read it at the start of every session.

**Current step:** all P0 steps complete — bonuses (15–19) remain
**Last completed step:** 14 — Documentation
**Last commit:** `85e2192` · Step 14 pending

| Step | Commit |
|---|---|
| 0 — Corpus recon | `a6e1ee9` |
| 1 — Monorepo scaffold | `12dc838` _(shared with Step 2, see below)_ |
| 2 — Database schema | `12dc838` |
| 3 — Shared contracts | `4de1015` |
| 4 — Chunking + embeddings | `7d7ee00` |
| 5 — Ingestion pipeline | `1769e43` |
| 6 — Hybrid retrieval | `1702e0b` |
| 7 — Grounded answering | `c84e806` |
| 8 — Auth and authorization | `767c7b3` |
| 9 — API endpoints | `0f2c553` |
| 10 — App shell and auth flow | `e8e66dd` |
| 11 — Chat page | `c119f58` |
| 12 — Dashboard | `8636ecc` |
| 13 — MCP server | `85e2192` |

> **Note on the history.** The first attempt committed all 143 `sample_dataset/` files and
> the case PDF, both forbidden by `CLAUDE.md` §1 and §5, and a later `--amend` landed on
> the wrong commit — leaving Steps 1 and 2 squashed together. The history was rewritten
> from the root (nothing had been pushed): both commits now carry zero forbidden files,
> verified with `git ls-tree`. Steps 1 and 2 were left as one commit rather than split,
> because a reconstructed Step 1 commit would not compile — `apps/api` already imports
> `@corpus-lens/db/client`. The commit message describes both steps honestly instead.
>
> Remaining cleanup, whenever convenient: `git branch -D backup-before-rewrite` then
> `git reflog expire --expire=now --all && git gc --prune=now`. Until then the old dirty
> commits are still reachable from that backup branch.

---

## Progress

| # | Step | Priority | Status |
|---|---|---|---|
| 0 | Corpus recon | P0 | ✅ done |
| 1 | Monorepo scaffold | P0 | ✅ done |
| 2 | Database schema | P0 | ✅ done |
| 3 | Shared contracts | P0 | ✅ done |
| 4 | Chunking + embeddings | P0 | ✅ done |
| 5 | Ingestion pipeline | P0 | ✅ done |
| 6 | Hybrid retrieval | P0 | ✅ done |
| 7 | Grounded answering | P0 | ✅ done |
| 8 | Auth and authorization | P0 | ✅ done |
| 9 | API endpoints | P0 | ✅ done |
| 10 | App shell and auth flow | P0 | ✅ done |
| 11 | Chat page | P0 | ✅ done |
| 12 | Dashboard | P0 | ✅ done |
| 13 | MCP server | P0 | ✅ done |
| 14 | Documentation | P0 | ✅ done |
| 15 | Self-updating ingestion | P2 | ⬜ |
| 16 | Evaluation harness | P2 | ⬜ |
| 17 | OIDC for MCP | P2 | ⬜ |
| 18 | Live deployment | P2 | ⬜ |
| 19 | Polish | P2 | ⬜ |

Status key: ⬜ not started · 🔄 in progress · ✅ done · ⏭️ deferred · ❌ cut

---

## Decisions made during the build

Anything that departs from `CLAUDE.md` §3 or §6, with its reason. Mirror the
substantial ones into `docs/ADR.md`.

| Step | Decision | Reason |
|---|---|---|
| 0 | Chunker splits on `##` then **greedily merges** adjacent sections up to the 500-token budget, instead of only splitting | Max document is 217 tokens, so a split-only chunker never fires. Merging makes the code correct on this corpus and portable to a corpus of long documents (`CLAUDE.md` §5). Yields ~142 chunks, 1 per document. |
| 0 | Keep budget at 500 / overlap 60 rather than tuning down to the observed ~200 | Tuning to a 23k-token sample is overfitting and would break "point it at another folder". The structural rule does the work; the size rule is a safety valve this corpus never trips. |
| 0 | Breadcrumb carries `doc_type · date · subject` from the path, not just headings — extends `CLAUDE.md` §6 | 78 delivery reports are built from 15 distinct sentences; body text cannot separate them, filename metadata can. Highest-leverage retrieval decision found in recon. |
| 0 | Add a **conflict/deprecation rule** to the generation prompt — proposed change to `CLAUDE.md` §6 | Shipped question 2 explicitly grades whether the answer says SDK v2 is deprecated. Retrieval alone does not satisfy it. |
| 0 | Min chunk size 80 tokens (fragments merge into a neighbour) | The 6 changelogs are 21–70 tokens; standalone they are low-signal chunks. |
| 1 | Packages compile to CJS with `module`/`moduleResolution` = **Node16**, not `node` | Packages expose subpath exports (`@corpus-lens/shared/foo`) instead of barrel files, per §7. The node10 resolver silently ignores an `exports` map, so the first build failed; Node16 honours it while `type: commonjs` keeps the emit CJS and relative imports extension-free. |
| 1 | `tsconfig.base.json` holds only the strictness contract — no `module`/`target`/`lib` | NestJS needs CJS + decorator metadata, Next.js needs ESM + the bundler resolver. A shared module setting would have to be overridden by both, so it does not belong in the base. |
| 1 | Frameworks (Nest, Next, Drizzle, MCP SDK) are **not** installed in this step | §2.6: every dependency arrives in the step whose code justifies it, so each one is explainable. Apps are placeholder entry files that import the packages to prove the wiring. |
| 1 | Prettier ignores `*.md` | `CLAUDE.md`, `PLAN.md`, `STATE.md` and `docs/` are hand-wrapped scored deliverables; reflowing them produces noisy diffs. |
| 1 | `CREATE EXTENSION vector` lives in `docker/init-pgvector.sql`, not in a migration | It needs superuser rights the application role should not hold at migration time. Migrations can then assume the type exists. |
| 2 | Email is normalised to lower-case in `normalize-email.ts` and the unique constraint sits on the **column**, not on `lower(email)` | Drizzle's `onConflictDoUpdate` can only target a column, not an expression, so a `lower(email)` index would force raw SQL for every insert. **Load-bearing consequence: Step 8 auth must call `normalizeEmail` on login**, or a user who capitalises their email will not be found. |
| 2 | `@node-rs/argon2` instead of the `argon2` package | Prebuilt binaries, so a fresh `pnpm install` needs no C toolchain. The case is graded on clean-machine setup. Parameters are the OWASP argon2id 19 MiB profile. |
| 2 | `doc_type` and `lifecycle` are plain `text`, not enums | They are derived from the folder names of whatever directory ingestion is pointed at. An enum would turn "point it at another corpus" into a migration, breaking §5. Enums are used only for values this system defines. |
| 2 | `search_vector` is a **generated STORED** tsvector, with the two-argument `to_tsvector('english', …)` | Postgres only allows IMMUTABLE expressions in a generated column; the one-argument form depends on a session setting and is rejected. Generated means the FTS index can never drift from the content. |
| 2 | `search_queries.user_id` is nullable with `ON DELETE SET NULL` | Deleting a user must not delete the analytics history; a query's value as a metric does not depend on who asked it. |
| 2 | The table set is assembled only in `client.ts`; no barrel file | Drizzle's query builder needs one schema object and `drizzle.config.ts` takes a glob, so nothing else has to re-export the tables (§7). |
| 2 | HNSW kept at defaults (m=16, ef_construction=64) | With ~142 chunks the index barely affects latency; tuning numbers that cannot be measured at this scale would be theatre. Recorded so the choice reads as deliberate. |
| 2 | The postgres.js connection filters notice codes `42P06`/`42P07`/`42710` and prints the rest | The migrator's `IF NOT EXISTS` statements raise these on every run after the first, and postgres.js dumps the whole notice object to stderr — indistinguishable from a crash to someone following the README. Silencing *all* notices would trade a cosmetic problem for a diagnostic one. |
| 3 | `packages/shared` re-declares the role, document-status and ingestion enums rather than importing them from `packages/db` | Shared is consumed by the browser and must carry no database dependency. The values are duplicated deliberately; the row→DTO mapping in the API is the single place the two meet, so a mismatch fails there rather than silently. |
| 3 | `POST /ingest` does **not** accept a corpus directory from the client | It would let an authenticated admin walk any directory the API process can read — path traversal dressed up as a feature. The directory comes from `CORPUS_DIR` on the server. |
| 3 | Auth responses carry no tokens in the body | Access and refresh JWTs travel in httpOnly cookies; returning them in the body hands back exactly what the cookie flag exists to withhold. |
| 3 | `Citation` carries both `marker` and `sourceIndex` | The server drops citation markers that do not match the supplied context, after which the surviving markers are no longer contiguous. The UI has to resolve what the model actually wrote, not what it should have written. |
| 14 | `packages/shared` emits **both** CJS and ESM | It is consumed two ways: by CommonJS Node processes and by a bundler. CJS-only broke `pnpm dev` for the web app — webpack applies its React Refresh transform to a workspace package's output and that transform emits `import.meta`, a parse error inside a CommonJS file. Production was unaffected because Refresh is dev-only, which is why it survived until the README was executed end to end. The ESM output is bundler-only and never loaded by Node, which is why extensionless relative imports are safe in it. |
| 14 | `transpilePackages` removed from `next.config.mjs` | It was there on the theory that it saved building the packages first. That was never true — the `exports` map points at `dist/` — and it made Next treat built output as first-party source. |
| 14 | `pnpm build` added to the documented setup sequence | Found by running the README on a clean clone: `pnpm ingest` failed with `Cannot find module .../@corpus-lens/db/dist/client.js`. The packages are consumed through `dist/`, which does not exist on a fresh checkout. |
| 13 | The Drizzle retrieval adapter **moved** from `apps/api` to `packages/db`, and `db` now depends on `rag` | Both apps construct it, and an app may not import another app. The direction is the ports-and-adapters one: the port (`RetrievalRepository`) belongs to the domain package, the adapter to the infrastructure package, and the adapter depends on the port. `rag` still imports nothing from `db`, so retrieval stays testable with no database. This is what makes "the MCP tool is not a reimplementation" literally true rather than aspirational — **verified byte-identical results** through both front doors. |
| 13 | The MCP server verifies JWTs itself with the **same `JWT_ACCESS_SECRET`**, and additionally looks the user up | §9: it is a second front door to the same data. Sharing the secret is what "validated against the same user store" means concretely — no second credential system to keep in sync. The database lookup is the extra: a JWT cannot be withdrawn before it expires, and an MCP client holds a token by hand for much longer than a browser does, so a deleted account should stop working immediately. The **role comes from the row, not the claim**. |
| 13 | Authentication runs **before** the MCP handshake | An unauthenticated caller must not be able to enumerate tool names — that is information about the system it has no claim to. Verified: a garbage token gets 401 and no tool list. |
| 13 | Stateless mode — a fresh server and transport per request, no session ids | A session map means holding caller identity in memory and deciding when to evict it; a session would also outlive a revoked user. Every request carries its own token and is judged on its own merits. The transport and server are closed on `response.close` so per-request objects do not leak. |
| 13 | Streamable HTTP rather than stdio | §3's reason, and it holds up: a stdio server has no request to carry a credential on, so authenticating it means inventing a mechanism. Over HTTP the credential is an ordinary `Authorization` header and the Step 17 OIDC swap touches one file. `WWW-Authenticate` is already returned on 401 — the hook an OIDC flow advertises itself through. |
| 13 | Tool bounds come from `packages/shared/limits` | An MCP client is not a friendlier caller than a browser; an unbounded `topK` is the same denial-of-service against the embedding bill. Verified: `topK: 999` is rejected by the tool's own schema. |
| 12 | Headline numbers are **stat tiles, not charts**; only volume-over-time is plotted | A single current value rendered as a one-bar chart adds axes and a plot area to communicate one number. The one genuine time series gets a single-hue column chart with no legend — a legend for one series just repeats the title. |
| 12 | The chart is ~30 lines of divs and CSS, with no charting dependency and no client JavaScript | It is one single-series column chart; a charting library would be the largest dependency in the web app by an order of magnitude. Hover is CSS-only, so the whole dashboard stays server-rendered. |
| 12 | `loading.tsx` exists **only** on `/chat`, not app-wide | A `loading.tsx` creates a Suspense boundary, and once the shell has flushed the status line is written — so `notFound()` beneath it cannot produce a 404 and a missing document answered **200**. Measured both ways: with the boundary 200, without it 404. Dashboard detail pages need the status, chat has no not-found path. Nothing is lost: those pages render in tens of milliseconds and the loading states that matter are in the components that actually wait. |
| 12 | The dashboard layout carries sub-navigation but **no** authorization check | The Step 10 lesson, applied rather than relearned: React builds a layout's children before the layout resolves, so a gate there runs alongside the pages instead of in front of them. Every page calls `requireRole` itself. |
| 12 | `chunksMissingEmbedding` gets its own stat tile with a warning tone | A chunk with no vector is invisible to the vector arm, so retrieval is quietly incomplete and nothing else in the system would ever say so. |
| 12 | Filters navigate to a URL rather than fetching into client state | The filtered view becomes a real address — linkable, bookmarkable, reloadable — and the table stays server-rendered instead of moving the document list into browser memory. |
| 12 | Query strings are rebuilt from known keys, not forwarded verbatim | The API validates its own input, but passing an arbitrary client query string straight through is how an unintended parameter reaches a backend that happens to understand it. |
| 11 | A citation chip resolves `marker` → `citation.sourceIndex`, never "nth citation is nth source" | The Step 7 parking-lot item, and the naive version is silently wrong rather than broken. Demonstrated with the real `[1][2][6]` case: the third chip would scroll to `unity-meta.md` instead of `build-pipeline.md`. A citation exists so a claim can be checked; one pointing at the wrong passage breaks that while still looking right. |
| 11 | The SSE reader holds a trailing partial frame between network chunks | Same rule as the server's provider parser, for the same reason: a chunk boundary lands mid-JSON routinely, and a parser assuming whole frames works on localhost and drops tokens the moment there is real latency. |
| 11 | `fetch` + `ReadableStream`, not `EventSource` | `EventSource` only issues GET and cannot send a body or credentials, and the question has to be POSTed. |
| 11 | A new question **aborts** the in-flight stream | Two overlapping streams append tokens into the same state and produce interleaved nonsense. An abort is also distinguished from a failure, so cancelling does not render an error. |
| 11 | Abstention renders as its own state — warning-toned, not an error | The system working correctly and the corpus lacking an answer are the same event. `answered` is a boolean on the wire precisely so this branch can exist, and the two `abstainReason` values get different explanations because "nothing scored highly enough" and "the model read them and declined" are different facts about the corpus. |
| 11 | Retrieved passages are shown even when the answer abstains | The user asked a question and got nothing; showing what *was* found is what makes the refusal auditable rather than opaque. |
| 11 | Cited passages are marked distinctly from merely-retrieved ones | Six sources go to the model and typically two are used. Rendering them identically implies the answer rests on all six. |
| 10 | Route protection is decided in **middleware**, by asking the API `/auth/me` — not by inspecting the cookie | Two measured reasons. A check in a *layout* does not stop the page below it rendering (React builds `children` before the layout resolves), so the dashboard's markup was serialised into a `USER`'s payload. And `notFound()` cannot set a 404 once a `loading.tsx` Suspense boundary has flushed the shell — the 404 page arrived with a 200. Deciding in middleware happens before any rendering and while the status is still ours. It is also *verified* rather than guessed: the API holds the signing key, so the alternative is duplicating the secret into a second process. |
| 10 | A non-ADMIN hitting `/dashboard` is **redirected to `/chat`**, not shown a 403 | There is nothing a `USER` can do with the knowledge that the route exists, and sending them somewhere usable beats an error page. The API still answers a direct request with a real 403. |
| 10 | The role check is repeated in the page even though middleware already ran | The matcher is a configuration line someone can narrow by accident. It is in the *page* rather than a layout, for the rendering reason above. |
| 10 | Theming is entirely CSS custom properties in `@theme`; **zero `dark:` variants** in any component | A `dark:` variant per component is how dark mode ends up half-implemented in the corner of a page nobody checked. Components name semantic tokens (`bg-surface`, `text-muted`) and the media query swaps the values. Verified: 0 occurrences of `dark:` across the app. |
| 10 | Login and logout are the only browser-side API calls; everything else is server-rendered with cookies forwarded | Only the browser can receive the `Set-Cookie` that creates or ends a session. Everything after that renders on the server, so the token never reaches client JavaScript and no unauthenticated shell is painted before a client-side check redirects. |
| 10 | `?next=` is validated in both the middleware and the login page | Not duplication: the middleware only sees requests it intercepts, and the page can be reached with a hand-written query string. Without it `?next=https://evil.example` turns login into an open redirect that hands a just-authenticated user to another site. |
| 10 | `NEXT_PUBLIC_API_BASE_URL` is separate from `API_BASE_URL` | The Next server and the browser reach the API by different routes (and would differ entirely in a deployment). Conflating them is how a server-only hostname ends up shipped to the browser. |
| 9 | `POST /ingest` returns **202 with a run id** and runs in the background | A full pass is ~60s against a hosted embedding model — 142 network calls — which exceeds every proxy and browser timeout between the API and the dashboard. The run row is the handle; polling `GET /ingest/runs/:id` is also what makes the dashboard's live status possible. Measured: the endpoint responds in **60ms**. |
| 9 | `/answer` is written against the raw `Response`, not Nest's `@Sse()` | `@Sse()` takes an Observable of one event type; this needs two kinds — `token` frames as the model produces them, then one `result` frame with the validated citations. The citations cannot travel with the tokens because they only exist after the complete text has been checked against the supplied context. |
| 9 | The chat provider availability check happens **before** SSE headers are flushed | Once a stream starts the status line is already 200 and the exception filter is powerless. Anything knowable up front — like an unconfigured chat model, which is a 503 — has to be raised while a normal error response is still possible. |
| 9 | OpenAPI is generated from the Zod schemas via `z.toJSONSchema`, not from decorated DTO classes | Nest's Swagger integration wants classes, which would mean describing every payload twice and letting the two drift. Zod 4 emits JSON Schema natively, so the docs are *derived from the validator* and no bridging dependency is needed. `io: "input"` is used so request bodies document what a client may send rather than what the server fills in. |
| 9 | Stats are SQL aggregates, including `percentile_cont` for p50/p95 | §6 says the dashboard is a read over `search_queries`, not a separate metrics system: a counter can drift from reality, a `count(*)` cannot. Percentiles are computed in Postgres because the point of p95 is the tail, and the tail is exactly what fetching a page of rows would discard. |
| 9 | `abstainRate` is **null**, not 0, when nothing was asked | "0% abstention" and "no data" are different states, and a dashboard that renders them identically is lying about one of them. |
| 9 | The throttler is subclassed to replace its default message | `ThrottlerGuard` renders the literal string `"ThrottlerException: Too Many Requests"` into the error envelope — an internal class name in a user-facing message. Same habit that leaks a SQL statement elsewhere. |
| 9 | `db.execute<T>()` results are typed `unknown` for timestamps and narrowed | The generic on `execute` is an **assertion**, not a check. Declaring `last_indexed_at: Date` compiled cleanly and threw on the first real request, because a raw query skips the column-type decoding the query builder applies. |
| 8 | Both guards are registered **globally**; routes opt out with `@Public()` rather than in with `@Auth()` | §9 requires authorization on every route. Per-controller `@UseGuards` satisfies that only until someone forgets, and Step 9's endpoints are exactly where forgetting is easy and invisible. This way a new route is authenticated by default and exposing one takes a deliberate decorator — the failure mode of forgetting is a locked door, not an open one. |
| 8 | The API server is compiled with `tsc` and run with `node`; only the CLIs use `tsx` | **esbuild does not implement `emitDecoratorMetadata`.** Under `tsx` every Nest constructor injection resolves to `undefined` and all routes answer 500. Invisible from the test suite, because vitest transforms with SWC, which *does* emit it — 22 green tests coexisted with a completely broken server. |
| 8 | `@typescript-eslint/consistent-type-imports` is disabled for `apps/api` | Same root cause from the other direction: `import type` deletes the runtime reference `emitDecoratorMetadata` needs, so obeying the rule would reintroduce undefined dependencies. The compiler cannot see the problem, so the rule is switched off for the app rather than suppressed import by import. |
| 8 | Refresh tokens are **stored** (hashed) in a table, not self-contained JWTs | A stateless refresh token can be rotated but never revoked, and reuse cannot be *detected* — a stolen token and the legitimate one are indistinguishable. The table is what allows the standard rule: presenting an already-rotated token revokes the entire family, since there is no way to tell which holder is the attacker. |
| 8 | Refresh tokens are hashed with SHA-256, passwords with argon2id | Opposite choices for opposite inputs. Argon2's cost exists to make guessing a *human-chosen* secret expensive; a refresh token is 256 bits from the CSPRNG, so there is nothing to guess and a deliberately slow hash would only add latency to every refresh. |
| 8 | The two JWT secrets must differ, enforced at startup | Both tokens are JWTs signed by this server; the only thing preventing a refresh token being replayed as an access token is the key it verifies under. There is a test that a token signed with the refresh secret — claiming ADMIN — is rejected. |
| 8 | Login verifies a password even when the email is unknown, against a hash computed at startup | Skipping the ~50ms argon2 verification for an unknown address makes the response measurably faster and turns login into an account-enumeration oracle. The dummy hash is *computed*, not a literal: `verifyPassword` rejects a malformed hash in microseconds, which would defeat the whole point. |
| 8 | The exception filter never uses an unrecognised exception's message | Only `HttpException` — errors this code raised deliberately — speaks to the client. Step 5 proved an ORM message can be an entire SQL statement and Step 6 proved a provider body can echo an API key; there is no way to know what an arbitrary `Error.message` holds, so it goes to the log and the client gets a request id. |
| 7 | The abstention **score floor is derived, not tuned**: `1/(k+1) + 1/(k+candidates)` = 0.0289 | It is the score of a chunk ranked first by one arm and last-of-candidates by the other, so the floor asserts exactly one thing — at least one chunk was found by *both* retrieval arms. Measured: in-corpus questions score 0.0306–0.0328, the fully off-domain one scores 0.0164 (= `1/(k+1)`, one arm alone). No number was picked to make that separation happen. |
| 7 | Abstention is detected by a **sentinel token**, not by reading the prose | Searching an answer for apologetic phrasing is exactly the string-matching the `answered` boolean exists to replace, and it breaks the moment the model rephrases or replies in another language. The sentinel is compared against the whole response, so a model *discussing* the rule is not mistaken for one obeying it. |
| 7 | Generation uses the OpenAI `/v1/chat/completions` wire format, **not** the official Anthropic SDK — deviates from `CLAUDE.md` §3 | The model is still Claude (`anthropic/claude-sonnet-5`). The credential available is an OpenRouter key, which does not expose Anthropic's `/v1/messages`; Step 6 already built this seam for embeddings, so one wire format means one streaming parser and one retry policy to defend instead of two; and the `ChatProvider` interface §3 actually asks for is unchanged, so an SDK-backed implementation is one file and one factory branch. |
| 7 | There is **no offline chat provider**, unlike embeddings | A hashing trick can stand in for an embedding model because both produce a vector whose only job is to be compared. Nothing can stand in for generation: canned text would make the abstain rule and the citation validator *look* exercised when they never ran. Search, ingestion and the dashboard all work without a chat key; only answering needs one. |
| 7 | The SSE stream parser holds a trailing partial line between chunks | A network chunk boundary lands mid-JSON regularly. A parser that assumes whole lines works locally and silently drops tokens under real latency. |
| 7 | Dropped citation markers are removed from the prose, not just from the citation list | A `[7]` with nothing behind it reads as a broken product and, worse, still lends the sentence an air of having been sourced. Surrounding whitespace is tidied so removal does not leave a gap before the full stop. |
| 6 | The keyword arm rewrites the question to **OR** before `websearch_to_tsquery` | Every Postgres tsquery constructor ANDs its terms, so an 8-term question demanded all 8 lexemes in one 200-token chunk and matched nothing. The keyword arm was returning zero rows for most of the eval set and RRF was fusing one list with an empty one — hybrid retrieval was silently vector-only. OR gives recall; `ts_rank` supplies precision by scoring lexeme coverage, so AND is demoted from a filter to a ranking signal. |
| 6 | `websearch_to_tsquery`, never `to_tsquery` | It is the only constructor that cannot be made to raise on hostile input — `to_tsquery` throws a syntax error on an unbalanced quote, turning a malformed search into a 500. With the OR rewrite going through it, there is no query-injection surface even though the terms come from a user. |
| 6 | The vector arm orders by the raw distance expression, not by `1 - distance` | The HNSW index is built on the `<=>` operator; wrapping it in arithmetic makes the expression unindexable and forces a sequential scan. The `1 - distance` value is still selected, for display only. |
| 6 | Fusion reads only ranks; raw cosine and `ts_rank` are carried but never combined | The two are incomparable — cosine is dense in 0.2–0.9, `ts_rank` is unbounded and routinely 0.05 for an excellent match. Any weighted sum needs a normalisation that is itself a tuned guess and that silently changes when the embedding model is swapped. |
| 6 | Candidate budget is 20 per arm for a top-6 answer | Fusion can only reorder what it was given: a chunk ranked 13th by vectors and 3rd by keywords should win, and cannot if the vector arm only returned 6. |
| 6 | **Refuted:** the `doc_type` prior pre-registered in `docs/CORPUS.md` §5 would not fix the q7 crowding | Measured twice, once per embedder, and wrong both times for different reasons. With real embeddings **all 40 candidates (20 vector + 20 keyword) are delivery reports** and `style-guide-ui.md` is at vector rank 69 / keyword rank 86 — it never reaches fusion, so no fusion-stage rule can promote it. The crowding is real but happens one stage earlier than §5 assumed. No prior was added. |
| 6 | q7 is a **multi-intent query**, not a retrieval bug — remedy deferred to Step 19 | The same document ranks **1st in both arms** for "What is the CTA contrast rule?" and 69th/86th for "Why does a low-contrast CTA keep coming up in delivery reports, and what is the rule?". The phrase "delivery reports" activates the 78-document cluster in both arms. The fix is query decomposition or reranking, both already listed under Step 19; raising the candidate budget to the full corpus does not help (fused score would be 0.0146 against 0.03 for the cluster). |
| 6 | The embedding base URL is configurable (`OPENAI_BASE_URL`) | The `/v1/embeddings` wire format is spoken by OpenRouter, Azure OpenAI and self-hosted vLLM. Not hypothetical: the key this was first measured with was an OpenRouter key, and one env var was the whole cost of not being locked to one vendor. |
| 6 | Provider error bodies are scrubbed of anything key-shaped before being stored | A real 401 disproved the earlier comment claiming provider bodies "contain no secrets" — the response echoes the API key back, masked but with its real last four characters, into `ingestion_events.message` and from there the admin dashboard. A partial key is still a key (§9). |
| 5 | The pipeline lives in `packages/rag` over interfaces; the Drizzle implementation lives in `apps/api/src/ingest` | `packages/rag` may not import `packages/db` (§4) and `packages/db` has no business knowing about ingestion, so the app is the composition root. The payoff is concrete: the whole run — including failure isolation and hash-skipping — is unit-tested in memory with no Postgres, and Step 9's `POST /ingest` constructs the same store. |
| 5 | Errors from the Drizzle store are replaced by their `cause` message before they leave it | Drizzle's `error.message` is **the entire failed SQL statement plus its parameters**, and the pipeline writes whatever it catches into `ingestion_events.message` and `documents.error_message`, both rendered in the admin dashboard. Passing it through would print the schema and the document's contents into the UI — precisely what §7 forbids. Where there is no cause, the message is dropped rather than trusted. |
| 5 | A year-month `doc_date` (`2025-12`) is stored as the first of the month | Postgres rejects `2025-12` for a `date` column outright, and 108 of 142 documents are dated by month. Widening the column to text would lose ordering and range queries, which is what the column is for. The precision loss is deliberate; the breadcrumb still carries the original `2025-12`, so retrieval is unaffected. |
| 5 | Front-matter support is flat `key: value` only, and reports the lines it could not read | The corpus has no front-matter at all (§2), so a full YAML dependency would be a library added on speculation. Unsupported lines are surfaced as a WARN event rather than silently dropped, which is what will signal that a future corpus needs a real parser. |
| 5 | A run with failed documents is `COMPLETED` with a non-zero `documents_failed`, not `FAILED` | The run did everything it could; `FAILED` is reserved for the run itself dying, which is a different thing for an operator to react to. The CLI still exits non-zero, so a README follower or CI job does not read "done" over an incomplete index. |
| 5 | `updatedAt` is left unset on the insert branch of the document upsert | An upsert cannot report which branch it took, so it is inferred from `createdAt === updatedAt`. Setting `updatedAt: new Date()` compares a JavaScript clock against Postgres's `defaultNow()`; they are never equal, which made a first run over an empty table report 142 updates and 0 inserts. |
| 4 | Markdown is parsed by a hand-written **line scanner**, not by remark/mdast | The scanner needs to know two things — where headings are and where fenced code is — and a CommonMark AST gets the corpus wrong on exactly the case that matters: the changelogs' 4-space-indented first bullet parses as an indented code block. ~90 lines I can defend beats a parser whose edge cases I would have to work around. |
| 4 | `gpt-tokenizer` for real BPE counts, not a `words × 1.33` proxy | Both the chunk budget and the embedding batch cap are enforced against the model's real 8191-token input limit and per-request token limit; a proxy that under-counts turns into a 400 from the API on the first non-English or code-heavy corpus. Chosen over `js-tiktoken` (identical counts) because js-tiktoken ships ESM-only *types* against a dual runtime, which the Node16 resolver rejects from a CommonJS package. |
| 4 | OpenAI embeddings over raw `fetch`, not the `openai` SDK | The deliverable here *is* the failure policy — bounded timeout, one retry, transient-vs-permanent classification. The SDK ships its own retry and timeout defaults, so using it would mean inheriting a policy I did not choose or configuring it off and writing this anyway. |
| 4 | The offline embedding provider is a **first-class provider** selected by `EMBEDDING_PROVIDER`, not a test mock | It is what lets `clone → install → migrate → ingest → search` work with no API key, which is a scored setup criterion. Being a real provider means tests exercise the same code path production uses, and it carries the *same* input/batch limits so an offline run fails wherever an online one would. |
| 4 | Batching lives in `embedAll` above the provider interface, and is token-aware | An array-length cap is a guess that works until the corpus contains long documents; counting tokens is cheap next to a round trip. Putting it above the interface means both providers get the same batching and the same over-long-input rejection. |
| 4 | When sections merge, the shared heading path becomes the breadcrumb and the deeper headings are written back into the body | Otherwise merging a whole document into one chunk silently deletes `## QA findings and fixes` from both the breadcrumb and the text. A heading is either in the breadcrumb or in the content — never dropped. |
| 4 | The content-budget floor is a **fraction** of the budget (25%), not a constant | The first version used a constant 64, which silently overrode any configured budget below 64 — a caller asking for a small budget got a large one and never found out. Caught by a test that asserted a split and got one chunk. |
| 4 | Tests are excluded from `tsconfig.json` and type-checked by `tsconfig.test.json` inside the `test` script | Test files must not be emitted into `dist/`, which is a consumed surface, but Vitest transpiles without type-checking — without the second config the tests would be the only unchecked TypeScript in the repository. |
| 3 | Package builds are `rm -rf dist && tsc -b`, and packages no longer define a `typecheck` script | `tsc -b` leaves output for deleted sources, so a build can pass on artefacts whose source is gone — this actually happened in Step 3. Deleting first makes the build honest; these packages compile in under a second, so incrementality is worth nothing here. `typecheck` was removed because for a composite project `tsc -b` *is* the typecheck, and two tasks running `rm -rf dist` concurrently in one directory would race. |

---

## Parking lot

Problems noticed outside the current step. Do not fix them mid-step — record here and
schedule them.

- ~~**Step 4:** the changelogs' 4-space-indented first bullet.~~ Done — the parser is a line
  scanner rather than an AST walk precisely so this is ordinary text, pinned by a fixture test
  in `markdown-sections.test.ts` and confirmed on the real file.
- ~~**Step 5:** dimension assertion, env validation, `version`/`lifecycle`.~~ All three done —
  `apps/api/src/ingest/env.ts` validates the embedding vars with Zod and fails startup on a
  width mismatch; `document-attributes.ts` fills `version` and `lifecycle` (verified in the
  database: `sdk-notes-v2` → `deprecated`, `sdk-notes-v3` → `current`).
- **Step 9:** `POST /ingest` must run the pipeline **in the background** and return the run id
  immediately. A full run is ~2s on this corpus with the offline provider, but with the OpenAI
  provider it is bounded by 142 embedding calls and would hold an HTTP request open past any
  sensible timeout. The run row already exists to be polled.
- **Step 9 / 12:** `documents.error_message` and `ingestion_events.message` may contain absolute
  server paths (an `EACCES` reports the full filesystem path). Acceptable because both are
  admin-only reads, but do not surface either on a `USER`-visible route.
- ~~**Step 6:** `doc_type` prior for the q7 crowding.~~ Tested and **refuted** — see the decision
  table. The `docType` filter exists on the search contract and in both SQL arms regardless,
  because it is useful on its own; it is simply not the answer to q7.
- **Step 19:** `q7-cross-document-synthesis` is the one eval query that fails, and it is a
  multi-intent query rather than a retrieval defect — see the decision table. The remedy is
  query decomposition (retrieve per sub-question and fuse) or LLM reranking of the fused top
  20, both already scoped there. **Do not** edit the query or tune fusion to make it pass.
- ~~**Step 7:** score floor, conflict rule.~~ Both done and demonstrated. The floor is derived
  from RRF's arithmetic and lands at 0.0289; the prediction held exactly — q12 abstains on the
  floor without calling the model, q10/q11 clear the floor and are caught by the prompt rule.
- **Step 9:** `POST /answer` must log `droppedMarkers` to `search_queries`. It is not on the
  wire contract (the client has no use for it), but a rising count is the earliest signal that
  the prompt or the context size has regressed.
- **Step 11:** citation markers are **not contiguous** after validation — a real answer cited
  `[1][2][6]`. The chat page must resolve `citation.marker` to `citation.sourceIndex`, never
  assume the nth citation is the nth source.
- **Step 7 / `CLAUDE.md` §6:** the corpus attributes Merge Marina to 7 different clients across
  meeting notes. "Who is the client for Merge Marina?" has no supported answer; the conflict
  rule should surface the disagreement rather than pick one.
- ~~**Step 8:** `normalizeEmail()` on register and login; import argon2 params from
  `packages/db/src/password.ts`.~~ Both done, and both covered — there is a test that logging in
  with an upper-cased email succeeds.
- ~~**Step 11:** streamed tokens must not render the sentinel; resolve markers to
  `sourceIndex`.~~ Both done. The sentinel guard was solved server-side in Step 9 (verified: 0
  token frames on an abstention); the marker resolution is in `answer-text.tsx`.
- _(historical)_ **Step 11 (and Step 9's SSE):** streamed tokens must not be rendered until
  abstention is resolved. When the model declines it emits the raw `NO_ANSWER` sentinel, and the `pnpm ask`
  CLI prints it verbatim (`streaming: NO_ANSWER`) before the abstention state is decided. In a
  terminal that is cosmetic; in the chat page the user would watch "NO_ANSWER" type itself out
  and then be replaced. Buffer the first tokens, or suppress rendering until the response is
  known not to be the sentinel.
- ~~**Step 9:** rate limiting, background ingest, admin roles, `droppedMarkers` logging.~~ All
  done and verified over HTTP. Rate limiting measured: 35 requests to `/search` gave 17×200 then
  18×429 with a clean `RATE_LIMITED` envelope.
- ~~**Step 12:** the 500-event cap on `GET /ingest/runs/:id`.~~ Done — the run detail page says
  "Showing the first 500 — the run produced more" when the cap is hit, instead of implying the
  list is complete.
- **Step 14 (limitations):** the concurrent-ingestion guard is an in-process flag, which is
  honest for a single instance and wrong for two. Say so rather than implying a distributed lock.
- **Step 14 (limitations):** rate limiting is in-memory per instance, so limits multiply by
  replica count.
- **Step 14:** expired refresh tokens are never deleted. Harmless (they are rejected on expiry)
  but the table grows forever. A cleanup query or a `DELETE ... WHERE expires_at < now()` on
  startup belongs in the README's limitations if it is not implemented.

---

## Deferred / cut

What was dropped and why. All of this is in the README's limitations section.

- **Query decomposition for multi-intent questions.** The one measured retrieval failure
  (eval `q7`). Deferred to Step 19; the diagnosis is in the README and `docs/ADR.md`.
- **Chokidar watch mode for ingestion** (Step 15). The hash-based new/changed/removed
  classification is done and used; only the watcher and scheduler are missing.
- **OIDC for the MCP server** (Step 17). The transport was chosen for it and the 401 already
  returns `WWW-Authenticate`; the bearer check is one file.
- **Live deployment** (Step 18). The README documents what it would take.
- **Conversation history in chat.** Each question is independent; follow-ups do not work.
- **User-management screen.** Admins create users through `POST /auth/register`.
- **Browser verification at 375/768/1280.** Composition was checked, a real browser was not.
- **A GUI MCP client.** The protocol was driven by hand; Claude Desktop was never attached.

---

## Environment notes

Things a future session needs to know: running services, ports, credentials location,
anything manual.

- Postgres: `docker compose up -d`, port 5432, database `rag`, user/password `corpus`/`corpus`
- Verified in Step 1: **Postgres 16.15**, **pgvector 0.8.6**, container `corpus-lens-postgres`,
  healthcheck passes, `<=>` cosine operator works, and a host-side connection with the
  `.env` credentials succeeds. Data lives in the named volume `corpus-lens_postgres-data` —
  `docker compose down -v` wipes it and re-runs the init SQL.
- ⚠️ **This machine has two Docker contexts:** `default` (`/var/run/docker.sock`) and
  `desktop-linux` (Docker Desktop, the active one). They are separate daemons with separate
  containers, and a container in one will occupy port 5432 for the other. Always check
  `docker context show` before debugging a "port already in use" error here.
- If 5432 is genuinely taken by something else, set `POSTGRES_PORT` and update the port in
  `DATABASE_URL`; the compose file already reads it. Document this in the README at Step 14.
- Toolchain: Node 20.19.6 · pnpm 9.15.4 · turbo 2.10.10 · TypeScript 5.9.3 · ESLint 9.39.5
- DB stack: drizzle-orm 0.45.2 · drizzle-kit 0.31.10 · postgres.js 3.4.9 · @node-rs/argon2 2.1.0
- Migration `0000_old_talon.sql` creates 6 tables + 6 enums. Drizzle's bookkeeping table lives
  in the separate `drizzle` schema, so `public` contains exactly our six.
- Demo accounts after `pnpm db:seed`: `admin@demo.local` / `admin-demo-pw-2026` (ADMIN),
  `user@demo.local` / `user-demo-pw-2026` (USER). Values live in `.env.example`; the README
  repeats them at Step 14.
- `pnpm db:studio` serves on port 4983 (UI at https://local.drizzle.studio).
- Corpus path: **`./sample_dataset/corpus`** (git-ignored) — note the nesting;
  `sample_dataset/sample_questions.md` sits outside it and must not be ingested
- Corpus size: 142 Markdown files, ~23.6k tokens. Chunk count after Step 5: **142** (measured)
- Step 4 measured it: the chunker produces **exactly 142 chunks from 142 documents**, one each,
  min 45 / max 253 tokens including the breadcrumb. The Step 0 prediction held, and a
  materially different number from `pnpm ingest` means the chunker has a bug.
- Embeddings default to `EMBEDDING_PROVIDER=deterministic` in `.env.example`, so the system runs
  with no API key. Set it to `openai` with `OPENAI_API_KEY` for real retrieval quality — never
  quote evaluation numbers from a deterministic run.
- Measured with `openai/text-embedding-3-small` via OpenRouter (`OPENAI_BASE_URL`): a forced
  re-embed of all 142 chunks takes **65s**; a search is **~450ms** end to end, of which the
  embedding call is nearly all of it (retrieval itself is single-digit ms on 142 chunks).
- **Eval result (real embeddings): 8/9 answerable queries.** All five shipped dataset queries
  (q1–q5) return their expected document at **rank 1**. Only the self-authored q7 fails.
- Generation: `anthropic/claude-sonnet-5` via the same OpenRouter gateway. A grounded answer is
  ~3–4s end to end (embed ~0.5s, retrieve ~25ms, generate ~3s); a floor abstention is ~0.6s
  because the model is never called.
- `pnpm ask "question" [--k 6] [--sources] [--no-stream]` runs the full answer path from a
  terminal. `--sources` prints what the model was actually shown, which is the only way to tell
  a retrieval failure from a generation failure.
- rag deps: gpt-tokenizer 3.4.0 (cl100k_base) · vitest 4.1.10
- api deps: drizzle-orm 0.45.2 · zod 4.4.3 · tsx 4.23.12 · yaml 2.7.0 (ingest + eval CLIs)
- `pnpm eval` runs `eval/queries.yaml` against live retrieval and exits non-zero if an
  answerable query misses an expected document. `--k`, `--file` and `--verbose` are supported.
  Step 16 extends this same script with recall@k, MRR and the per-arm comparison table.
- `pnpm ingest` walks `CORPUS_DIR`; `pnpm ingest --dir <path>` overrides it, `--force` re-embeds
  everything, `--quiet` suppresses per-document warnings. Exits non-zero if any document failed.
- Verified in Step 5 against the real corpus: clean run 142 added / 142 chunks / 1.9s; immediate
  re-run 142 unchanged / 0 chunks / 0.1s; `--force` 142 updated. All 142 rows INDEXED, all 142
  chunks carry both an embedding and a tsvector.
- API: port 3001 · Web: port 3000 · MCP: port 3002
- MCP: `pnpm --filter @corpus-lens/mcp run build && pnpm mcp` → `http://localhost:3002/mcp`.
  Needs the same `.env` as the API, above all the same `JWT_ACCESS_SECRET`. Client config,
  token recipe and tool reference are in **`apps/mcp/README.md`**; Step 14 folds them into the
  root README.
- Get a bearer token for MCP by reading the `cl_access` cookie out of a login response — the
  exact command is in `apps/mcp/README.md`. `USER` is sufficient.
- Web: `pnpm --filter @corpus-lens/web run build` then `run start` (or `run dev`). Requires the
  API running — the middleware calls `/auth/me` on every navigation.
- `/chat` is live: streamed answer, interactive citation chips that scroll to and highlight the
  matching passage, retrieved passages with breadcrumb + fused score + per-arm ranks, distinct
  abstention state, latency split, Enter-to-send. Verified against both an answerable and an
  unanswerable question.
- Dashboard is live at `/dashboard` (overview), `/dashboard/documents` (+ `/[id]`),
  `/dashboard/runs` (+ `/[id]`). Verified: ADMIN 200 on all, USER 307 to `/chat` on all;
  142 documents paginated 20/page; `search=merge-marina` narrows to 10, `search=sdk` to 2;
  `search=%` returns no matches (the LIKE metacharacter is escaped, not a wildcard);
  a missing document or run is a real **404**.
- Routes: `/login` (public) · `/chat` (any session) · `/dashboard` (ADMIN). `/` redirects to
  `/chat`. Verified: anonymous → 307 to `/login?next=…`; USER on `/dashboard` → 307 to `/chat`
  with **zero** dashboard content in the payload; ADMIN → 200.
- Cookies work across ports because cookies ignore port; `localhost:3000` and `localhost:3001`
  are the same site, so `SameSite=Lax` permits the login POST.
- `pnpm --filter @corpus-lens/api run build && pnpm --filter @corpus-lens/api run start` runs the
  API. **Do not run `src/main.ts` with tsx** — see the decision table; it 500s on every route.
- Endpoints: `POST /search` and `POST /answer` (any authenticated role) · `GET /documents`,
  `GET /documents/:id`, `POST /ingest`, `GET /ingest/runs`, `GET /ingest/runs/:id`, `GET /stats`
  (ADMIN only) · OpenAPI at `/docs`, JSON at `/docs-json` (13 paths, 14 Zod-derived schemas).
- Rate limits: global 120/min; `/search` 30/min; `/answer` 10/min. In-memory, per instance.
- `POST /answer` streams SSE: `event: token` frames then one `event: result` with the validated
  citations, sources and timings; `event: error` if generation fails mid-stream.
- Auth routes: `POST /auth/{login,refresh,logout}` are public, `POST /auth/register` is
  ADMIN-only, `GET /auth/me` needs any valid token. Cookies are `cl_access` (path `/`) and
  `cl_refresh` (path `/auth/refresh`), both HttpOnly + SameSite=Lax, Secure in production.
- `.env` now needs `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (≥32 chars, must differ).
  Real random values were generated into the local `.env`; `.env.example` carries placeholders.
