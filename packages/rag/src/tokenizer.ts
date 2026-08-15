import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";

/**
 * Counting tokens for real, not with a words × 1.33 proxy.
 *
 * Two things depend on the count being right rather than close:
 *
 * 1. The chunk budget. A chunk that overshoots the embedding model's 8191-token input
 *    limit is rejected by the API, and a proxy that under-counts code-heavy or
 *    non-English text overshoots by a lot, not a little.
 * 2. The batch cap in the embedding provider. The embeddings endpoint bounds the total
 *    tokens per request, so batching has to be decided on token count, not array length.
 *
 * The interface exists so the chunker can be unit-tested against a trivial counter — the
 * chunker's contract is "respect the budget you are given", which is easier to assert
 * against a word counter than against BPE — and so a model with a different tokenizer is
 * a one-line swap.
 */
export interface TokenCounter {
  count(text: string): number;
}

/**
 * `cl100k_base` is the encoding used by the whole `text-embedding-3` family, so the
 * encoding is imported directly rather than looked up from a model name: the model is
 * configurable, its tokenizer is not, and importing one encoding avoids pulling every
 * rank table in the package into the bundle.
 *
 * Chosen over `js-tiktoken`, which produces identical counts but whose package types
 * are ESM-only while its runtime is dual — TypeScript's Node16 resolver rejects it from
 * a CommonJS package, which is what these packages are.
 */
export const EMBEDDING_TOKENIZER_ENCODING = "cl100k_base";

export function createTokenCounter(): TokenCounter {
  return {
    count(text: string): number {
      return countTokens(text);
    },
  };
}
