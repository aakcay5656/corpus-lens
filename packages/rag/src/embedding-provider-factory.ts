import { createDeterministicEmbeddingProvider } from "./deterministic-embedding-provider";
import { type EmbeddingProvider } from "./embeddings";
import { createOpenAiEmbeddingProvider } from "./openai-embedding-provider";

/**
 * The one place that decides which embedding provider is in use.
 *
 * Everything downstream — ingestion, retrieval, the MCP tool — takes an
 * `EmbeddingProvider` and never asks which kind it is. Keeping the branch here is what
 * makes "run it without an API key" a configuration change rather than a code path with
 * `if (offline)` scattered through it.
 */
export const EMBEDDING_PROVIDER_KINDS = ["openai", "deterministic"] as const;
export type EmbeddingProviderKind = (typeof EMBEDDING_PROVIDER_KINDS)[number];

export interface EmbeddingProviderConfig {
  kind: EmbeddingProviderKind;
  /** Vector length. Must equal the `vector(n)` column width in packages/db. */
  dimensions: number;
  /** Model name for the `openai` kind. Ignored by `deterministic`. */
  model?: string;
  /** Required for the `openai` kind. Never logged. */
  apiKey?: string;
  /**
   * Overrides the API origin for the `openai` kind. The `/v1/embeddings` wire format is
   * spoken by OpenRouter, Azure OpenAI and self-hosted servers as well, so the vendor is
   * configuration rather than code.
   */
  baseUrl?: string;
  timeoutMs?: number;
}

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  if (config.kind === "deterministic") {
    return createDeterministicEmbeddingProvider({ dimensions: config.dimensions });
  }

  const apiKey = config.apiKey;
  if (apiKey === undefined || apiKey.length === 0) {
    // Fail here rather than on the first HTTP call, which would be several minutes into
    // an ingestion run after the corpus has already been read and chunked.
    throw new Error(
      "EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY. Set it, or use " +
        "EMBEDDING_PROVIDER=deterministic to run without a key.",
    );
  }

  return createOpenAiEmbeddingProvider({
    apiKey,
    model: config.model ?? DEFAULT_EMBEDDING_MODEL,
    dimensions: config.dimensions,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
  });
}
