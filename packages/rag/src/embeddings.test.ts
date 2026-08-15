import { describe, expect, it } from "vitest";

import { createDeterministicEmbeddingProvider } from "./deterministic-embedding-provider";
import { createEmbeddingProvider } from "./embedding-provider-factory";
import { EmbeddingError, embedAll, type EmbeddingProvider } from "./embeddings";
import { type TokenCounter } from "./tokenizer";

const wordCounter: TokenCounter = {
  count: (text) => text.split(/\s+/).filter((word) => word.length > 0).length,
};

/** Records the batches it was asked to embed, so batching can be asserted directly. */
function recordingProvider(overrides: Partial<EmbeddingProvider> = {}): {
  provider: EmbeddingProvider;
  batches: string[][];
} {
  const batches: string[][] = [];
  const provider: EmbeddingProvider = {
    model: "recorder",
    dimensions: 4,
    maxInputTokens: 100,
    maxRequestTokens: 1000,
    maxBatchSize: 1000,
    embedBatch(texts) {
      batches.push([...texts]);
      return Promise.resolve(texts.map(() => [0, 0, 0, 0]));
    },
    ...overrides,
  };
  return { provider, batches };
}

describe("embedAll", () => {
  it("splits requests on the token cap, not on array length", async () => {
    const { provider, batches } = recordingProvider({ maxRequestTokens: 6 });
    const texts = ["one two three", "four five six", "seven eight nine"];

    const vectors = await embedAll(provider, texts, wordCounter);

    expect(vectors).toHaveLength(3);
    expect(batches).toEqual([["one two three", "four five six"], ["seven eight nine"]]);
  });

  it("also respects the maximum number of inputs per request", async () => {
    const { provider, batches } = recordingProvider({ maxBatchSize: 1 });

    await embedAll(provider, ["a", "b", "c"], wordCounter);

    expect(batches).toEqual([["a"], ["b"], ["c"]]);
  });

  it("rejects an input longer than the model accepts instead of truncating it", async () => {
    const { provider, batches } = recordingProvider({ maxInputTokens: 3 });

    await expect(embedAll(provider, ["one two three four"], wordCounter)).rejects.toThrow(
      EmbeddingError,
    );
    // Nothing was sent: the check happens before any request is spent.
    expect(batches).toEqual([]);
  });

  it("rejects a provider that returns the wrong number of vectors", async () => {
    const { provider } = recordingProvider({
      embedBatch: () => Promise.resolve([[0, 0, 0, 0]]),
    });

    await expect(embedAll(provider, ["a", "b"], wordCounter)).rejects.toThrow(
      /2 vectors|1 vectors/,
    );
  });

  it("returns an empty array without calling the provider", async () => {
    const { provider, batches } = recordingProvider();

    expect(await embedAll(provider, [], wordCounter)).toEqual([]);
    expect(batches).toEqual([]);
  });
});

describe("deterministic provider", () => {
  const provider = createDeterministicEmbeddingProvider({ dimensions: 64 });

  it("is stable across calls", async () => {
    const [first] = await provider.embedBatch(["Merge Marina delivery report"]);
    const [second] = await provider.embedBatch(["Merge Marina delivery report"]);

    expect(first).toEqual(second);
  });

  it("returns unit vectors of the configured width", async () => {
    const [vector] = await provider.embedBatch(["some text"]);

    expect(vector).toHaveLength(64);
    const magnitude = Math.sqrt((vector ?? []).reduce((sum, value) => sum + value * value, 0));
    expect(magnitude).toBeCloseTo(1, 10);
  });

  it("scores shared vocabulary above unrelated text", async () => {
    const [related, sameTopic, unrelated] = await provider.embedBatch([
      "Bubble Bakery delivery report haptics and memory pooling",
      "Bubble Bakery delivery report haptics reduced to combos",
      "localization guide for Korean line breaking rules",
    ]);

    expect(cosine(related, sameTopic)).toBeGreaterThan(cosine(related, unrelated));
  });

  it("gives an empty input a zero vector rather than NaN", async () => {
    const [vector] = await provider.embedBatch([""]);

    expect(vector).toHaveLength(64);
    expect(vector?.every((value) => value === 0)).toBe(true);
  });
});

describe("createEmbeddingProvider", () => {
  it("refuses the openai kind without a key, naming the offline alternative", () => {
    expect(() => createEmbeddingProvider({ kind: "openai", dimensions: 1536 })).toThrow(
      /EMBEDDING_PROVIDER=deterministic/,
    );
  });

  it("builds the deterministic provider at the requested width", () => {
    const provider = createEmbeddingProvider({ kind: "deterministic", dimensions: 1536 });

    expect(provider.dimensions).toBe(1536);
  });

  it("gives both kinds the same limits, so offline runs fail where online would", () => {
    const offline = createEmbeddingProvider({ kind: "deterministic", dimensions: 1536 });
    const online = createEmbeddingProvider({
      kind: "openai",
      dimensions: 1536,
      apiKey: "test-key-not-used",
    });

    expect(offline.maxInputTokens).toBe(online.maxInputTokens);
    expect(offline.maxRequestTokens).toBe(online.maxRequestTokens);
    expect(offline.maxBatchSize).toBe(online.maxBatchSize);
  });
});

function cosine(a: number[] | undefined, b: number[] | undefined): number {
  if (a === undefined || b === undefined) return 0;
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}
