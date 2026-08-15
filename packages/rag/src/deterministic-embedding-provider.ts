import { normalise, type EmbeddingProvider } from "./embeddings";

/**
 * A local, offline embedding provider — a real provider, not a test double.
 *
 * It exists because the whole system otherwise cannot be run without an OpenAI key:
 * ingestion, hybrid retrieval, the dashboard and the MCP tool all sit downstream of a
 * vector. Making the offline variant a first-class provider selected by config, rather
 * than a mock injected in tests, means the reviewer can clone the repository and see the
 * pipeline work end to end, and means the tests exercise the same code path production
 * uses instead of a parallel one that can rot.
 *
 * **How it works.** The hashing trick: every word is hashed to a dimension and a sign,
 * and the vector is the accumulated bag of words, L2-normalised. That gives genuine
 * lexical similarity — two texts sharing vocabulary get a high cosine score — which is
 * what makes retrieval demonstrably *work* rather than return noise.
 *
 * **What it is not.** It has no semantics. "Playable ad" and "HTML5 banner" are
 * orthogonal to it, and paraphrase recall is exactly what the real model is for. Never
 * quote evaluation numbers produced with this provider as retrieval quality; use it to
 * prove the plumbing, and `EMBEDDING_PROVIDER=openai` to measure.
 */

export interface DeterministicEmbeddingConfig {
  dimensions: number;
}

export function createDeterministicEmbeddingProvider(
  config: DeterministicEmbeddingConfig,
): EmbeddingProvider {
  return {
    model: `deterministic-hash-${config.dimensions}`,
    dimensions: config.dimensions,
    // Deliberately the same limits as the OpenAI provider. A synthetic source that
    // accepts what the real one rejects hides the failure it exists to expose, so an
    // over-long chunk must break here too — that is the whole point of running the
    // offline path through `embedAll`.
    maxInputTokens: 8191,
    maxRequestTokens: 300_000,
    maxBatchSize: 2048,

    // Async to match the interface: callers await it exactly as they await the network
    // provider, so ordering and concurrency behave identically on both paths.
    embedBatch(texts: string[]): Promise<number[][]> {
      return Promise.resolve(texts.map((text) => embedOne(text, config.dimensions)));
    },
  };
}

function embedOne(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);

  for (const word of tokenise(text)) {
    const hash = fnv1a(word);
    const dimension = hash % dimensions;
    // A second hash bit decides the sign. Without it every collision adds constructively
    // and unrelated documents drift towards a common direction, which would make
    // everything look similar to everything.
    const sign = (hash >>> 16) % 2 === 0 ? 1 : -1;
    vector[dimension] = (vector[dimension] ?? 0) + sign;
  }

  return normalise(vector);
}

/** Lower-cased alphanumeric words. Crude on purpose — it must be cheap and stable. */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/**
 * FNV-1a, 32-bit. Chosen because it is eight lines, has no dependencies and is stable
 * across runs and machines — a vector stored today must be comparable to a query
 * embedded tomorrow, so the hash can never change.
 */
function fnv1a(word: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < word.length; index += 1) {
    hash ^= word.charCodeAt(index);
    // Multiply by the 32-bit FNV prime 16777619 using shifts, which keeps the result
    // inside the range where JavaScript integer arithmetic stays exact.
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}
