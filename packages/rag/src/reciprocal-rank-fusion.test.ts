import { describe, expect, it } from "vitest";

import { DEFAULT_RRF_K, reciprocalRankFusion } from "./reciprocal-rank-fusion";

describe("reciprocalRankFusion", () => {
  it("scores each arm as 1 / (k + rank) with 1-based ranks", () => {
    const [first] = reciprocalRankFusion({ vector: ["a"], keyword: [] });

    expect(first?.score).toBeCloseTo(1 / (DEFAULT_RRF_K + 1), 12);
    expect(first?.vectorRank).toBe(1);
    expect(first?.keywordRank).toBeNull();
  });

  it("sums the arms for a document both of them returned", () => {
    const fused = reciprocalRankFusion({ vector: ["a"], keyword: ["a"] });

    expect(fused).toHaveLength(1);
    expect(fused[0]?.score).toBeCloseTo(2 / (DEFAULT_RRF_K + 1), 12);
    expect(fused[0]?.vectorRank).toBe(1);
    expect(fused[0]?.keywordRank).toBe(1);
  });

  /**
   * The behaviour k = 60 exists to produce, and the reason a weighted sum was rejected:
   * agreement between two arms beats confidence within one. "b" is third in both lists and
   * still outranks "a", which one arm puts first and the other misses entirely.
   */
  it("ranks a document both arms agree on above one only a single arm found", () => {
    const fused = reciprocalRankFusion({
      vector: ["a", "x", "b"],
      keyword: ["y", "z", "b"],
    });

    expect(fused[0]?.id).toBe("b");
    expect(fused[0]?.vectorRank).toBe(3);
    expect(fused[0]?.keywordRank).toBe(3);
  });

  it("deduplicates: a document in both arms appears exactly once", () => {
    const fused = reciprocalRankFusion({ vector: ["a", "b"], keyword: ["b", "a"] });

    expect(fused.map((entry) => entry.id).sort()).toEqual(["a", "b"]);
  });

  it("counts only the best rank when an arm repeats an id", () => {
    // A repeated id must not let one arm vote twice and outweigh the other on its own.
    const fused = reciprocalRankFusion({ vector: ["a", "a", "a"], keyword: [] });

    expect(fused).toHaveLength(1);
    expect(fused[0]?.score).toBeCloseTo(1 / (DEFAULT_RRF_K + 1), 12);
    expect(fused[0]?.vectorRank).toBe(1);
  });

  it("works when one arm returns nothing", () => {
    const fused = reciprocalRankFusion({ vector: [], keyword: ["a", "b"] });

    expect(fused.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(fused[0]?.vectorRank).toBeNull();
  });

  it("returns nothing when both arms are empty", () => {
    expect(reciprocalRankFusion({ vector: [], keyword: [] })).toEqual([]);
  });

  it("breaks ties deterministically rather than by map order", () => {
    // Same score for every id; two calls with the arms' contents shuffled must agree.
    const once = reciprocalRankFusion({ vector: ["c", "a", "b"], keyword: [] });
    const twice = reciprocalRankFusion({ vector: ["c", "a", "b"], keyword: [] });

    expect(once.map((entry) => entry.id)).toEqual(twice.map((entry) => entry.id));
    // Rank order within the arm is preserved, since rank is what sets the score.
    expect(once.map((entry) => entry.id)).toEqual(["c", "a", "b"]);
  });

  it("honours a custom k", () => {
    const [entry] = reciprocalRankFusion({ vector: ["a"], keyword: [], k: 0 });

    expect(entry?.score).toBeCloseTo(1, 12);
  });
});
