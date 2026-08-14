# STATE.md

Single source of truth for progress. Claude Code updates this at the end of every
step, before writing the completion report. Read it at the start of every session.

**Current step:** 3 — Shared contracts
**Last completed step:** 2 — Database schema
**Last commit:** Step 0 = `efe2743` _(must be amended — see below)_ · Steps 1–2 pending

> ⚠️ **Open action on the git history.** Commit `efe2743` tracked all 143 files of
> `sample_dataset/` plus `PlayableFactory_AI_SE_Case_RAG.pdf`, both forbidden by
> `CLAUDE.md` §1 and §5. `.gitignore` now covers them, but gitignore does not apply to
> already-tracked files. Remediation commands are in the Step 1 report; until they are
> run, the corpus is still in the history.

---

## Progress

| # | Step | Priority | Status |
|---|---|---|---|
| 0 | Corpus recon | P0 | ✅ done |
| 1 | Monorepo scaffold | P0 | ✅ done |
| 2 | Database schema | P0 | ✅ done |
| 3 | Shared contracts | P0 | ⬜ |
| 4 | Chunking + embeddings | P0 | ⬜ |
| 5 | Ingestion pipeline | P0 | ⬜ |
| 6 | Hybrid retrieval | P0 | ⬜ |
| 7 | Grounded answering | P0 | ⬜ |
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

---

## Parking lot

Problems noticed outside the current step. Do not fix them mid-step — record here and
schedule them.

- **Step 4:** all 6 `changelogs/*.md` indent their first bullet by 4 spaces, which CommonMark
  parses as an indented code block. The chunker must not drop it and the "never split a code
  fence" rule must not trip on it. Needs a fixture test.
- **Step 6:** if the 78 near-duplicate delivery reports crowd out root reference documents on
  general queries (eval `q7`), the lever is a `doc_type` prior in fusion or a search filter —
  **not** a change to chunk size. See `docs/CORPUS.md` §5.
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
- Corpus size: 142 Markdown files, ~23.6k tokens. Expected chunk count after Step 5: **~142**
- API: port 3001 · Web: port 3000 · MCP: port 3002
