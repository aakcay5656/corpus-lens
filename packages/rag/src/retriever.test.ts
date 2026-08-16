import { describe, expect, it } from "vitest";

import { createDeterministicEmbeddingProvider } from "./deterministic-embedding-provider";
import { retrieve, type RetrievalRepository, type RetrievedChunk } from "./retriever";
import { type TokenCounter } from "./tokenizer";

const wordCounter: TokenCounter = {
  count: (text) => text.split(/\s+/).filter((word) => word.length > 0).length,
};

const provider = createDeterministicEmbeddingProvider({ dimensions: 32 });

function chunk(id: string, overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: id,
    documentId: `doc-${id}`,
    documentTitle: `Title ${id}`,
    sourcePath: `${id}.md`,
    docType: null,
    breadcrumb: `Title ${id}`,
    content: `Content of ${id}`,
    ordinal: 0,
    rawScore: 0.5,
    ...overrides,
  };
}

/** Records what each arm was asked for, so the candidate budget can be asserted. */
function repository(
  vector: RetrievedChunk[],
  keyword: RetrievedChunk[],
): RetrievalRepository & { calls: { arm: string; limit: number; docType?: string }[] } {
  const calls: { arm: string; limit: number; docType?: string }[] = [];
  return {
    calls,
    searchByVector: (_embedding, limit, filters) => {
      calls.push({ arm: "vector", limit, docType: filters.docType });
      return Promise.resolve(vector);
    },
    searchByKeyword: (_query, limit, filters) => {
      calls.push({ arm: "keyword", limit, docType: filters.docType });
      return Promise.resolve(keyword);
    },
    countTermDocuments: () => Promise.resolve(NO_COMMON_TERMS),
  };
}

/**
 * A corpus in which no term is common, so the vector-arm rewrite never fires. These tests
 * are about fusion and plumbing; the rewrite has its own file.
 */
const NO_COMMON_TERMS = { totalDocuments: 100, byTerm: new Map<string, number>() };

function run(repo: RetrievalRepository, topK = 6, extra: Record<string, unknown> = {}) {
  return retrieve({
    repository: repo,
    embeddingProvider: provider,
    tokenCounter: wordCounter,
    query: "what is the applovin size limit",
    topK,
    ...extra,
  });
}

describe("retrieve", () => {
  it("fuses both arms and returns at most topK passages", async () => {
    const repo = repository([chunk("a"), chunk("b"), chunk("c")], [chunk("c"), chunk("d")]);

    const { passages } = await run(repo, 2);

    expect(passages).toHaveLength(2);
    // "c" is in both arms, so it wins despite being third by vectors.
    expect(passages[0]?.chunkId).toBe("c");
    expect(passages[0]?.vectorRank).toBe(3);
    expect(passages[0]?.keywordRank).toBe(1);
  });

  it("asks each arm for more candidates than it will return", async () => {
    // Fusion can only reorder what it was given: a chunk ranked 12th by one arm and 3rd by
    // the other cannot win if the first arm only returned 6 rows.
    const repo = repository([chunk("a")], [chunk("a")]);

    await run(repo, 6);

    expect(repo.calls.every((call) => call.limit === 20)).toBe(true);
  });

  it("runs the two arms in parallel", async () => {
    const order: string[] = [];
    const slow = (label: string, result: RetrievedChunk[]) => () =>
      new Promise<RetrievedChunk[]>((resolve) => {
        order.push(`${label}-start`);
        setTimeout(() => {
          order.push(`${label}-end`);
          resolve(result);
        }, 10);
      });

    const repo: RetrievalRepository = {
      searchByVector: slow("vector", [chunk("a")]),
      searchByKeyword: slow("keyword", [chunk("b")]),
      countTermDocuments: () => Promise.resolve(NO_COMMON_TERMS),
    };

    await run(repo);

    // Sequential execution would give vector-start, vector-end, keyword-start, keyword-end.
    expect(order).toEqual(["vector-start", "keyword-start", "vector-end", "keyword-end"]);
  });

  it("returns a passage from a chunk only one arm found", async () => {
    const repo = repository([chunk("only-vector")], []);

    const { passages } = await run(repo);

    expect(passages).toHaveLength(1);
    expect(passages[0]?.vectorRank).toBe(1);
    expect(passages[0]?.keywordRank).toBeNull();
  });

  it("carries provenance through to the passage", async () => {
    const repo = repository(
      [
        chunk("x", {
          documentTitle: "Delivery Report: Merge Marina, 2025-12",
          sourcePath: "delivery-reports/2025-12-merge-marina.md",
          docType: "delivery-report",
          breadcrumb: "Delivery Report: Merge Marina, 2025-12 > QA findings and fixes",
          ordinal: 3,
        }),
      ],
      [],
    );

    const [passage] = (await run(repo)).passages;

    expect(passage?.sourcePath).toBe("delivery-reports/2025-12-merge-marina.md");
    expect(passage?.docType).toBe("delivery-report");
    expect(passage?.breadcrumb).toContain("QA findings and fixes");
    expect(passage?.ordinal).toBe(3);
  });

  it("passes a docType filter down to both arms", async () => {
    const repo = repository([chunk("a")], [chunk("a")]);

    await run(repo, 6, { filters: { docType: "guide" } });

    expect(repo.calls.map((call) => call.docType)).toEqual(["guide", "guide"]);
  });

  it("returns an empty result rather than failing when nothing matches", async () => {
    const { passages, timings } = await run(repository([], []));

    expect(passages).toEqual([]);
    expect(timings.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("reports the embed and retrieve stages separately", async () => {
    const { timings } = await run(repository([chunk("a")], []));

    // Split rather than a single total, because "the model is slow" and "the database is
    // slow" are different problems and the dashboard has to tell them apart.
    expect(timings).toHaveProperty("embedMs");
    expect(timings).toHaveProperty("retrieveMs");
    expect(timings.totalMs).toBeGreaterThanOrEqual(timings.retrieveMs);
  });
});
