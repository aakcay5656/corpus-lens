import { describe, expect, it } from "vitest";

import { rewriteForVectorArm, type TermDocumentCounts } from "./query-rewrite";

/**
 * The rewrite is the one place a query is changed behind the user's back, so the tests are
 * mostly about when it must *not* fire. A retrieval system that silently searches for
 * something other than what was asked is worse than one that ranks badly.
 */
function counts(totalDocuments: number, byTerm: Record<string, number>): TermDocumentCounts {
  return { totalDocuments, byTerm: new Map(Object.entries(byTerm)) };
}

describe("rewriteForVectorArm", () => {
  it("drops a term that appears in a majority of documents", () => {
    const result = rewriteForVectorArm("low contrast rule in delivery reports", {
      ...counts(100, { low: 5, contrast: 23, rule: 1, in: 0, delivery: 89, reports: 56 }),
    });

    expect(result.text).toBe("low contrast rule in");
    expect(result.droppedTerms).toEqual(["delivery", "reports"]);
  });

  it("leaves the query alone when no term is common", () => {
    const query = "What is the CTA contrast rule?";
    const result = rewriteForVectorArm(query, counts(100, { cta: 12, contrast: 23, rule: 1 }));

    expect(result.text).toBe(query);
    expect(result.droppedTerms).toEqual([]);
  });

  /** Exactly half is not a majority: a term in half the corpus still separates two halves. */
  it("keeps a term present in exactly half the corpus", () => {
    const result = rewriteForVectorArm("audio pipeline", counts(100, { audio: 50, pipeline: 4 }));

    expect(result.droppedTerms).toEqual([]);
  });

  /**
   * The safety valve. A query of nothing embeds to nothing useful, so a bad candidate set
   * beats no candidate set.
   */
  it("keeps the original when every term would be dropped", () => {
    const query = "delivery reports";
    const result = rewriteForVectorArm(query, counts(100, { delivery: 89, reports: 56 }));

    expect(result.text).toBe(query);
    expect(result.droppedTerms).toEqual([]);
  });

  it("does nothing on an empty corpus rather than dividing by zero", () => {
    const result = rewriteForVectorArm("anything", counts(0, {}));

    expect(result.text).toBe("anything");
    expect(result.droppedTerms).toEqual([]);
  });

  /**
   * Hyphenated words are one token to the keyword arm, so they must be one token here too —
   * removing "contrast" from "low-contrast" would leave "low-" and change the phrase into
   * something nobody asked about.
   */
  it("treats a hyphenated word as one term", () => {
    const result = rewriteForVectorArm(
      "low-contrast button in reports",
      counts(100, { "low-contrast": 8, button: 12, in: 0, reports: 56 }),
    );

    expect(result.text).toBe("low-contrast button in");
  });

  it("preserves punctuation and casing of the surviving text", () => {
    const result = rewriteForVectorArm(
      "Why does a CTA keep coming up in delivery reports, and what is the rule?",
      counts(100, { cta: 62, delivery: 89, reports: 56, rule: 1 }),
    );

    // The model reads a phrase, not a bag of words, so what survives is handed over as it
    // was written — including the comma and the question mark.
    expect(result.text).toBe("Why does a keep coming up in, and what is the rule?");
  });
});
