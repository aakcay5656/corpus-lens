import { type Passage } from "@corpus-lens/shared/search";
import { describe, expect, it } from "vitest";

import { validateCitations } from "./citations";

function passage(index: number): Passage {
  return {
    chunkId: `00000000-0000-4000-8000-00000000000${index}`,
    documentId: `10000000-0000-4000-8000-00000000000${index}`,
    documentTitle: `Document ${index}`,
    sourcePath: `doc-${index}.md`,
    docType: null,
    breadcrumb: `Document ${index}`,
    content: `Content ${index}`,
    ordinal: 0,
    score: 0.03,
    vectorRank: index,
    keywordRank: index,
  };
}

const sources = [passage(1), passage(2), passage(3)];

describe("validateCitations", () => {
  it("resolves markers to the sources they point at", () => {
    const result = validateCitations("The limit is 5 MB [1] and it ships inline [2].", sources);

    expect(result.citations.map((citation) => citation.marker)).toEqual([1, 2]);
    expect(result.citations[0]?.sourcePath).toBe("doc-1.md");
    expect(result.citations[0]?.sourceIndex).toBe(0);
    expect(result.droppedMarkers).toEqual([]);
  });

  /**
   * The rule from CLAUDE.md §6, and the reason this module exists: a marker that resolves
   * to nothing turns an unverifiable claim into one that *looks* verified, which is worse
   * than no citation at all.
   */
  it("drops a citation to a source that was never supplied", () => {
    const result = validateCitations("Grounded [1] but invented [7].", sources);

    expect(result.citations.map((citation) => citation.marker)).toEqual([1]);
    expect(result.droppedMarkers).toEqual([7]);
    expect(result.text).not.toContain("[7]");
    expect(result.text).toContain("[1]");
  });

  it("leaves no gap in the prose where a marker was removed", () => {
    const result = validateCitations("It ships inline [9].", sources);

    // "inline ." would look like a rendering bug to a reader.
    expect(result.text).toBe("It ships inline.");
  });

  it("deduplicates a marker cited more than once", () => {
    const result = validateCitations("First [2]. Second [2]. Third [2].", sources);

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.marker).toBe(2);
  });

  it("keeps adjacent markers separate", () => {
    const result = validateCitations("Both agree [1][3].", sources);

    expect(result.citations.map((citation) => citation.marker)).toEqual([1, 3]);
  });

  it("orders citations by first appearance, not by number", () => {
    const result = validateCitations("Later first [3], then [1].", sources);

    expect(result.citations.map((citation) => citation.marker)).toEqual([3, 1]);
  });

  it("treats marker 0 as invalid, since the prompt numbers sources from 1", () => {
    const result = validateCitations("Zero [0] is not a source.", sources);

    expect(result.citations).toEqual([]);
    expect(result.droppedMarkers).toEqual([0]);
  });

  it("returns no citations for text that has none", () => {
    const result = validateCitations("A claim with no marker.", sources);

    expect(result.citations).toEqual([]);
    expect(result.text).toBe("A claim with no marker.");
  });

  it("drops every marker when no sources were supplied", () => {
    const result = validateCitations("Invented [1] entirely [2].", []);

    expect(result.citations).toEqual([]);
    expect(result.droppedMarkers).toEqual([1, 2]);
  });
});
