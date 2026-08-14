# STATE.md

Single source of truth for progress. Claude Code updates this at the end of every
step, before writing the completion report. Read it at the start of every session.

**Current step:** 1 — Monorepo scaffold
**Last completed step:** 0 — Corpus recon
**Last commit:** _(pending — awaiting hash)_

---

## Progress

| # | Step | Priority | Status |
|---|---|---|---|
| 0 | Corpus recon | P0 | ✅ done |
| 1 | Monorepo scaffold | P0 | ⬜ |
| 2 | Database schema | P0 | ⬜ |
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

---

## Deferred / cut

What was dropped and why. Everything here goes into the README's limitations section
at Step 14.

- _(empty)_

---

## Environment notes

Things a future session needs to know: running services, ports, credentials location,
anything manual.

- Postgres: `docker compose up -d`, port 5432, database `rag`
- Corpus path: **`./sample_dataset/corpus`** (git-ignored) — note the nesting;
  `sample_dataset/sample_questions.md` sits outside it and must not be ingested
- Corpus size: 142 Markdown files, ~23.6k tokens. Expected chunk count after Step 5: **~142**
- API: port 3001 · Web: port 3000 · MCP: port 3002
