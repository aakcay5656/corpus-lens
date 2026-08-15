import { type TokenCounter } from "./tokenizer";

/**
 * The seam between retrieval and whatever produces vectors.
 *
 * CLAUDE.md §3 asks for this interface so the embedding model is swappable — a local
 * Transformers.js model, a different provider, a different dimensionality. It earns its
 * keep immediately rather than hypothetically: `deterministic-embedding-provider.ts`
 * implements it too, which is what lets the whole ingest → search → answer pipeline run
 * with no API key and no network.
 *
 * A provider describes its own limits instead of having them hard-coded at the call
 * site, because they are properties of the model, and `embedAll` is the single place
 * that enforces them for every provider alike.
 */
export interface EmbeddingProvider {
  readonly model: string;
  /** Vector length. Must match the `vector(n)` column in packages/db. */
  readonly dimensions: number;
  /** Maximum tokens in a single input. Exceeding it is an error, not a truncation. */
  readonly maxInputTokens: number;
  /** Maximum tokens summed across one request. */
  readonly maxRequestTokens: number;
  /** Maximum number of inputs in one request. */
  readonly maxBatchSize: number;
  /**
   * Embeds one request's worth of text. Returns vectors in input order — callers rely
   * on positional correspondence to attach a vector to its chunk.
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

/**
 * Embeds any number of texts, splitting them into requests the provider will accept.
 *
 * The cap is token-aware rather than a fixed array length. An array-length cap is a
 * guess: 100 short chunks fit easily in one request while 100 long ones are rejected,
 * and the failure only appears on the corpus that happens to contain long documents.
 * Counting is cheap next to a network round trip.
 *
 * Batching lives here, above the interface, so the deterministic provider goes through
 * the same path as the real one — including the same "input too long" rejection. A
 * synthetic provider that quietly accepts what the real one refuses would hide exactly
 * the bug it exists to surface.
 */
export async function embedAll(
  provider: EmbeddingProvider,
  texts: string[],
  tokenCounter: TokenCounter,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const counts = texts.map((text) => tokenCounter.count(text));

  const oversized = counts.findIndex((count) => count > provider.maxInputTokens);
  if (oversized !== -1) {
    // Fail loudly rather than truncating: a silently halved chunk is retrievable but
    // returns an answer missing the half that was cut, which is worse than an error.
    throw new EmbeddingError(
      `input ${oversized} is ${counts[oversized]} tokens, over the ${provider.maxInputTokens} token limit of ${provider.model}`,
      false,
    );
  }

  const vectors: number[][] = [];
  let batch: string[] = [];
  let batchTokens = 0;

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const embedded = await provider.embedBatch(batch);
    if (embedded.length !== batch.length) {
      throw new EmbeddingError(
        `provider returned ${embedded.length} vectors for ${batch.length} inputs`,
        false,
      );
    }
    vectors.push(...embedded);
    batch = [];
    batchTokens = 0;
  };

  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index] ?? "";
    const count = counts[index] ?? 0;
    const full =
      batch.length >= provider.maxBatchSize ||
      (batch.length > 0 && batchTokens + count > provider.maxRequestTokens);
    if (full) await flush();
    batch.push(text);
    batchTokens += count;
  }
  await flush();

  return vectors;
}

/** L2 normalisation, so cosine distance reduces to a dot product. */
export function normalise(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}
