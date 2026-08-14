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
