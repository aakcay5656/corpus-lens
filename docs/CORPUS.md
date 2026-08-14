# Corpus Analysis

Written in Step 0, before any chunking code exists, so that the chunking parameters are
derived from the corpus rather than from a blog post. Every number below was measured,
not estimated by eye; the commands that produced them are at the bottom.

Token counts are `words × 1.33`, a standard English-prose proxy for the
`text-embedding-3-small` tokenizer. The conclusions below have such wide margins that the
approximation does not affect any of them.

---

## 1. What the corpus is

`sample_dataset/corpus/` is the internal documentation of **Lumen Playables**, a fictional
HTML5 playable-ad studio. It reads like a real company wiki: canonical reference documents
at the root, and dated operational records in subfolders.

| Folder | Files | Avg tokens | What it holds |
|---|---:|---:|---|
| `.` (root) | 13 | 143 | Canonical reference: SDK notes, network specs, QA checklist, build pipeline, localization, analytics taxonomy |
| `delivery-reports/` | 78 | 205 | Per-project, per-month QA findings and sign-off |
| `meeting-notes/` | 30 | 137 | Fortnightly production syncs, 2025-03 → 2026-06 |
| `client-briefs/` | 10 | 92 | One brief per game |
| `changelogs/` | 6 | 38 | `lumen-build` releases 3.8 → 4.3 |
| `guides/` | 3 | 81 | Asset naming, incident process, review process |
| `postmortems/` | 2 | 119 | Localization regression, analytics leak |
| **Total** | **142** | **166** | **~23.6k tokens / 17.7k words / 596 KB** |

The whole corpus is roughly 23,600 tokens. That fact drives everything that follows.

---

## 2. Measured shape

### Uniformly tiny documents

```
Document tokens   n=142   min=21   p50=197   p90=210   max=217   mean=166
H2 section tokens n=436   min=15   p50=49    p90=85    max=169   mean=53
Sections/document n=142   min=1    p50=4     p90=4     max=4     mean=3.1
```

- **Zero documents exceed 500 tokens.** The largest document in the entire corpus is 217
  tokens — less than half the chunk budget in `CLAUDE.md` §6.
- **Zero sections exceed 500 tokens**, and 420 of 436 sections are under 100 tokens.
- The distribution is extremely tight (p50 197 → max 217 for documents). This is generated
  content on a fixed template, not organically grown prose.

### Flat, consistent structure

- Exactly **one `#` per file** (142 files, 142 H1s) — always the document title.
- **294 `##` headings**, and **no `###` or deeper at all**. Maximum heading depth is 2.
- **No YAML front-matter** in any file.
- **No tables, no code fences** anywhere.

The templates are rigid: `## QA findings and fixes`, `## Observations` and `## Sign-off`
each appear in all 78 delivery reports; `## Delivery status` and `## Discussion` in all 30
meeting notes.

---

## 3. Three findings that change the plan

### 3.1 The `CLAUDE.md` §6 chunking defaults do not apply — but the code should still implement them

§6 specifies ~500-token chunks with ~60-token overlap. Against this corpus that machinery
would never fire once: the biggest document is 217 tokens, so a size-based splitter has
nothing to split and the overlap path is dead code.

Chunking is nevertheless *not* a solved problem here, because §5 requires ingestion to work
against **any** directory. So the chunker implements the full structural strategy and the
parameters simply resolve, on this corpus, to a merge rather than a split. Proposal (c),
agreed before writing this document:

> Split on `##` sections, then **greedily merge adjacent sections** back together while the
> running total stays under the budget. Only split when a single section exceeds the budget.

On this corpus that yields **1 chunk per document, 142 chunks total** (every document fits
in one 500-token window). On a corpus of long documents the same code splits normally. The
behaviour is correct in both regimes and the merge step is the part that is actually
exercised here — which is worth saying out loud in the README rather than pretending the
500/60 numbers were tuned.

**Parameters:** budget **500 tokens**, overlap **60 tokens**, minimum chunk **80 tokens**
(below this a fragment is merged into its neighbour rather than embedded alone). See §5 for
why the budget is not lowered to match the observed sizes.

### 3.2 The real retrieval problem is near-duplicates, not chunk size

The delivery reports — 78 files, **68% of the corpus by token count** — are assembled from a
tiny sentence pool:

```
546 bullet lines across delivery-reports/
 15 distinct bullet lines
```

The most common line appears 51 times verbatim:

> `Loop_complete rate rose once the second tutorial hint was made skippable.`

Meeting notes are the same: one reminder line is repeated in all 30 files.

Consequences for retrieval:

- **Vector search will be near-useless inside this cluster.** 78 chunks built from the same
  15 sentences produce near-identical embeddings; cosine ranking between them is noise, and
  a query like *"what QA issues did we hit?"* returns an arbitrary 6 of 78 equally-good
  chunks.
- **The distinguishing signal is metadata, not prose.** What separates
  `2025-05-bubble-bakery.md` from `2025-12-merge-marina.md` is the date and the game — both
  of which live in the *filename*, and neither of which appears in the body in a form
  embeddings handle well.
- **Therefore the breadcrumb must carry metadata, not just headings.** `CLAUDE.md` §6
  specifies `Document Title > Section > Subsection`. For this corpus that is extended to:

  ```
  Delivery Report: Merge Marina, 2025-12 [delivery-report · 2025-12 · merge-marina]
  > QA findings and fixes

  <content>
  ```

  This is the single highest-leverage retrieval decision in the case, and it is a direct
  consequence of the duplication measurement above.
