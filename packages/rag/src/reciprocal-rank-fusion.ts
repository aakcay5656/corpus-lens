/**
 * Reciprocal Rank Fusion.
 *
 *     score(d) = Σ over arms  1 / (k + rank(d, arm))
 *
 * Ranks are 1-based; an arm that did not return a document contributes nothing.
 *
 * **Why RRF and not a weighted sum of the two scores.** Cosine similarity and `ts_rank`
 * are not comparable quantities. Cosine sits in roughly 0.2–0.9 for this corpus and is
 * dense; `ts_rank` is unbounded, depends on term frequency and document length, and is
 * routinely 0.05 for an excellent keyword match. Any weighted sum needs a normalisation
 * that is itself a tuned guess, and it is fragile — swapping the embedding model shifts
 * the cosine distribution and silently changes the blend. RRF reads only the *ordering*
 * each arm produced, so there is nothing to normalise and nothing to retune.
 *
 * **Why k = 60.** It is the value from the original Cormack et al. paper and the de facto
 * default. Its role is to flatten the difference between the top ranks: with k = 60, rank
 * 1 scores 1/61 and rank 2 scores 1/62 — a 1.6% gap — so a document both arms rank
 * *reasonably* beats a document one arm ranks first and the other misses entirely. That
 * is the behaviour we want here, because the two arms fail in different ways and agreement
 * between them is a stronger signal than confidence within one.
 *
 * A smaller k would make the top rank dominant and turn fusion back into "whichever arm
 * was most confident wins", which is the thing hybrid retrieval exists to avoid.
 */
export const DEFAULT_RRF_K = 60;

export interface FusionArms {
  /** Chunk ids in vector-similarity order, best first. */
  vector: string[];
  /** Chunk ids in keyword-rank order, best first. */
  keyword: string[];
  k?: number;
}

export interface FusedEntry {
  id: string;
  score: number;
  /** 1-based rank in each arm; null when that arm did not return this id. */
  vectorRank: number | null;
  keywordRank: number | null;
}

/**
 * Fuses two ranked id lists into one, deduplicated, best first.
 *
 * Ties are broken by preferring the better vector rank, then the better keyword rank, and
 * finally the id — so the order is deterministic. Without that, two chunks that appear at
 * the same rank in one arm and nowhere in the other would come back in whatever order the
 * map happened to iterate, and a "flaky" retrieval result is very hard to debug later.
 */
export function reciprocalRankFusion(arms: FusionArms): FusedEntry[] {
  const k = arms.k ?? DEFAULT_RRF_K;
  const entries = new Map<string, FusedEntry>();

  const accumulate = (ids: string[], arm: "vector" | "keyword"): void => {
    ids.forEach((id, index) => {
      const rank = index + 1;
      const existing = entries.get(id) ?? {
        id,
        score: 0,
        vectorRank: null,
        keywordRank: null,
      };

      // Guard against an arm returning the same id twice: only the best rank counts, and
      // double-counting it would let one arm outvote the other on its own.
      const alreadyRanked = arm === "vector" ? existing.vectorRank : existing.keywordRank;
      if (alreadyRanked !== null) return;

      existing.score += 1 / (k + rank);
      if (arm === "vector") existing.vectorRank = rank;
      else existing.keywordRank = rank;

      entries.set(id, existing);
    });
  };

  accumulate(arms.vector, "vector");
  accumulate(arms.keyword, "keyword");

  return [...entries.values()].sort(compareFused);
}

function compareFused(a: FusedEntry, b: FusedEntry): number {
  if (a.score !== b.score) return b.score - a.score;

  const vector = compareRanks(a.vectorRank, b.vectorRank);
  if (vector !== 0) return vector;

  const keyword = compareRanks(a.keywordRank, b.keywordRank);
  if (keyword !== 0) return keyword;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A present rank beats an absent one; between two present ranks, lower wins. */
function compareRanks(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}
