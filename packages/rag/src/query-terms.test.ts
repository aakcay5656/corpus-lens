import { describe, expect, it } from "vitest";

import { splitQueryTerms } from "@corpus-lens/shared/query-terms";

/**
 * These assertions are load-bearing beyond this file: the keyword arm searches for exactly
 * these terms, the vector-arm rewrite asks the database about exactly these terms, and the
 * chat UI highlights exactly these terms. A change here is a change to all three.
 *
 * The function lives in `packages/shared` (it has to reach the browser bundle) but is tested
 * here, because `shared` has no test runner and adding one to hold a single suite is a worse
 * trade than testing it from its first consumer.
 */
describe("splitQueryTerms", () => {
  it("lower-cases and keeps the written order", () => {
    expect(splitQueryTerms("Which Languages Must Ship")).toEqual([
      "which",
      "languages",
      "must",
      "ship",
    ]);
  });

  it("keeps intra-word punctuation that identifiers depend on", () => {
    // Splitting these would search for "lumen" and "track" separately, which matches
    // hundreds of chunks instead of the one document that names the removed API.
    expect(splitQueryTerms("lumen.track low-contrast loop_complete 4.5")).toEqual([
      "lumen.track",
      "low-contrast",
      "loop_complete",
      "4.5",
    ]);
  });

  it("strips punctuation that is only sentence structure", () => {
    expect(splitQueryTerms("What is the rule? (really)")).toEqual([
      "what",
      "is",
      "the",
      "rule",
      "really",
    ]);
  });

  it("drops websearch operator words typed as ordinary English", () => {
    // "and" reaching websearch_to_tsquery as a term would leave a dangling operator and
    // silently change the query's meaning.
    expect(splitQueryTerms("audio and video not images or sound")).toEqual([
      "audio",
      "video",
      "images",
      "sound",
    ]);
  });

  it("returns nothing for a query with no searchable characters", () => {
    expect(splitQueryTerms("??? --- ...")).toEqual([]);
  });
});
