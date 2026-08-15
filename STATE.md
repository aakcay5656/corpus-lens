# STATE.md

Single source of truth for progress. Claude Code updates this at the end of every
step, before writing the completion report. Read it at the start of every session.

**Current step:** 8 — Auth and authorization
**Last completed step:** 7 — Grounded answering
**Last commit:** `1702e0b` · Step 7 pending

| Step | Commit |
|---|---|
| 0 — Corpus recon | `a6e1ee9` |
| 1 — Monorepo scaffold | `12dc838` _(shared with Step 2, see below)_ |
| 2 — Database schema | `12dc838` |
| 3 — Shared contracts | `4de1015` |
| 4 — Chunking + embeddings | `7d7ee00` |
| 5 — Ingestion pipeline | `1769e43` |
| 6 — Hybrid retrieval | `1702e0b` |

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
| 8 | Auth and authorization | P0 | ⬜ |
| 9 | API endpoints | P0 | ⬜ |
| 10 | App shell and auth flow | P0 | ⬜ |
| 11 | Chat page | P0 | ⬜ |
| 12 | Dashboard | P0 | ⬜ |
| 13 | MCP server | P0 | ⬜ |
| 14 | Documentation | P0 | ⬜ |
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
- **Step 8:** auth must call `normalizeEmail()` from `@corpus-lens/db/normalize-email` on both
  register and login. The unique constraint is on the raw column, so normalisation is the only
  thing keeping `Admin@demo.local` and `admin@demo.local` one account.
- **Step 8:** `packages/db/src/password.ts` already owns the argon2id parameters. Auth imports
  it rather than re-declaring them, or the seed and the login path can drift apart.

---

## Deferred / cut

What was dropped and why. Everything here goes into the README's limitations section
at Step 14.

- _(empty)_

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