- **Keyword search earns its place here.** RRF's keyword arm is what makes
  *"Bubble Bakery December delivery"* resolve to the right file when the vector arm cannot
  tell 78 chunks apart. This is the concrete justification for hybrid retrieval — better
  than the generic "vectors miss error codes" argument, because it is measured from this
  corpus.

### 3.3 The corpus contains deliberate contradictions, and the questions test them

`sample_questions.md` ships question 2 as:

> *How do I initialize the current Lumen SDK, and what happened to `lumen.track`?*
> Expect: `sdk-notes-v3.md` (`sdk-notes-v2.md` is deprecated; **a good answer says so**)

So retrieving the right document is not sufficient — both v2 and v3 will be retrieved, and
the answer has to prefer v3 *and* explain that v2 is superseded. The corpus marks this
explicitly in the body text (`# Lumen SDK v2 (DEPRECATED)`, `Status: deprecated since
January 2026`, `v3 ... supersedes v2`).

There is a second, quieter contradiction: **Merge Marina is attributed to seven different
clients** across meeting notes (Pocket Comet, BlueHarbor Interactive, Neon Owl Studio,
Grimwood Labs, Kumquat Arcade, SweetPixel Games, Tandem Toys). Whether this is intentional
or generator noise, "who is the client for Merge Marina?" has no single supported answer.

**Proposed addition to `CLAUDE.md` §6 (grounding rules):** the generation prompt gains one
rule — *when sources conflict or one is marked deprecated/superseded, prefer the current one
and state the conflict explicitly; never silently pick one.* This is cheap to add to the
prompt and it is directly graded by the shipped question set.

---

## 4. Metadata to store per document

Derived from the path and the first lines, because the corpus offers no front-matter:

| Field | Source | Why |
|---|---|---|
| `source_path` | relative path | Identity, dedup, unique index |
| `title` | the single `#` heading | Breadcrumb, citation display |
| `doc_type` | parent folder (`delivery-report`, `meeting-note`, `client-brief`, `changelog`, `guide`, `postmortem`, `reference`) | Filter + breadcrumb; the strongest cheap signal |
| `date` | `^\d{4}-\d{2}(-\d{2})?` in filename | Recency ranking, "latest" questions; present in 108/142 files |
| `subject` | filename remainder (`bubble-bakery`, `production-sync`) | The game/topic key that distinguishes duplicates |
| `version` | `lumen-build-(\d+\.\d+)` for changelogs, `v(\d)` for SDK notes | Ordering v2 vs v3 |
| `status` | `deprecated` / `current` if the body says so in its first 3 lines | Feeds the conflict rule in §3.3 |
| `content_hash` | SHA-256 of raw bytes | Idempotent re-ingestion (Step 5) |

`doc_type`, `date` and `subject` are all recoverable from the path alone, which keeps
ingestion generic: a corpus without these patterns simply gets `null` and falls back to
title-only breadcrumbs.

---

## 5. Parameters, and what happens next

| Parameter | Value | Justification from measurement |
|---|---|---|
| Chunk budget | 500 tokens | Not fitted to this corpus — deliberately left at a general-purpose value so the merge path, not a bespoke number, is what adapts. Every document lands in one chunk. |
| Overlap | 60 tokens | Never triggers here (nothing splits). Kept and unit-tested for portability. |
| Min chunk | 80 tokens | Prevents the 21-token changelogs from becoming standalone low-signal chunks; they merge into one chunk per document. |
| Split unit | `##` section | The only structural boundary available (no `###` exists). |
| Expected chunk count | **~142** | 1 per document. If ingestion reports a materially different number, the chunker has a bug. |
| Retrieval candidates | 20 vector + 20 FTS | Per §6, unchanged. |
| RRF `k` | 60 | Per §6, unchanged. |
| Context size | top 6 | 6 × ~200 tokens ≈ 1.2k tokens of context — comfortable. |

**A note on why the budget is not lowered.** Tuning the budget down to ~200 tokens would
"fit" this corpus but would be overfitting to a 23k-token sample and would break the §5
requirement that pointing at another folder is a one-line change. The honest position is:
the structural rule does the work, the size rule is a safety valve that this corpus never
trips.

### Parsing hazard found

All six changelog files indent their first bullet by four spaces:

```
# lumen-build 4.2 (2026-03-30)

    - Reverted the unified compression path: audio returns to its dedicated pass.
- Verify stage now measures the final inlined artifact instead of the pre-inline bundle.
```

Under CommonMark, four-space indentation is an **indented code block**, so an AST-based
chunker will parse that line as code while the rest of the list parses as a list. The
chunker must not drop it, and the "never split a code fence" rule in §6 must not be
confused by it. This is exactly the kind of thing a fixture test should pin — noted for
Step 4.

### Open item for Step 6

If evaluation shows the 78 delivery reports crowding out root reference documents on
general queries, the next lever is a small `doc_type` prior in fusion (or a filter exposed
on the search API), not a change to chunk size. Recorded here so the instinct to re-tune
chunking is resisted.

---

## 6. Reproducing these numbers

```bash
cd sample_dataset/corpus

# file, word and structure counts
find . -name '*.md' | wc -l
cat $(find . -name '*.md') | wc -w
grep -rhoE '^#{1,6} ' --include='*.md' . | sort | uniq -c
grep -rl '^---' --include='*.md' . | wc -l      # front-matter: 0
grep -rl '```'  --include='*.md' . | wc -l      # code fences: 0

# the duplication finding
grep -h '^- ' delivery-reports/*.md | wc -l              # 546
grep -h '^- ' delivery-reports/*.md | sort -u | wc -l    # 15

# the indentation hazard
grep -rlE '^    ' --include='*.md' .            # all 6 changelogs
```

Token distributions come from the Python snippet recorded in the Step 0 transcript
(`words × 1.33`, split on `^## `).
