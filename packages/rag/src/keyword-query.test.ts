import { describe, expect, it } from "vitest";

import { toKeywordQuery } from "./keyword-query";

describe("toKeywordQuery", () => {
  it("joins terms with OR rather than leaving them to be ANDed", () => {
    // The regression this function exists for: ANDing eight terms of a question against a
    // 200-token chunk matches nothing, and the keyword arm silently returns zero rows.
    expect(toKeywordQuery("How many vacation days do Lumen employees get?")).toBe(
      "how or many or vacation or days or do or lumen or employees or get",
    );
  });

  it("keeps hyphenated and dotted terms whole", () => {
    expect(toKeywordQuery("low-contrast CTA and lumen.track")).toBe(
      "low-contrast or cta or lumen.track",
    );
  });

  it("drops the words websearch treats as operators", () => {
    // Left in, these become dangling operators and quietly change the query's meaning.
    expect(toKeywordQuery("meta and unity or not applovin")).toBe("meta or unity or applovin");
  });

  it("strips punctuation without producing empty terms", () => {
    expect(toKeywordQuery("  what is 4.5:1, exactly?!  ")).toBe(
      "what or is or 4.5 or 1 or exactly",
    );
  });

  it("does not leave a leading dash that websearch would read as negation", () => {
    expect(toKeywordQuery("-applovin --size")).toBe("applovin or size");
  });

  it("returns an empty string for input with no searchable terms", () => {
    // The caller must cope: an empty websearch query matches nothing, which is the correct
    // outcome for a query of pure punctuation.
    expect(toKeywordQuery("?!,. ")).toBe("");
  });

  it("preserves non-ASCII words instead of stripping them", () => {
    expect(toKeywordQuery("Türkçe karakterler çalışır")).toBe("türkçe or karakterler or çalışır");
  });
});
