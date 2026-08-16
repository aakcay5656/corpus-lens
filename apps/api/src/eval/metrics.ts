/**
 * Retrieval metrics, as pure functions over a ranked list of source paths.
 *
 * Separated from the runner so they can be reasoned about — and tested — without a
 * database, an embedding provider or a corpus. Each one answers a different question, and
 * the difference matters when reading the comparison table:
 *
 * - **recall@k** — of the documents an answer *needs*, how many did we put in front of the
 *   model? This is the one that decides whether an answer is possible at all: a document
 *   outside the top k does not exist as far as generation is concerned.
 * - **MRR** — how far down did the *first* useful document sit? Rewards putting the right
 *   thing at position 1 rather than position 6, which recall@k cannot see.
 *
 * A query can score 1.0 recall and a poor MRR (everything found, but buried), or a perfect
 * MRR and poor recall (the best hit is first, the rest are missing). Reporting both is why
 * the table has two columns instead of one number.
 */

export interface QueryOutcome {
  /** Documents that must appear in the top k for the query to be answerable. */
  expected: string[];
  /** Source paths actually returned, best first, already truncated to k. */
  retrieved: string[];
}

/**
 * Fraction of expected documents present in the retrieved list.
 *
 * Micro-averaged across queries — every expected document counts once, rather than every
 * *query* counting once. A query expecting three documents should weigh more than one
 * expecting a single document, because it is three chances to fail.
 */
export function recallAtK(outcomes: QueryOutcome[]): number | null {
  let expectedTotal = 0;
  let found = 0;

  for (const outcome of outcomes) {
    for (const document of outcome.expected) {
      expectedTotal += 1;
      if (outcome.retrieved.includes(document)) found += 1;
    }
  }

  return expectedTotal === 0 ? null : found / expectedTotal;
}

/**
 * Mean reciprocal rank of the first expected document.
 *
 * A query where no expected document was retrieved contributes 0 rather than being
 * skipped. Dropping it would let a system that fails half its queries and nails the rest
 * report a better MRR than one that answers everything adequately — which is exactly
 * backwards.
 */
export function meanReciprocalRank(outcomes: QueryOutcome[]): number | null {
  if (outcomes.length === 0) return null;

  const total = outcomes.reduce((sum, outcome) => {
    const rank = firstExpectedRank(outcome);
    return sum + (rank === null ? 0 : 1 / rank);
  }, 0);

  return total / outcomes.length;
}

/** 1-based rank of the first expected document, or null if none was retrieved. */
export function firstExpectedRank(outcome: QueryOutcome): number | null {
  for (const [index, path] of outcome.retrieved.entries()) {
    if (outcome.expected.includes(path)) return index + 1;
  }
  return null;
}

/** Queries where every expected document made the top k. The strictest of the three. */
export function fullHitRate(outcomes: QueryOutcome[]): number | null {
  if (outcomes.length === 0) return null;
  const hits = outcomes.filter((outcome) =>
    outcome.expected.every((document) => outcome.retrieved.includes(document)),
  ).length;
  return hits / outcomes.length;
}

export interface AbstentionOutcome {
  /** True when the corpus genuinely cannot answer the question. */
  shouldAbstain: boolean;
  /** True when the system declined. */
  didAbstain: boolean;
}

export interface AbstentionAccuracy {
  /** Unanswerable questions correctly refused. The headline for grounding. */
  correctRefusals: number;
  unanswerable: number;
  /** Answerable questions wrongly refused — the cost of being too cautious. */
  falseRefusals: number;
  answerable: number;
  /**
   * Unanswerable questions that produced an answer anyway. The most expensive failure in
   * the system: a confident, cited, wrong answer is worse than no answer.
   */
  hallucinationRisk: number;
}

export function abstentionAccuracy(outcomes: AbstentionOutcome[]): AbstentionAccuracy {
  const unanswerable = outcomes.filter((outcome) => outcome.shouldAbstain);
  const answerable = outcomes.filter((outcome) => !outcome.shouldAbstain);

  return {
    correctRefusals: unanswerable.filter((outcome) => outcome.didAbstain).length,
    unanswerable: unanswerable.length,
    falseRefusals: answerable.filter((outcome) => outcome.didAbstain).length,
    answerable: answerable.length,
    hallucinationRisk: unanswerable.filter((outcome) => !outcome.didAbstain).length,
  };
}

/** Formats a 0–1 ratio, keeping "no data" distinct from zero. */
export function formatRatio(value: number | null): string {
  return value === null ? "—" : value.toFixed(3);
}
