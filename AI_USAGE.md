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
